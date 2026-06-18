(function () {
  const SERVER_REGISTRY_URL = "/api/contracts-registry";
  const LOCAL_KEY = "managerContractsRegistry";
  const SELECTED_CONTRACT_KEY = "managerContractFromRegistry";

  function normalizeContractNumber(value) {
    return String(value || "").trim();
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
      status: record.status === "exported" ? "exported" : "draft",
      updatedAt: String(record.updatedAt || new Date().toISOString()),
      ownerLogin: String(record.ownerLogin || ""),
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
      if (!current || new Date(record.updatedAt) >= new Date(current.updatedAt)) map.set(key, record);
    });
    return [...map.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function localKey() {
    return window.ManagerAuth?.storageKey(LOCAL_KEY) || LOCAL_KEY;
  }

  function getLocalRecords() {
    try {
      return normalizeRecords(JSON.parse(localStorage.getItem(localKey()) || "[]"));
    } catch {
      return [];
    }
  }

  function setLocalRecords(records) {
    if (window.ManagerAuth?.usesServerAuth) return;
    localStorage.setItem(localKey(), JSON.stringify(normalizeRecords(records)));
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

  async function serverRequest(options = {}) {
    const response = await fetch(SERVER_REGISTRY_URL, { cache: "no-store", ...options });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace("login.html");
      throw new Error("Требуется вход в систему.");
    }
    if (!response.ok) throw new Error(result.error || "Не удалось обновить общий реестр.");
    return result;
  }

  async function loadRegistry() {
    await window.ManagerAuth?.ready;
    if (!window.ManagerAuth?.usesServerAuth) return getLocalRecords();
    return normalizeRecords(await serverRequest());
  }

  async function upsertRecord(record) {
    const normalized = normalizeRecord(record);
    if (!normalized) throw new Error("Для записи в реестр нужен номер договора.");
    if (!window.ManagerAuth?.usesServerAuth) {
      const records = upsertInto(getLocalRecords(), normalized);
      setLocalRecords(records);
      return { records, remoteSaved: false };
    }
    await serverRequest({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert", record: normalized }),
    });
    return { records: [], remoteSaved: true };
  }

  async function deleteRecord(number) {
    if (!window.ManagerAuth?.usesServerAuth) {
      const records = removeFrom(getLocalRecords(), number);
      setLocalRecords(records);
      return { records, remoteSaved: false };
    }
    const records = await serverRequest({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", number }),
    });
    return { records: normalizeRecords(records), remoteSaved: true };
  }

  function recordFromContractData(data, status, options = {}) {
    const number = normalizeContractNumber(options.number || data?.contractNumber);
    if (!number) return null;
    return normalizeRecord({
      number,
      date: data.contractDate,
      counterparty: data.customer?.name || data.customer?.inn || "",
      amount: Number(data?.totals?.grandTotal ?? 0),
      status,
      updatedAt: new Date().toISOString(),
      data,
    });
  }

  function setContractToOpen(data) {
    sessionStorage.setItem(SELECTED_CONTRACT_KEY, JSON.stringify(data || {}));
  }

  function getContractToOpen() {
    const raw = sessionStorage.getItem(SELECTED_CONTRACT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SELECTED_CONTRACT_KEY);
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  window.ContractRegistry = {
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
    setContractToOpen,
    getContractToOpen,
  };
})();
