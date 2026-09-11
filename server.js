const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { createPayoutStore, buildReport, stampQualification } = require("./api/payouts-local.cjs");
const bitrix = require("./api/bitrix-local.cjs");

const rootDir = __dirname;
const dataDir = process.env.MANAGER_DATA_DIR ? path.resolve(process.env.MANAGER_DATA_DIR) : path.join(rootDir, ".data");
const payoutStore = createPayoutStore(dataDir);
const usersPath = path.join(dataDir, "users.json");
const presetsPath = path.join(dataDir, "tech-presets.json");
const registryPath = path.join(dataDir, "contracts-registry.json");
const port = Number(process.env.PORT || 4173);
const adminLogin = process.env.ADMIN_LOGIN || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin2026";
const sessions = new Map();
const bitrixRecentBatches = new Map();
let mutationQueue = Promise.resolve();
function serializeMutation(action) {
  const result = mutationQueue.then(action);
  mutationQueue = result.catch(() => {});
  return result;
}
const SOURCE_OPTIONS = ["Директ", "Агент", "Повтор", "Сарафан", "Авито", "Парсинг", "SEO", "Профи.ру"];
const PAYMENT_STATUS_OPTIONS = ["Да", "Предоплата", "Планируется"];
const PAYMENT_TYPE_OPTIONS = ["ИП", "ООО", "Наличка"];
const CLOSING_DOCS_OPTIONS = ["Отправлены", "Не отправлены", "Не нужно"];
const BONUS_TYPE_OPTIONS = ["12%", "10%", "7%", "5%", "4%", "3%", "от прибыли", "оклад"];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 25 * 1024 * 1024) throw Object.assign(new Error("Слишком большой запрос."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Некорректный JSON."), { status: 400 });
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored || "").split(":");
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizePresets(source) {
  return (Array.isArray(source) ? source : [])
    .map((entry) => ({
      group: String(entry.group || entry.category || "Общее").trim() || "Общее",
      subgroup: String(entry.subgroup || entry.subcategory || "Без подгруппы").trim() || "Без подгруппы",
      title: String(entry.title || "").trim(),
      description: String(entry.description || "").trim(),
    }))
    .filter((entry) => entry.title && entry.description);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeChoice(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

function templatePrepayment(data, amount) {
  const percent = Number(data?.paymentTerms);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return 0;
  return roundMoney((amount * percent) / 100);
}

function invoicePaymentType(data) { return ({ip:'ИП',ooo:'ООО'})[data?.sellerKey] || ''; }
function normalizeRegistryMeta(entry, data, amount) {
  const source = entry?.registryMeta && typeof entry.registryMeta === "object" ? entry.registryMeta : entry || {};
  const rawPrepayment = source.prepayment;
  const prepayment = rawPrepayment === undefined || rawPrepayment === null || rawPrepayment === ""
    ? templatePrepayment(data, amount)
    : roundMoney(Math.max(0, Math.min(amount, Number(rawPrepayment) || 0)));
  return {
    title: String(source.title || "").trim(),
    source: typeof source.source === "string" ? source.source.trim() : "",
    bitrix: source.bitrix && typeof source.bitrix === "object" ? source.bitrix : null,
    paymentStatus: normalizeChoice(source.paymentStatus, PAYMENT_STATUS_OPTIONS, "Планируется"),
    prepayment,
    prepaymentOverridden: source.prepaymentOverridden === true,
    paymentType: normalizeChoice(source.paymentType || (entry.status === 'exported' ? invoicePaymentType(data) : ''), PAYMENT_TYPE_OPTIONS, ""),
    closingDocs: normalizeChoice(source.closingDocs, CLOSING_DOCS_OPTIONS, "Не отправлены"),
    bonusType: normalizeChoice(source.bonusType, BONUS_TYPE_OPTIONS, "12%"),
    bonusAmount: roundMoney(Math.max(0, Number(source.bonusAmount) || 0)),
  };
}

function assertPaidStatusHasNoRemainder(registryMeta, amount) {
  const remainingAmount = roundMoney(Math.max(0, (Number(amount) || 0) - (Number(registryMeta?.prepayment) || 0)));
  if (registryMeta?.paymentStatus === "Да" && remainingAmount > 0) {
    throw Object.assign(
      new Error(`Нельзя поставить «Оплачен — Да»: по договору остаётся ${remainingAmount.toFixed(2)} ₽.`),
      { status: 409 },
    );
  }
}

function normalizeRecord(entry, ownerId = null) {
  const data = entry?.data && typeof entry.data === "object" ? entry.data : {};
  const number = String(entry?.number || entry?.contractNumber || data.contractNumber || "").trim();
  const amount = Number(entry?.amount ?? data.totals?.grandTotal ?? 0);
  if (!number) return null;
  return {
    number,
    ownerId: Number(entry?.ownerId || ownerId || 0),
    date: String(entry?.date || data.contractDate || ""),
    counterparty: String(entry?.counterparty || data.customer?.name || data.customer?.inn || ""),
    amount: Number.isFinite(amount) ? amount : 0,
    status: entry?.status === "exported" ? "exported" : "draft",
    updatedAt: String(entry?.updatedAt || new Date().toISOString()),
    bonusQualifiedAt: typeof entry?.bonusQualifiedAt === "string" && Number.isFinite(Date.parse(entry.bonusQualifiedAt)) ? entry.bonusQualifiedAt : "",
    registryMeta: normalizeRegistryMeta(entry, data, Number.isFinite(amount) ? amount : 0),
    data,
  };
}

async function readJson(file, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

async function ensureData() {
  await fs.mkdir(dataDir, { recursive: true });
  let users = await readJson(usersPath);
  if (!users.length) {
    users = [
      {
        id: 1,
        login: adminLogin,
        passwordHash: hashPassword(adminPassword),
        role: "admin",
        createdAt: new Date().toISOString(),
      },
    ];
    await writeJson(usersPath, users);
  }
  try {
    await fs.access(presetsPath);
  } catch {
    await writeJson(presetsPath, normalizePresets(await readJson(path.join(rootDir, "templates", "tech-presets.json"))));
  }
  try {
    await fs.access(registryPath);
  } catch {
    const records = (await readJson(path.join(rootDir, "templates", "contracts-registry.json")))
      .map((record) => normalizeRecord(record, users[0].id))
      .filter(Boolean);
    await writeJson(registryPath, records);
  }
}

function publicUser(user) {
  return { id: Number(user.id), login: user.login, fullName: user.fullName || "", phone: user.phone || "", email: user.email || "", role: user.role === "admin" ? "admin" : "user", createdAt: user.createdAt };
}

function fullName(value = "") {
  if (typeof value !== "string" || [...value].length > 191 || /[\x00-\x1f\x7f]/.test(value)) {
    throw Object.assign(new Error("ФИО: не более 191 символа, без управляющих символов."), { status: 400 });
  }
  return value.trim().replace(/\s+/gu, " ");
}

function userContact(value = "", field) {
  const message = field === "email" ? "Укажите корректную почту." : "Укажите корректный телефон: от 7 до 20 цифр, можно использовать +, пробелы, скобки и дефисы.";
  const fail = () => Object.assign(new Error(message), {status:400});
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) throw fail();
  value = value.trim();
  if (!value) return "";
  if (field === "email") {
    if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw fail();
  } else {
    const digits = value.replace(/[^0-9]/g, "").length;
    if (value.length > 64 || !/^[+0-9(). -]+$/.test(value) || digits < 7 || digits > 20) throw fail();
  }
  return value;
}

function applyRegistryFields(previous, fields, user, users) {
  const record=structuredClone(previous), fail=(message,status=400)=>Object.assign(new Error(message),{status});
  const allowed=['date','counterparty','amount','recordStatus','manager','title','source','paymentStatus','prepayment','paymentType','closingDocs','bonusType','bonusAmount','bitrix'];
  if (Object.keys(fields).some(key=>!allowed.includes(key))) throw fail('Это поле нельзя редактировать.');
  for (const key of ['date','counterparty','title','source','recordStatus','manager','paymentStatus','paymentType','closingDocs','bonusType']) {
    if (Object.hasOwn(fields,key) && (typeof fields[key]!=='string' || fields[key].length>191 || /[\x00-\x1f\x7f]/.test(fields[key]))) throw fail('Некорректное значение поля.');
  }
  for (const key of ['amount','prepayment','bonusAmount']) if (Object.hasOwn(fields,key)) {
    if (!['number','string'].includes(typeof fields[key]) || fields[key]==='' || !Number.isFinite(Number(fields[key])) || fields[key]<0 || fields[key]>9999999999999.99) throw fail('Некорректная сумма.');
    fields[key]=roundMoney(Number(fields[key]));
  }
  if (Object.hasOwn(fields,'date') && !require('./api/payouts-local.cjs').validDate(fields.date)) throw fail('Некорректная дата.');
  if ((Object.hasOwn(fields,'manager') || Object.hasOwn(fields,'recordStatus')) && user.role!=='admin') throw fail('Недостаточно прав.',403);
  if (Object.hasOwn(fields,'recordStatus')) {
    if (!['draft','exported'].includes(fields.recordStatus)) throw fail('Некорректный статус записи.');
    record.status=fields.recordStatus;
  }
  if (Object.hasOwn(fields,'manager')) {
    const target=users.find(u=>u.login===fields.manager);
    if (!target) throw fail('Менеджер не найден.');
    record.ownerId=target.id;
  }
  for (const key of ['date','counterparty','amount']) if (Object.hasOwn(fields,key)) record[key]=fields[key];
  if (previous.registryMeta.paymentStatus==='Предоплата' && fields.paymentStatus==='Да') fields.prepayment=record.amount;
  const meta={...record.registryMeta,...Object.fromEntries(Object.entries(fields).filter(([key])=>Object.hasOwn(record.registryMeta,key)))};
  if (Object.hasOwn(fields,'prepayment')) {
    if (!['Да','Предоплата'].includes(meta.paymentStatus)) throw fail('Предоплата доступна для оплаченных сделок и сделок с предоплатой.',409);
    meta.prepaymentOverridden=true;
  }
  if (Object.hasOwn(fields,'bonusAmount') && meta.bonusType!=='от прибыли') throw fail('Сумма бонуса редактируется только для типа «от прибыли».',409);
  if (meta.prepayment>record.amount) throw fail('Предоплата не может превышать сумму сделки.',409);
  record.registryMeta=normalizeRegistryMeta({registryMeta:meta},record.data,record.amount);
  bitrix.preserveCrmFields(record,previous);
  assertPaidStatusHasNoRemainder(record.registryMeta,record.amount);
  record.updatedAt=new Date().toISOString();
  return stampQualification(record,previous);
}
function existingBitrixId(record, config) {
  const link = record.registryMeta.bitrix;
  if (link) return link.domain === bitrix.endpoint(config).hostname ? bitrix.id(link.dealId) : '';
  return bitrix.id(record.number);
}
async function refreshBitrixRecord(body, config, admin, expectedOwnerId = null) {
  if (typeof body.number !== 'string' || !body.number || body.number.length > 191 || !/^[a-f0-9-]{36}$/.test(body.runId || '')) {
    throw Object.assign(new Error('Некорректный запрос обновления реестра.'), {status:400});
  }
  const records = (await readJson(registryPath)).map(record => normalizeRecord(record)).filter(Boolean);
  const previous = records.find(record => record.number === body.number);
  if (!previous) return {number:body.number, skipped:'record_deleted'};
  if (expectedOwnerId !== null && previous.ownerId !== expectedOwnerId) throw Object.assign(new Error('Можно обновить только свои сделки.'),{status:403});
  const dealId = existingBitrixId(previous, config);
  if (!dealId) return {number:body.number, skipped:'needs_deal_id'};
  return syncBitrixDeal(dealId, config, {number:body.number,runId:body.runId,actorId:admin.id}, expectedOwnerId);
}
async function syncBitrixDeal(dealId, config, refresh = null, expectedOwnerId = null) {
  if (!bitrix.id(dealId)) throw Object.assign(new Error("Б24: некорректный ID сделки."), { status: 400 });
  const domain = bitrix.endpoint(config).hostname;
  const deleted = await readJson(path.join(dataDir, "bitrix-deleted.json"));
  if (deleted.includes(`${domain}:${dealId}`)) return { skipped: "record_deleted" };
  const historyPath = path.join(dataDir, 'bitrix-refresh-history.json');
  const history = refresh ? await readJson(historyPath) : [];
  const oldAudit = refresh && history.find(item => item.runId === refresh.runId && item.number === refresh.number);
  if (oldAudit?.result) return oldAudit.result;
  const snapshot = await bitrix.fetchSnapshot(dealId, config, bitrix.createClient(config));
  if (expectedOwnerId !== null && bitrix.resolveManager(snapshot.creator,await readJson(usersPath),config)?.id !== expectedOwnerId) {
    throw Object.assign(new Error('Можно обновить только свои сделки.'),{status:403});
  }
  const records = (await readJson(registryPath)).map(record => normalizeRecord(record)).filter(Boolean);
  const linked = records.find(record => record.registryMeta.bitrix?.dealId === dealId && record.registryMeta.bitrix.domain === domain);
  if (refresh && linked && linked.number !== refresh.number) return {skipped:'link_conflict'};
  const previous = refresh ? records.find(record => record.number === refresh.number) : linked;
  if (previous && expectedOwnerId !== null && previous.ownerId !== expectedOwnerId) throw Object.assign(new Error('Можно обновить только свои сделки.'),{status:403});
  if (refresh && (!previous || existingBitrixId(previous,config) !== dealId)) return {skipped:'link_conflict'};
  const mapped = bitrix.mapSnapshot(snapshot, config, await readJson(usersPath), previous);
  if (mapped.skipped) return mapped;
  const record = normalizeRecord(mapped.record);
  if (previous && previous.ownerId !== record.ownerId) {
    if (refresh) return {skipped:'creator_mismatch'};
    throw Object.assign(new Error("Б24: изменена привязка владельца. Проверьте настройки менеджера."), { status: 409 });
  }
  if (previous?.registryMeta.bitrix && Date.parse(previous.registryMeta.bitrix.modifiedAt) > Date.parse(record.registryMeta.bitrix.modifiedAt)) return { skipped: "stale_snapshot" };
  if (!previous && records.some(item => item.number.toLowerCase() === record.number.toLowerCase())) {
    throw Object.assign(new Error("Номер Б24 уже занят в реестре. Существующая запись сохранена."), { status: 409 });
  }
  const result = {synced:true,number:record.number};
  let audit = oldAudit;
  if (refresh) {
    Object.assign(result,{title:record.registryMeta.title,amount:record.amount,paymentStatus:record.registryMeta.paymentStatus});
    if (!audit) {
      audit = {...refresh,refreshedAt:new Date().toISOString(),previous};
      history.push(audit);
      await writeJson(historyPath,history);
    }
  }
  stampQualification(record, previous);
  await writeJson(registryPath, [record, ...records.filter(item => item.number !== record.number)]);
  if (refresh) { audit.result=result; await writeJson(historyPath,history); }
  return result;
}

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim().split("=").map(decodeURIComponent))
      .filter(([key]) => key),
  );
}

