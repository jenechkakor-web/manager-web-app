const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const rootDir = __dirname;
const presetsPath = path.join(rootDir, "templates", "tech-presets.json");
const port = Number(process.env.PORT || 4173);
const adminLogin = process.env.ADMIN_LOGIN || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin2026";
const sessions = new Set();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizePresets(source) {
  return (Array.isArray(source) ? source : [])
    .map((entry) => ({
      group: String(entry.group || entry.category || "Общее").trim(),
      subgroup: String(entry.subgroup || entry.subcategory || "Без подгруппы").trim(),
      title: String(entry.title || "").trim(),
      description: String(entry.description || "").trim(),
    }))
    .filter((entry) => entry.title && entry.description)
    .map((entry) => ({
      ...entry,
      group: entry.group || "Общее",
      subgroup: entry.subgroup || "Без подгруппы",
    }));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Payload too large");
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function readPresets() {
  const raw = await fs.readFile(presetsPath, "utf8");
  return normalizePresets(JSON.parse(raw));
}

async function writePresets(presets) {
  await fs.mkdir(path.dirname(presetsPath), { recursive: true });
  await fs.writeFile(presetsPath, `${JSON.stringify(presets, null, 2)}\n`, "utf8");
}

function hasAdminAccess(req) {
  const [, token] = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/) || [];
  return Boolean(token && sessions.has(token));
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/tech-presets") {
    sendJson(res, 200, await readPresets());
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    const body = await readJsonBody(req);
    if (body.login !== adminLogin || body.password !== adminPassword) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    sendJson(res, 200, { token });
    return;
  }

  if (req.method === "PUT" && pathname === "/api/tech-presets") {
    if (!hasAdminAccess(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const presets = normalizePresets(await readJsonBody(req));
    if (!presets.length) {
      sendJson(res, 400, { error: "Preset list is empty" });
      return;
    }

    const lowerTitles = presets.map((preset) => preset.title.toLowerCase());
    if (new Set(lowerTitles).size !== lowerTitles.length) {
      sendJson(res, 400, { error: "Duplicate titles" });
      return;
    }

    await writePresets(presets);
    sendJson(res, 200, presets);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handleStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.resolve(rootDir, `.${cleanPath}`);

  if (
    !filePath.startsWith(rootDir) ||
    cleanPath.includes("/.") ||
    ["/server.js", "/package.json"].includes(cleanPath)
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const body = await fs.readFile(filePath);
  res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${port}`}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }

    await handleStatic(req, res, url.pathname);
  } catch (error) {
    const status = error.code === "ENOENT" ? 404 : 500;
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(status === 404 ? "Not found" : "Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Manager app: http://127.0.0.1:${port}/`);
});
