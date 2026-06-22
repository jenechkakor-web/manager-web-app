const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const rootDir = __dirname;
const dataDir = path.join(rootDir, ".data");
const usersPath = path.join(dataDir, "users.json");
const presetsPath = path.join(dataDir, "tech-presets.json");
const registryPath = path.join(dataDir, "contracts-registry.json");
const port = Number(process.env.PORT || 4173);
const adminLogin = process.env.ADMIN_LOGIN || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin2026";
const sessions = new Map();

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
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  return { id: Number(user.id), login: user.login, role: user.role === "admin" ? "admin" : "user", createdAt: user.createdAt };
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

async function handleApi(req, res, pathname) {
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
      sendJson(res, 200, recordsForUser(records, users, user));
      return;
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (body.action === "delete") {
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
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url.pathname);
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
  console.log(`Manager app: http://127.0.0.1:${port}`);
});
