(function () {
  const SERVER_REGISTRY_URL = "/api/contracts-registry";
  const LOCAL_KEY = "managerContractsRegistry";
  const SELECTED_CONTRACT_KEY = "managerContractFromRegistry";
  const SOURCE_OPTIONS = ["Директ", "Агент", "Повтор", "Сарафан", "Авито", "Парсинг", "SEO", "Профи.ру"];
  const PAYMENT_STATUS_OPTIONS = ["Да", "Предоплата", "Планируется"];
  const PAYMENT_TYPE_OPTIONS = ["ИП", "ООО", "Наличка"];
  const CLOSING_DOCS_OPTIONS = ["Отправлены", "Не отправлены", "Не нужно"];
  const BONUS_TYPE_OPTIONS = ["12%", "10%", "7%", "5%", "4%", "3%", "от прибыли", "оклад"];

  function normalizeContractNumber(value) {
    return String(value || "").trim();
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function choice(value, options, fallback) {
    return options.includes(value) ? value : fallback;
  }

  function templatePrepayment(data, amount) {
    const percent = Number(data?.paymentTerms);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return 0;
    return roundMoney((amount * percent) / 100);
  }

  function normalizeRegistryMeta(record, data, amount) {
    const source = record?.registryMeta && typeof record.registryMeta === "object" ? record.registryMeta : record || {};
    const rawPrepayment = source.prepayment;
    const prepayment = rawPrepayment === undefined || rawPrepayment === null || rawPrepayment === ""
      ? templatePrepayment(data, amount)
      : roundMoney(Math.max(0, Math.min(amount, Number(rawPrepayment) || 0)));
    return {
      title: String(source.title || "").trim(),
      source: choice(source.source, SOURCE_OPTIONS, ""),
      paymentStatus: choice(source.paymentStatus, PAYMENT_STATUS_OPTIONS, "Планируется"),
      prepayment,
      prepaymentOverridden: source.prepaymentOverridden === true,
      paymentType: choice(source.paymentType, PAYMENT_TYPE_OPTIONS, ""),
      closingDocs: choice(source.closingDocs, CLOSING_DOCS_OPTIONS, "Не отправлены"),
      bonusType: choice(source.bonusType, BONUS_TYPE_OPTIONS, "12%"),
      bonusAmount: roundMoney(Math.max(0, Number(source.bonusAmount) || 0)),
    };
  }

  function normalizeRecord(record) {
    const number = normalizeContractNumber(record?.number || record?.contractNumber || record?.data?.contractNumber);
    if (!number) return null;
    const data = record.data && typeof record.data === "object" ? record.data : {};
    const amount = Number(record.amount ?? data.totals?.grandTotal ?? 0);
    const normalizedAmount = Number.isFinite(amount) ? amount : 0;
    return {
      number,
      date: String(record.date || data.contractDate || ""),
      counterparty: String(record.counterparty || data.customer?.name || data.customer?.inn || ""),
      amount: normalizedAmount,
      status: record.status === "exported" ? "exported" : "draft",
      updatedAt: String(record.updatedAt || new Date().toISOString()),
      ownerLogin: String(record.ownerLogin || ""),
      registryMeta: normalizeRegistryMeta(record, data, normalizedAmount),
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

  function upsertInto(records, record, preserveRegistryMeta = true) {
    const normalized = normalizeRecord(record);
    if (!normalized) return normalizeRecords(records);
    const existing = normalizeRecords(records).find((item) => item.number.toLowerCase() === normalized.number.toLowerCase());
    if (preserveRegistryMeta && existing) {
      normalized.registryMeta = {
        ...existing.registryMeta,
        prepayment: existing.registryMeta.prepaymentOverridden
          ? existing.registryMeta.prepayment
          : templatePrepayment(normalized.data, normalized.amount),
      };
    }
    return mergeRecords([normalized], removeFrom(records, normalized.number));
  }

  function removeFrom(records, number) {
    const key = normalizeContractNumber(number).toLowerCase();
    return normalizeRecords(records).filter((record) => record.number.toLowerCase() !== key);
  }

  async function serverRequest(options = {}, query = "") {
    const response = await fetch(`${SERVER_REGISTRY_URL}${query}`, { cache: "no-store", ...options });
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

  async function loadRecord(number) {
    await window.ManagerAuth?.ready;
    const key = normalizeContractNumber(number).toLowerCase();
    if (!key) throw new Error("Для загрузки нужен номер договора.");
    if (!window.ManagerAuth?.usesServerAuth) {
      const record = getLocalRecords().find((item) => item.number.toLowerCase() === key);
      if (!record) throw new Error("Договор не найден в реестре.");
      return record;
    }
    const record = normalizeRecord(await serverRequest({}, `?number=${encodeURIComponent(number)}`));
    if (!record) throw new Error("Договор не найден в реестре.");
    return record;
  }

  async function upsertRecord(record) {
    const normalized = normalizeRecord(record);
    if (!normalized) throw new Error("Для записи в реестр нужен номер договора.");
    if (!window.ManagerAuth?.usesServerAuth) {
      const records = upsertInto(getLocalRecords(), normalized, true);
      setLocalRecords(records);
      return { records, remoteSaved: false };
    }
    await serverRequest({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert", record: normalized, preserveRegistryMeta: true }),
    });
    return { records: [], remoteSaved: true };
  }

  async function updateRegistryMeta(number, fields) {
    const key = normalizeContractNumber(number).toLowerCase();
    if (!key) throw new Error("Для обновления нужен номер договора.");
    if (!window.ManagerAuth?.usesServerAuth) {
      const records = getLocalRecords();
      const record = records.find((item) => item.number.toLowerCase() === key);
      if (!record) throw new Error("Договор не найден в реестре.");
      const nextFields = { ...record.registryMeta, ...fields };
      if (Object.prototype.hasOwnProperty.call(fields, "prepayment")) nextFields.prepaymentOverridden = true;
      record.registryMeta = normalizeRegistryMeta({ registryMeta: nextFields }, record.data, record.amount);
      record.updatedAt = new Date().toISOString();
      const nextRecords = mergeRecords(records);
      setLocalRecords(nextRecords);
      return { record, records: nextRecords, remoteSaved: false };
    }
    const result = await serverRequest({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update-meta", number, fields }),
    });
    return { record: normalizeRecord(result.record), records: [], remoteSaved: true };
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
      registryMeta: {
        title: String(data?.registryDealTitle || "").trim(),
        source: choice(data?.registryDealSource, SOURCE_OPTIONS, ""),
      },
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
    loadRecord,
    upsertRecord,
    deleteRecord,
    updateRegistryMeta,
    recordFromContractData,
    setContractToOpen,
    getContractToOpen,
    SOURCE_OPTIONS,
    PAYMENT_STATUS_OPTIONS,
    PAYMENT_TYPE_OPTIONS,
    CLOSING_DOCS_OPTIONS,
    BONUS_TYPE_OPTIONS,
  };
})();
