(() => {
  const GITHUB_OWNER = "jenechkakor-web";
  const GITHUB_REPO = "manager-web-app";
  const GITHUB_BRANCH = "main";
  const GITHUB_REGISTRY_PATH = "templates/contracts-registry.json";
  const GITHUB_RAW_REGISTRY_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${GITHUB_REGISTRY_PATH}`;
  const GITHUB_CONTENTS_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_REGISTRY_PATH}`;
  const LOCAL_KEY = "managerContractsRegistry";
  const SELECTED_CONTRACT_KEY = "managerContractFromRegistry";
  const TOKEN_KEY = "contractRegistryGitHubToken";

  function normalizeContractNumber(value) {
    return String(value || "").trim();
  }

  function normalizeStatus(value) {
    return value === "exported" ? "exported" : "draft";
  }

  function normalizeRecord(record) {
    const number = normalizeContractNumber(record?.number || record?.contractNumber || record?.data?.contractNumber);
    if (!number) return null;
    const data = record.data && typeof record.data === "object" ? record.data : {};
    const amount = Number(record.amount ?? data.totals?.grandTotal ?? 0);
    return {
      number,
      date: String(record.date || data.contractDate || ""),
      counterparty: String(record.counterparty || data.customer?.name || data.customer?.inn || ""),
      amount: Number.isFinite(amount) ? amount : 0,
      status: normalizeStatus(record.status),
      updatedAt: String(record.updatedAt || new Date().toISOString()),
      data,
    };
  }

  function normalizeRecords(source) {
    return (Array.isArray(source) ? source : [])
      .map(normalizeRecord)
      .filter(Boolean);
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

  function getLocalRecords() {
    try {
      return normalizeRecords(JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"));
    } catch {
      return [];
    }
  }

  function setLocalRecords(records) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(normalizeRecords(records)));
  }

  function upsertInto(records, record) {
    const normalized = normalizeRecord(record);
    if (!normalized) return normalizeRecords(records);
    return mergeRecords([normalized], removeFrom(records, normalized.number));
  }

  function removeFrom(records, number) {
    const key = normalizeContractNumber(number).toLowerCase();
    return normalizeRecords(records).filter((record) => record.number.toLowerCase() !== key);
  }

  function cacheBusted(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${Date.now()}`;
  }

  function isLocalAppServer() {
    return ["127.0.0.1", "localhost"].includes(window.location.hostname);
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async function loadGitHubRegistry(token = "") {
    const response = await fetch(`${GITHUB_CONTENTS_API_URL}?ref=${GITHUB_BRANCH}`, {
      headers: githubHeaders(token),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Не удалось прочитать реестр на GitHub.");
    const file = await response.json();
    const records = normalizeRecords(JSON.parse(base64ToUtf8(file.content) || "[]"));
    return { records, sha: file.sha };
  }

  async function loadPublicRegistrySources() {
    const endpoints = [cacheBusted(`templates/contracts-registry.json`), cacheBusted(GITHUB_RAW_REGISTRY_URL)];
    if (isLocalAppServer()) endpoints.unshift(cacheBusted("/api/contracts-registry"));

    const sources = [];
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) continue;
        sources.push(normalizeRecords(await response.json()));
      } catch {
        // Try the next source.
      }
    }
    return sources;
  }

  async function loadRegistry(options = {}) {
    const token = options.token || registryToken();
    const sources = [getLocalRecords()];

    if (token) {
      try {
        const github = await loadGitHubRegistry(token);
        sources.push(github.records);
      } catch {
        sources.push(...(await loadPublicRegistrySources()));
      }
    } else {
      sources.push(...(await loadPublicRegistrySources()));
    }

    const records = mergeRecords(...sources);
    setLocalRecords(records);
    return records;
  }

  async function saveGitHubRegistry(records, token) {
    let sha = "";
    try {
      const github = await loadGitHubRegistry(token);
      sha = github.sha;
    } catch {
      sha = "";
    }

    const content = `${JSON.stringify(normalizeRecords(records), null, 2)}\n`;
    const response = await fetch(GITHUB_CONTENTS_API_URL, {
      method: "PUT",
      headers: {
        ...githubHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Update contracts registry",
        content: utf8ToBase64(content),
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.message || "Не удалось сохранить реестр на GitHub.");
    }
  }

  async function upsertRecord(record, options = {}) {
    const normalized = normalizeRecord(record);
    if (!normalized) throw new Error("Для записи в реестр нужен номер договора.");

    const localRecords = upsertInto(getLocalRecords(), normalized);
    setLocalRecords(localRecords);

    const token = options.token || registryToken();
    if (!token) return { records: localRecords, remoteSaved: false };

    const records = upsertInto(await loadRegistry({ token }), normalized);
    await saveGitHubRegistry(records, token);
    setLocalRecords(records);
    return { records, remoteSaved: true };
  }

  async function deleteRecord(number, options = {}) {
    const localRecords = removeFrom(getLocalRecords(), number);
    setLocalRecords(localRecords);

    const token = options.token || registryToken();
    if (!token) return { records: localRecords, remoteSaved: false };

    const records = removeFrom(await loadRegistry({ token }), number);
    await saveGitHubRegistry(records, token);
    setLocalRecords(records);
    return { records, remoteSaved: true };
  }

  function recordFromContractData(data, status) {
    const number = normalizeContractNumber(data?.contractNumber);
    if (!number) return null;
    const amount = Number(data?.totals?.grandTotal ?? 0);
    return normalizeRecord({
      number,
      date: data.contractDate,
      counterparty: data.customer?.name || data.customer?.inn || "",
      amount: Number.isFinite(amount) ? amount : 0,
      status,
      updatedAt: new Date().toISOString(),
      data,
    });
  }

  function registryToken() {
    return localStorage.getItem(TOKEN_KEY) || localStorage.getItem("techGitHubToken") || "";
  }

  function setRegistryToken(token) {
    localStorage.setItem(TOKEN_KEY, token || "");
  }

  function setContractToOpen(data) {
    localStorage.setItem(SELECTED_CONTRACT_KEY, JSON.stringify(data || {}));
  }

  function getContractToOpen() {
    const raw = localStorage.getItem(SELECTED_CONTRACT_KEY);
    if (!raw) return null;
    localStorage.removeItem(SELECTED_CONTRACT_KEY);
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  window.ContractRegistry = {
    TOKEN_KEY,
    LOCAL_KEY,
    SELECTED_CONTRACT_KEY,
    normalizeRecords,
    mergeRecords,
    getLocalRecords,
    setLocalRecords,
    loadRegistry,
    upsertRecord,
    deleteRecord,
    recordFromContractData,
    registryToken,
    setRegistryToken,
    setContractToOpen,
    getContractToOpen,
  };
})();
