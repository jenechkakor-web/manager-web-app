const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const rules = require('./bitrix-rules.json');
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const label = value => String(value || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru').replaceAll('ё', 'е');
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const id = value => /^[1-9]\d{0,17}$/.test(text(value)) ? text(value) : '';
const money = value => {
  const raw = text(value).split('|')[0].replace(/[\s\u00a0]/gu, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw fail('Б24: некорректная денежная сумма.');
  const result = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(result) || result > 9999999999999.99) throw fail('Б24: сумма вне допустимого диапазона.');
  return result;
};

function stageStatus(name) {
  return Object.entries(rules.stages).find(([, names]) => names.some(item => label(item) === label(name)))?.[0] || '';
}

function resolveManager(creator, users, config) {
  const fullName = label(`${text(creator.NAME)} ${text(creator.LAST_NAME)}`);
  const allowedName = rules.managers.find(name => label(name) === fullName);
  if (!allowedName) return null;
  const binding = config.managers?.[allowedName];
  const login = typeof binding === 'string' ? binding : binding?.login;
  if (binding?.bitrixId && text(binding.bitrixId) !== id(creator.ID)) return null;
  const matches = users.filter(user => login ? label(user.login) === label(login) : label(user.fullName) === fullName);
  return matches.length === 1 ? matches[0] : null;
}

function endpoint(config) {
  let url;
  try { url = new URL(config.webhookUrl); } catch { throw fail('Подключение Б24 не настроено.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !/\/rest\/[1-9]\d*\/[A-Za-z0-9_-]+\/$/.test(url.pathname)) {
    throw fail('Б24: требуется HTTPS-адрес входящего вебхука /rest/ID/TOKEN/.', 503);
  }
  return url;
}

function authenticate(body, config) {
  const url = endpoint(config);
  const expected = text(config.eventToken);
  if (!expected) throw fail('Токен исходящего вебхука Б24 не настроен.', 503);
  const actual = text(body.auth?.application_token);
  const equal = crypto.timingSafeEqual(crypto.createHash('sha256').update(actual).digest(), crypto.createHash('sha256').update(expected).digest());
  if (!equal || label(body.auth?.domain) !== url.hostname.toLowerCase()
      || (config.memberId && text(body.auth?.member_id) !== text(config.memberId))) throw fail('Недействительная подпись события Б24.', 403);
  if (!['ONCRMDEALADD', 'ONCRMDEALUPDATE'].includes(body.event)) return null;
  const dealId = id(body.data?.FIELDS?.ID);
  if (!dealId) throw fail('Б24: некорректный ID сделки.', 400);
  return dealId;
}

async function readEvent(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw fail('Слишком большое событие Б24.', 413);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/json') {
    try {
      const body = JSON.parse(raw);
      if (body && typeof body === 'object' && !Array.isArray(body)) return body;
    } catch {}
    throw fail('Некорректный JSON события Б24.', 400);
  }
  if (type !== 'application/x-www-form-urlencoded') throw fail('Неподдерживаемый формат события Б24.', 415);
  const form = new URLSearchParams(raw);
  return { event: form.get('event'), data: { FIELDS: { ID: form.get('data[FIELDS][ID]') } },
    auth: { application_token: form.get('auth[application_token]'), domain: form.get('auth[domain]'), member_id: form.get('auth[member_id]') } };
}

function createClient(config, fetcher = fetch) {
  const base = endpoint(config);
  return async (method, params) => {
    let response, result;
    try {
      response = await fetcher(new URL(`${method}.json`, base), { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(12000) });
      result = await response.json();
    } catch { throw fail('Б24 временно недоступен. Повторите синхронизацию.'); }
    if (!response.ok || !result || result.error || !Object.hasOwn(result, 'result')) {
      // Never return or log remote error descriptions, URLs or credentials.
      throw fail(`Б24: не удалось выполнить ${method}. Проверьте права вебхука.`);
    }
    return result.result;
  };
}

async function fetchSnapshot(dealId, config, call) {
  const deal = await call('crm.deal.get', { id: dealId });
  if (id(deal?.ID) !== dealId || !id(deal.CREATED_BY_ID)) throw fail('Б24: неполная карточка сделки.');
  const creators = await call('user.get', { ID: deal.CREATED_BY_ID });
  const creator = Array.isArray(creators) ? creators.find(user => id(user.ID) === id(deal.CREATED_BY_ID)) : null;
  if (!creator) throw fail('Б24: создатель сделки недоступен.');
  let source = '';
  if (text(deal.SOURCE_ID)) {
    const sources = await call('crm.status.list', { filter: { ENTITY_ID: 'SOURCE', STATUS_ID: deal.SOURCE_ID } });
    const entry = Array.isArray(sources) ? sources.find(item => item.STATUS_ID === deal.SOURCE_ID) : null;
    if (!entry) throw fail('Б24: источник сделки недоступен.');
    source = text(entry.NAME);
  }
  return { deal, creator, source };
}

function mapSnapshot(snapshot, config, users, previous = null) {
  const { deal, creator, source } = snapshot;
  const manager = resolveManager(creator, users, config);
  if (!manager) return { skipped: 'manager_not_allowed_or_unmapped' };
  const currency = text(deal.CURRENCY_ID);
  if (currency !== 'RUB' && currency !== 'RUR') throw fail('Б24: реестр поддерживает только суммы в рублях.', 409);
  const amount = money(deal.OPPORTUNITY);
  const date = previous?.date ?? new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Moscow'}).format(new Date());
  const modifiedAt = text(deal.DATE_MODIFY);
  if (!Number.isFinite(Date.parse(modifiedAt))) throw fail('Б24: некорректная дата изменения.');
  const paid = Number(previous?.registryMeta?.prepayment) || 0;
  if (paid > amount || (previous?.registryMeta?.paymentStatus === 'Да' && paid < amount)) {
    throw fail('Сумма Б24 противоречит оплате в реестре. Проверьте сумму и предоплату вручную.', 409);
  }
  const number = text(config.numberField ? deal[config.numberField] : deal.ID);
  if (!number || number.length > 191) throw fail('Б24: номер сделки отсутствует или слишком длинный.');
  const registryMeta = { paymentStatus:'Планируется', prepayment:0, prepaymentOverridden:true, ...(previous?.registryMeta || {}), title: text(deal.TITLE),
    source: text(config.sourceMap?.[deal.SOURCE_ID] || source),
    bitrix: { dealId: id(deal.ID), domain: endpoint(config).hostname, creatorId: id(deal.CREATED_BY_ID),
      modifiedAt, number } };
  return { record: { ...(previous || {}), number: previous?.number || number, ownerId: manager.id, date, amount, registryMeta,
    data: previous?.data || {}, updatedAt: new Date().toISOString() } };
}

function preserveCrmFields(incoming, previous) {
  delete incoming.registryMeta.bitrix;
  if (!previous?.registryMeta?.bitrix) return incoming;
  incoming.number = previous.number;
  incoming.registryMeta.bitrix = previous.registryMeta.bitrix;
  return incoming;
}

async function recentIds(config, users, user, call) {
  const names = rules.managers.filter(name => {
    const binding = config.managers?.[name], login = typeof binding === 'string' ? binding : binding?.login;
    return login ? label(login) === label(user.login) : label(name) === label(user.fullName);
  });
  if (names.length !== 1) throw fail('Ваше ФИО не связано с менеджером Б24. Обратитесь к администратору.', 409);
  const [NAME, LAST_NAME] = names[0].split(' ');
  const people = await call('user.get', {FILTER:{NAME,LAST_NAME}});
  const creators = [...new Set((Array.isArray(people) ? people : [])
    .filter(person => resolveManager(person,users,config)?.id === user.id).map(person=>id(person.ID)).filter(Boolean))];
  if (creators.length !== 1) throw fail('Не удалось однозначно найти вашего сотрудника в Б24.',409);
  const creator = creators[0];
  const rows = await call('crm.deal.list',{filter:{CREATED_BY_ID:creator},order:{DATE_CREATE:'DESC',ID:'DESC'},select:['ID','CREATED_BY_ID','DATE_CREATE'],start:0});
  if (!Array.isArray(rows)) throw fail('Б24: не удалось получить последние сделки.');
  const ids=[];
  for (const row of rows) {
    if (!id(row.ID) || id(row.CREATED_BY_ID) !== creator) throw fail('Б24 вернул сделку другого создателя. Обновление остановлено.',409);
    if (!ids.includes(id(row.ID))) ids.push(id(row.ID));
    if (ids.length === 5) break;
  }
  return ids;
}
function configFile(dataDir) { return process.env.BITRIX_CONFIG_FILE || path.join(dataDir, 'bitrix.local.json'); }
async function loadConfig(dataDir) {
  try { return JSON.parse(await fs.readFile(configFile(dataDir), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw fail('Не удалось прочитать закрытую конфигурацию Б24.', 503); }
}

function updatedConfig(previous, body) {
  const config = {...previous};
  for (const key of ['webhookUrl','eventToken','paidAmountField','fullPaymentField','numberField']) {
    if (!Object.hasOwn(body,key)) continue;
    if (typeof body[key] !== 'string' || body[key].length > 2048) throw fail('Некорректные настройки Б24.',400);
    if (['webhookUrl','eventToken'].includes(key) && !body[key].trim()) continue;
    config[key] = body[key].trim();
  }
  endpoint(config);
  if (!text(config.eventToken)) throw fail('Укажите токен исходящего вебхука.',400);
  for (const key of ['paidAmountField','fullPaymentField','numberField']) {
    if (config[key] && !/^[A-Z][A-Z0-9_]{0,100}$/.test(config[key])) throw fail('Некорректный код поля Б24.',400);
  }
  return config;
}

async function saveConfig(dataDir, config) {
  const file = configFile(dataDir), temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(temporary,JSON.stringify(config),{mode:0o600});
  await fs.rename(temporary,file);
}

function configurationStatus(config, users) {
  let configured = false;
  try { endpoint(config); configured = Boolean(text(config.eventToken)); } catch {}
  return { configured, domain: configured ? endpoint(config).hostname : '',
    paidAmountField: config.paidAmountField || '', fullPaymentField: config.fullPaymentField || '', numberField: config.numberField || '',
    paymentConfigured: Boolean(config.paidAmountField || config.fullPaymentField),
    managers: rules.managers.map(name => {
      const binding = config.managers?.[name];
      const configuredLogin = typeof binding === 'string' ? binding : binding?.login;
      const matches = users.filter(user => configuredLogin ? label(user.login) === label(configuredLogin) : label(user.fullName) === label(name));
      return { name, login: matches.length === 1 ? matches[0].login : '', linked: matches.length === 1 };
    }) };
}

module.exports = { rules, stageStatus, resolveManager, authenticate, readEvent, createClient, fetchSnapshot, recentIds,
  mapSnapshot, preserveCrmFields, loadConfig, saveConfig, updatedConfig, configurationStatus, endpoint, id };
