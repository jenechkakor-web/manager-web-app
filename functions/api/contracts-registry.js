const GITHUB_OWNER = "jenechkakor-web";
const GITHUB_REPO = "manager-web-app";
const GITHUB_BRANCH = "main";
const GITHUB_REGISTRY_PATH = "templates/contracts-registry.json";
const GITHUB_CONTENTS_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_REGISTRY_PATH}`;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeContractNumber(value) {
  return String(value || "").trim();
}

function normalizeRecord(record) {
  const data = record?.data && typeof record.data === "object" ? record.data : {};
  const number = normalizeContractNumber(record?.number || record?.contractNumber || data.contractNumber);
  if (!number) return null;
  const amount = Number(record.amount ?? data.totals?.grandTotal ?? 0);
  return {
    number,
    date: String(record.date || data.contractDate || ""),
    counterparty: String(record.counterparty || data.customer?.name || data.customer?.inn || ""),
    amount: Number.isFinite(amount) ? amount : 0,
    status: record.status === "exported" ? "exported" : "draft",
    updatedAt: String(record.updatedAt || new Date().toISOString()),
    data,
  };
}

function normalizeRecords(source) {
  return (Array.isArray(source) ? source : []).map(normalizeRecord).filter(Boolean);
}

function mergeRecords(...sources) {
  const map = new Map();
  sources.flatMap(normalizeRecords).forEach((record) => {
    const key = record.number.toLowerCase();
    const current = map.get(key);
    if (!current || new Date(record.updatedAt) >= new Date(current.updatedAt)) {
      map.set(key, record);
    }
  });
  return [...map.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function removeFrom(records, number) {
  const key = normalizeContractNumber(number).toLowerCase();
  return normalizeRecords(records).filter((record) => record.number.toLowerCase() !== key);
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function githubHeaders(token = "") {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "manager-web-app-cloudflare-pages",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function loadGitHubRegistry(token = "") {
  const response = await fetch(`${GITHUB_CONTENTS_API_URL}?ref=${GITHUB_BRANCH}`, {
    headers: githubHeaders(token),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("GitHub registry read failed.");
  const file = await response.json();
  return {
    records: normalizeRecords(JSON.parse(base64ToUtf8(file.content) || "[]")),
    sha: file.sha,
  };
}

async function saveGitHubRegistry(records, sha, token) {
  const response = await fetch(GITHUB_CONTENTS_API_URL, {
    method: "PUT",
    headers: {
      ...githubHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "Update contracts registry",
      content: utf8ToBase64(`${JSON.stringify(normalizeRecords(records), null, 2)}\n`),
      branch: GITHUB_BRANCH,
      sha,
    }),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.message || "GitHub registry write failed.");
  }
}

function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return new URL(origin).host === new URL(request.url).host;
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({});

  if (request.method === "GET") {
    const token = env.GITHUB_TOKEN || env.GH_TOKEN || "";
    const github = await loadGitHubRegistry(token);
    return json(github.records);
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!assertSameOrigin(request)) return json({ error: "Forbidden origin" }, 403);

  const token = env.GITHUB_TOKEN || env.GH_TOKEN || "";
  if (!token) {
    return json({ error: "Cloudflare variable GITHUB_TOKEN is not configured" }, 501);
  }

  const payload = await request.json().catch(() => ({}));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const github = await loadGitHubRegistry(token);
    const records =
      payload.action === "delete"
        ? removeFrom(github.records, payload.number)
        : mergeRecords(github.records, [payload.record]);

    try {
      await saveGitHubRegistry(records, github.sha, token);
      return json(records);
    } catch (error) {
      if (!String(error.message || "").includes("sha") || attempt === 2) {
        return json({ error: error.message || "Registry update failed" }, 500);
      }
    }
  }

  return json({ error: "Registry update failed" }, 500);
}