async function currentUser(req) {
  const userId = sessions.get(cookies(req).manager_app_session);
  if (!userId) return null;
  const user = (await readJson(usersPath)).find((item) => item.id === userId);
  return user ? publicUser(user) : null;
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw Object.assign(new Error("Требуется вход в систему."), { status: 401 });
  return user;
}

async function requireAdmin(req) {
  const user = await requireUser(req);
  if (user.role !== "admin") throw Object.assign(new Error("Недостаточно прав."), { status: 403 });
  return user;
}

function recordsForUser(records, users, user) {
  return records
    .filter((record) => user.role === "admin" || record.ownerId === user.id)
    .map((record) => ({
      ...record,
      ownerLogin: users.find((item) => item.id === record.ownerId)?.login || "Удалённый пользователь",
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  if (pathname === "/api/bitrix/events") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Метод не поддерживается." });
    const config = await bitrix.loadConfig(dataDir);
    const dealId = bitrix.authenticate(await bitrix.readEvent(req), config);
    return sendJson(res, 200, dealId ? await syncBitrixDeal(dealId, config) : { skipped: "unsupported_event" });
  }
  if (pathname === '/api/bitrix/recent' && req.method === 'POST') {
    const user = await requireUser(req);
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return sendJson(res,403,{error:'Запрещённый источник запроса.'});
    const body=await readJsonBody(req), config=await bitrix.loadConfig(dataDir), key=cookies(req).manager_app_session;
    if (body.action === 'prepare') {
      const dealIds=await bitrix.recentIds(config,await readJson(usersPath),user,bitrix.createClient(config));
      const batch={runId:crypto.randomUUID(),dealIds,expiresAt:Date.now()+1800000};
      bitrixRecentBatches.set(key,batch);
      return sendJson(res,200,{runId:batch.runId,dealIds});
    }
    const batch=bitrixRecentBatches.get(key), dealId=bitrix.id(body.dealId);
    if (!batch || batch.expiresAt < Date.now() || batch.runId !== body.runId || !batch.dealIds.includes(dealId)) {
      return sendJson(res,403,{error:'Список обновления устарел. Нажмите «Обновить данные с Б24» ещё раз.'});
    }
    const previous=(await readJson(registryPath)).map(r=>normalizeRecord(r)).find(r=>r && r.ownerId===user.id && existingBitrixId(r,config)===dealId);
    const result=previous ? await refreshBitrixRecord({number:previous.number,runId:batch.runId},config,user,user.id)
      : await syncBitrixDeal(dealId,config,null,user.id);
    return sendJson(res,200,result);
  }
  if (pathname === "/api/bitrix/status" && req.method === "GET") {
    await requireAdmin(req);
    return sendJson(res, 200, bitrix.configurationStatus(await bitrix.loadConfig(dataDir), await readJson(usersPath)));
  }
  if (pathname === "/api/bitrix/config" && req.method === "POST") {
    await requireAdmin(req);
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return sendJson(res, 403, { error: "Запрещенный источник запроса." });
    const config = bitrix.updatedConfig(await bitrix.loadConfig(dataDir), await readJsonBody(req));
    await bitrix.saveConfig(dataDir, config);
    return sendJson(res, 200, bitrix.configurationStatus(config, await readJson(usersPath)));
  }
  if (pathname === "/api/bitrix/sync" && req.method === "POST") {
    await requireAdmin(req);
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return sendJson(res, 403, { error: "Запрещенный источник запроса." });
    const body = await readJsonBody(req);
    return sendJson(res, 200, await syncBitrixDeal(bitrix.id(body.dealId), await bitrix.loadConfig(dataDir)));
  }
  if (pathname === '/api/bitrix/refresh' && req.method === 'GET') {
    await requireAdmin(req);
    return sendJson(res,200,(await readJson(registryPath)).map(record=>({number:record.number})));
  }
  if (pathname === '/api/bitrix/refresh' && req.method === 'POST') {
    const admin = await requireAdmin(req);
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return sendJson(res,403,{error:'Запрещённый источник запроса.'});
    return sendJson(res,200,await refreshBitrixRecord(await readJsonBody(req),await bitrix.loadConfig(dataDir),admin));
  }
  if (pathname === "/api/payouts") {
    const user = await requireUser(req);
    const users = await readJson(usersPath);
    if (req.method === "GET") {
      const records = (await readJson(registryPath)).map(record => normalizeRecord(record)).filter(Boolean);
      sendJson(res, 200, buildReport(records, users, await payoutStore.read(), user, url.searchParams,
        (await payoutStore.readDeletions()).map(entry => entry.id)));
      return;
    }
    if (req.method === "DELETE") {
      const admin = await requireAdmin(req);
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw Object.assign(new Error("Запрещённый источник запроса."), { status: 403 });
      const records = (await readJson(registryPath)).map(record => normalizeRecord(record)).filter(Boolean);
      sendJson(res, 200, await payoutStore.remove(await readJsonBody(req), records, users, admin));
      return;
    }
    if (req.method === "POST") {
      const admin = await requireAdmin(req);
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw Object.assign(new Error("Запрещённый источник запроса."), { status: 403 });
      const entry = await payoutStore.append(await readJsonBody(req), users, admin);
      sendJson(res, 200, { saved: true, id: entry.id });
      return;
    }
    sendJson(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, database: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJsonBody(req);
    const user = (await readJson(usersPath)).find((item) => item.login === String(body.login || "").trim());
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      sendJson(res, 401, { error: "Неверный логин или пароль." });
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, user.id);
    sendJson(res, 200, { authenticated: true, user: publicUser(user) }, {
      "Set-Cookie": `manager_app_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = cookies(req).manager_app_session;
    if (token) sessions.delete(token);
    sendJson(res, 200, { authenticated: false }, {
      "Set-Cookie": "manager_app_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/session") {
    const user = await currentUser(req);
    sendJson(res, 200, { authenticated: Boolean(user), user });
    return;
  }

  if (req.method === "POST" && pathname === "/api/dadata/party") {
    await requireUser(req);
    const body = await readJsonBody(req);
    const inn = String(body.query || "").trim();
    if (!/^(?:[0-9]{10}|[0-9]{12})$/.test(inn)) {
      throw Object.assign(new Error("Введите корректный ИНН из 10 или 12 цифр."), { status: 400 });
    }
    const dadataToken = String(process.env.DADATA_API_TOKEN || "").trim();
    if (!dadataToken) {
      throw Object.assign(new Error("Поиск по ИНН временно не настроен."), { status: 503 });
    }
    const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${dadataToken}`,
      },
      body: JSON.stringify({ query: inn }),
    });
    if (!response.ok) {
      console.error(`DaData request failed with status ${response.status}`);
      throw Object.assign(new Error("Не удалось получить данные по ИНН. Заполните реквизиты вручную."), { status: 502 });
    }
    const result = await response.json();
    sendJson(res, 200, { suggestion: Array.isArray(result.suggestions) ? result.suggestions[0] || null : null });
    return;
  }

  if (pathname === "/api/users") {
    const admin = await requireAdmin(req);
    let users = await readJson(usersPath);
    if (req.method === "GET") {
      sendJson(res, 200, users.map(publicUser).sort((a, b) => a.login.localeCompare(b.login)));
      return;
    }
    const body = await readJsonBody(req);
    if (req.method === "POST") {
      const login = String(body.login || "").trim();
      const password = String(body.password || "");
      if (!/^[A-Za-z0-9._-]{3,64}$/.test(login)) throw Object.assign(new Error("Некорректный логин."), { status: 400 });
      if (password.length < 8) throw Object.assign(new Error("Пароль должен содержать не менее 8 символов."), { status: 400 });
      if (users.some((user) => user.login.toLowerCase() === login.toLowerCase())) {
        throw Object.assign(new Error("Пользователь с таким логином уже существует."), { status: 409 });
      }
      users.push({
        id: Math.max(0, ...users.map((user) => user.id)) + 1,
        login,
        fullName: fullName(body.fullName),
        phone: userContact(body.phone, "phone"),
        email: userContact(body.email, "email"),
        passwordHash: hashPassword(password),
        role: body.role === "admin" ? "admin" : "user",
        createdAt: new Date().toISOString(),
      });
      await writeJson(usersPath, users);
      sendJson(res, 201, users.map(publicUser).sort((a, b) => a.login.localeCompare(b.login)));
      return;
    }
    const target = users.find((user) => user.id === Number(body.id));
    if (!target) throw Object.assign(new Error("Пользователь не найден."), { status: 404 });
    if (req.method === "PUT") {
      if (body.action === "profile") {
        const profile = {
          fullName: Object.hasOwn(body, "fullName") ? fullName(body.fullName) : target.fullName || "",
          phone: Object.hasOwn(body, "phone") ? userContact(body.phone, "phone") : target.phone || "",
          email: Object.hasOwn(body, "email") ? userContact(body.email, "email") : target.email || "",
        };
        Object.assign(target, profile);
        await writeJson(usersPath, users);
        sendJson(res, 200, users.map(publicUser).sort((a, b) => a.login.localeCompare(b.login)));
        return;
      }
      if (body.action === "password") {
        const password = String(body.password || "");
        if (password.length < 8) {
          throw Object.assign(new Error("Пароль должен содержать не менее 8 символов."), { status: 400 });
        }
        target.passwordHash = hashPassword(password);
        await writeJson(usersPath, users);
        sendJson(res, 200, users.map(publicUser).sort((a, b) => a.login.localeCompare(b.login)));
        return;
      }
      const nextRole = body.role === "admin" ? "admin" : "user";
      if (target.role === "admin" && nextRole !== "admin" && users.filter((user) => user.role === "admin").length <= 1) {
        throw Object.assign(new Error("Нельзя снять права у последнего администратора."), { status: 409 });
      }
      target.role = nextRole;
      await writeJson(usersPath, users);
      sendJson(res, 200, users.map(publicUser).sort((a, b) => a.login.localeCompare(b.login)));
      return;
    }
    if (req.method === "DELETE") {
      if (target.id === admin.id) throw Object.assign(new Error("Нельзя удалить текущую учётную запись."), { status: 409 });
      if (target.role === "admin" && users.filter((user) => user.role === "admin").length <= 1) {
        throw Object.assign(new Error("Нельзя удалить последнего администратора."), { status: 409 });
      }
      users = users.filter((user) => user.id !== target.id);
      await writeJson(usersPath, users);
      sendJson(res, 200, users.map(publicUser).sort((a, b) => a.login.localeCompare(b.login)));
      return;
    }
  }

  if (pathname === "/api/contracts-registry") {
    const user = await requireUser(req);
    const users = await readJson(usersPath);
    let records = (await readJson(registryPath)).map((record) => normalizeRecord(record)).filter(Boolean);
    if (req.method === "GET") {
      const visibleRecords = recordsForUser(records, users, user);
      const number = String(url.searchParams.get("number") || "").trim();
      if (number) {
        const record = visibleRecords.find((item) => item.number === number);
        if (!record) throw Object.assign(new Error("Договор не найден в реестре."), { status: 404 });
        sendJson(res, 200, record);
        return;
      }
      sendJson(res, 200, visibleRecords.map((record) => ({ ...record, data: {} })));
      return;
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (body.action === "update-meta") {
        const number = String(body.number || "").trim();
        const existing = records.find((record) => record.number === number);
        if (!existing) throw Object.assign(new Error("Договор не найден в реестре."), { status: 404 });
        if (user.role !== "admin" && existing.ownerId !== user.id) {
          throw Object.assign(new Error("Нельзя изменить договор другого пользователя."), { status: 403 });
        }
        const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
        const updated = applyRegistryFields(existing,fields,user,users);
        Object.assign(existing,updated);
        await writeJson(registryPath, records);
        sendJson(res, 200, { record: recordsForUser([existing],users,user)[0] });
        return;
      }
      if (body.action === "delete") {
        const removed = records.find(record => record.number === String(body.number || "").trim() && (user.role === "admin" || record.ownerId === user.id));
        if (removed?.registryMeta.bitrix) {
          const file = path.join(dataDir, "bitrix-deleted.json");
          const deleted = await readJson(file);
          const external = removed.registryMeta.bitrix;
          await writeJson(file, [...new Set([...deleted, `${external.domain}:${external.dealId}`])]);
        }
        records = records.filter(
          (record) => record.number !== String(body.number || "").trim() || (user.role !== "admin" && record.ownerId !== user.id),
        );
        await writeJson(registryPath, records);
        sendJson(res, 200, recordsForUser(records, users, user));
        return;
      }
      const incoming = normalizeRecord(body.record, user.id);
      if (!incoming) throw Object.assign(new Error("Для записи нужен номер договора или черновика."), { status: 400 });
      const existing = records.find((record) => record.number === incoming.number);
      if (existing && user.role !== "admin" && existing.ownerId !== user.id) {
        throw Object.assign(new Error("Нельзя изменить договор другого пользователя."), { status: 403 });
      }
      incoming.ownerId = existing?.ownerId || user.id;
      if (existing && body.preserveRegistryMeta !== false) {
        incoming.registryMeta = {
          ...existing.registryMeta,
          prepayment: existing.registryMeta.prepaymentOverridden
            ? existing.registryMeta.prepayment
            : templatePrepayment(incoming.data, incoming.amount),
        };
      }
      if (incoming.status==='exported' && incoming.registryMeta.paymentType!=='Наличка' && invoicePaymentType(incoming.data)) incoming.registryMeta.paymentType=invoicePaymentType(incoming.data);
      bitrix.preserveCrmFields(incoming, existing);
      assertPaidStatusHasNoRemainder(incoming.registryMeta, incoming.amount);
      stampQualification(incoming, existing);
      records = [incoming, ...records.filter((record) => record.number !== incoming.number)];
      await writeJson(registryPath, records);
      sendJson(res, 200, { saved: true });
      return;
    }
  }

  if (pathname === "/api/tech-presets") {
    if (req.method === "GET") {
      await requireUser(req);
      sendJson(res, 200, normalizePresets(await readJson(presetsPath)));
      return;
    }
    if (req.method === "PUT") {
      await requireAdmin(req);
      const presets = normalizePresets(await readJsonBody(req));
      if (!presets.length) throw Object.assign(new Error("Справочник не может быть пустым."), { status: 400 });
      const titles = presets.map((preset) => preset.title.toLocaleLowerCase("ru"));
      if (new Set(titles).size !== titles.length) throw Object.assign(new Error("Названия шаблонов не должны повторяться."), { status: 400 });
      await writeJson(presetsPath, presets);
      sendJson(res, 200, presets);
      return;
    }
  }

  sendJson(res, 404, { error: "Метод или адрес API не найден." });
}

async function handleStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.resolve(rootDir, `.${cleanPath}`);
  if (
    !filePath.startsWith(rootDir) ||
    cleanPath.includes("/.") ||
    (process.env.BITRIX_CONFIG_FILE && filePath === path.resolve(process.env.BITRIX_CONFIG_FILE)) ||
    ["/server.js", "/package.json", "/templates/contracts-registry.json"].includes(cleanPath)
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const body = await fs.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    await ensureData();
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method) && url.pathname !== "/api/payouts") await serializeMutation(() => handleApi(req, res, url));
      else await handleApi(req, res, url);
    }
    else await handleStatic(req, res, url.pathname);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    console.error(error);
    sendJson(res, error.status || 500, { error: error.message || "Серверная ошибка." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Manager app: http://127.0.0.1:${server.address().port}`);
});
