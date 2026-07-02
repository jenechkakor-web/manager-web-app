const searchInput = document.querySelector("#registrySearchInput");
const reloadButton = document.querySelector("#reloadRegistryButton");
const statusLine = document.querySelector("#registryStatus");
const tableBody = document.querySelector("#registryTableBody");
const emptyState = document.querySelector("#registryEmpty");
const monthFilter = document.querySelector("#registryMonthFilter");
const dateFilter = document.querySelector("#registryDateFilter");
const periodToggleButton = document.querySelector("#registryPeriodToggle");
const periodPanel = document.querySelector("#registryPeriodPanel");
const periodDateFrom = document.querySelector("#registryDateFrom");
const periodDateTo = document.querySelector("#registryDateTo");
const periodError = document.querySelector("#registryPeriodError");
const periodApplyButton = document.querySelector("#registryPeriodApply");
const periodResetButton = document.querySelector("#registryPeriodReset");
const sourceFilter = document.querySelector("#registrySourceFilter");
const paymentStatusFilter = document.querySelector("#registryPaymentStatusFilter");
const paymentTypeFilter = document.querySelector("#registryPaymentTypeFilter");
const closingDocsFilter = document.querySelector("#registryClosingDocsFilter");
const managerFilter = document.querySelector("#registryManagerFilter");
const summaryContainer = document.querySelector("#registrySummary");
const summaryCount = document.querySelector("#registrySummaryCount");
const registryTable = document.querySelector(".registry-table");
const tableWrap = document.querySelector(".registry-table-wrap");
const registrySheetViewport = document.querySelector("#registrySheetViewport");
const registrySheet = document.querySelector("#registrySheet");
const tableHead = document.querySelector(".registry-table thead");
const stickyScrollbar = document.querySelector("#registryStickyScrollbar");
const stickyScrollbarSpacer = document.querySelector("#registryStickyScrollbarSpacer");
const addDealButton = document.querySelector("#addDealButton");
const addDealModal = document.querySelector("#addDealModal");
const addDealForm = document.querySelector("#addDealForm");
const closeAddDealModalButton = document.querySelector("#closeAddDealModal");
const cancelAddDealButton = document.querySelector("#cancelAddDealButton");
const newDealTitle = document.querySelector("#newDealTitle");
const newDealNumber = document.querySelector("#newDealNumber");
const newDealAmount = document.querySelector("#newDealAmount");
const newDealSource = document.querySelector("#newDealSource");
const addDealError = document.querySelector("#addDealError");
const columnSettingsButton = document.querySelector("#columnSettingsButton");
const columnSettingsModal = document.querySelector("#columnSettingsModal");
const columnSettingsList = document.querySelector("#columnSettingsList");
const closeColumnSettingsModalButton = document.querySelector("#closeColumnSettingsModal");
const finishColumnSettingsButton = document.querySelector("#finishColumnSettingsButton");
const showAllColumnsButton = document.querySelector("#showAllColumnsButton");
const resetColumnWidthsButton = document.querySelector("#resetColumnWidthsButton");
const tableScaleInput = document.querySelector("#registryScaleInput");
const tableScaleOutput = document.querySelector("#registryScaleOutput");

let records = [];
let editingCell = null;
let sortState = { field: null, direction: "asc" };
let appliedDateRange = { from: "", to: "" };
let hiddenColumns = new Set();
let columnWidths = {};
let columnOrder = [];
let tableScalePercent = 100;
let tableBaseWidth = 1;
const EMPTY_SOURCE_FILTER = "__empty_source__";
const HIDDEN_COLUMNS_STORAGE_KEY = "managerRegistryHiddenColumns";
const COLUMN_WIDTHS_STORAGE_KEY = "managerRegistryColumnWidths";
const COLUMN_ORDER_STORAGE_KEY = "managerRegistryColumnOrder";
const TABLE_SCALE_STORAGE_KEY = "managerRegistryTableScale";
const MIN_TABLE_SCALE = 50;
const MAX_TABLE_SCALE = 125;
const MIN_COLUMN_WIDTH = 72;
const REGISTRY_COLUMNS = [
  { id: "number", label: "Номер", width: 140 },
  { id: "date", label: "Дата", width: 120 },
  { id: "title", label: "Название", width: 230 },
  { id: "counterparty", label: "Контрагент", width: 280 },
  { id: "amount", label: "Сумма", width: 155 },
  { id: "source", label: "Источник", width: 145 },
  { id: "paymentStatus", label: "Оплачен", width: 155 },
  { id: "prepayment", label: "Предоплата", width: 155 },
  { id: "remainder", label: "Остаток", width: 145 },
  { id: "paymentType", label: "Вид оплаты", width: 145 },
  { id: "closingDocs", label: "Закрывашки", width: 165 },
  { id: "dealStatus", label: "Статус сделки", width: 155 },
  { id: "bonusType", label: "Тип бонуса", width: 145 },
  { id: "bonusAmount", label: "Сумма бонуса", width: 155 },
  { id: "recordStatus", label: "Статус записи", width: 125, adminOnly: true },
  { id: "manager", label: "Менеджер", width: 145, adminOnly: true },
  { id: "delete", label: "Удаление", width: 88, adminOnly: true },
];
const registryCollator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const PAYMENT_STATUS_SORT_ORDER = {
  Планируется: 0,
  Предоплата: 1,
  Да: 2,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function availableColumns() {
  return REGISTRY_COLUMNS.filter((column) => !column.adminOnly || window.ManagerAuth.isAdmin);
}

function preferenceKey(key) {
  return window.ManagerAuth.storageKey(key);
}

function normalizeColumnOrder(source) {
  const knownIds = REGISTRY_COLUMNS.map((column) => column.id);
  const storedIds = Array.isArray(source) ? source.filter((id) => knownIds.includes(id)) : [];
  return [...new Set([...storedIds, ...knownIds])];
}

function orderedColumns() {
  const byId = new Map(REGISTRY_COLUMNS.map((column) => [column.id, column]));
  return normalizeColumnOrder(columnOrder).map((id) => byId.get(id)).filter(Boolean);
}

function loadColumnPreferences() {
  try {
    const storedHidden = JSON.parse(localStorage.getItem(preferenceKey(HIDDEN_COLUMNS_STORAGE_KEY)) || "[]");
    hiddenColumns = new Set(Array.isArray(storedHidden) ? storedHidden : []);
  } catch {
    hiddenColumns = new Set();
  }
  try {
    const storedWidths = JSON.parse(localStorage.getItem(preferenceKey(COLUMN_WIDTHS_STORAGE_KEY)) || "{}");
    columnWidths = storedWidths && typeof storedWidths === "object" ? storedWidths : {};
  } catch {
    columnWidths = {};
  }
  try {
    columnOrder = normalizeColumnOrder(JSON.parse(localStorage.getItem(preferenceKey(COLUMN_ORDER_STORAGE_KEY)) || "[]"));
  } catch {
    columnOrder = normalizeColumnOrder([]);
  }
}

function saveHiddenColumns() {
  localStorage.setItem(preferenceKey(HIDDEN_COLUMNS_STORAGE_KEY), JSON.stringify([...hiddenColumns]));
}

function saveColumnWidths() {
  localStorage.setItem(preferenceKey(COLUMN_WIDTHS_STORAGE_KEY), JSON.stringify(columnWidths));
}

function saveColumnOrder() {
  localStorage.setItem(preferenceKey(COLUMN_ORDER_STORAGE_KEY), JSON.stringify(columnOrder));
}

function loadTableScale() {
  const raw = localStorage.getItem(preferenceKey(TABLE_SCALE_STORAGE_KEY));
  const stored = raw === null ? Number.NaN : Number(raw);
  tableScalePercent = Number.isFinite(stored)
    ? Math.min(MAX_TABLE_SCALE, Math.max(MIN_TABLE_SCALE, stored))
    : 100;
}

function saveTableScale() {
  localStorage.setItem(preferenceKey(TABLE_SCALE_STORAGE_KEY), String(tableScalePercent));
}

function applyTableScale() {
  tableScaleInput.value = String(tableScalePercent);
  tableScaleOutput.value = `${tableScalePercent}%`;
  tableScaleOutput.textContent = `${tableScalePercent}%`;
  registryTable.style.zoom = String(tableScalePercent / 100);
  updateRegistrySheetWidth();
  requestAnimationFrame(updateStickyScrollbar);
}

function updateRegistrySheetWidth() {
  const scaledWidth = Math.max(1, tableBaseWidth * (tableScalePercent / 100));
  registrySheet.style.width = `${scaledWidth}px`;
}

function columnWidth(column) {
  const stored = Number(columnWidths[column.id]);
  return Number.isFinite(stored) ? Math.max(MIN_COLUMN_WIDTH, stored) : column.width;
}

function isColumnVisible(column) {
  return (!column.adminOnly || window.ManagerAuth.isAdmin) && !hiddenColumns.has(column.id);
}

function applyColumnOrder() {
  const colgroup = registryTable.querySelector("colgroup");
  const headerRow = tableHead.querySelector("tr");
  const order = normalizeColumnOrder(columnOrder);
  order.forEach((columnId) => {
    const col = colgroup.querySelector(`col[data-column="${columnId}"]`);
    const header = headerRow.querySelector(`th[data-column="${columnId}"]`);
    if (col) colgroup.append(col);
    if (header) headerRow.append(header);
  });
  tableBody.querySelectorAll("tr").forEach((row) => {
    order.forEach((columnId) => {
      const cell = row.querySelector(`td[data-column="${columnId}"]`);
      if (cell) row.append(cell);
    });
  });
}

function updateStickyScrollbar() {
  const rect = registrySheetViewport.getBoundingClientRect();
  const scrollableWidth = registrySheetViewport.scrollWidth;
  const needsHorizontalScroll = scrollableWidth > registrySheetViewport.clientWidth + 1;
  const visible = needsHorizontalScroll;
  stickyScrollbar.classList.toggle("hidden", !visible);
  if (!visible) return;
  stickyScrollbar.style.left = `${Math.max(0, rect.left)}px`;
  stickyScrollbar.style.width = `${Math.min(rect.width, window.innerWidth - Math.max(0, rect.left))}px`;
  stickyScrollbarSpacer.style.width = `${scrollableWidth}px`;
  if (stickyScrollbar.scrollLeft !== registrySheetViewport.scrollLeft) stickyScrollbar.scrollLeft = registrySheetViewport.scrollLeft;
}

function applyColumnLayout() {
  applyColumnOrder();
  let totalWidth = 0;
  REGISTRY_COLUMNS.forEach((column) => {
    const visible = isColumnVisible(column);
    const width = columnWidth(column);
    registryTable.querySelectorAll(`[data-column="${column.id}"]`).forEach((element) => {
      element.classList.toggle("registry-column-hidden", !visible);
      if (element.tagName === "COL") element.style.width = `${width}px`;
    });
    if (visible) totalWidth += width;
  });
  tableBaseWidth = Math.max(1, totalWidth);
  registryTable.style.width = `${tableBaseWidth}px`;
  updateRegistrySheetWidth();
  requestAnimationFrame(updateStickyScrollbar);
}

function renderColumnSettings() {
  columnSettingsList.innerHTML = orderedColumns()
    .filter((column) => !column.adminOnly || window.ManagerAuth.isAdmin)
    .map(
      (column) => `
        <label class="column-setting-item">
          <input data-column-visibility="${escapeHtml(column.id)}" type="checkbox"${hiddenColumns.has(column.id) ? "" : " checked"} />
          <span title="${escapeHtml(column.label)}">${escapeHtml(column.label)}</span>
        </label>`,
    )
    .join("");
}

function setColumnSettingsModalOpen(open) {
  columnSettingsModal.classList.toggle("hidden", !open);
  if (open) {
    renderColumnSettings();
    requestAnimationFrame(() => columnSettingsList.querySelector("input")?.focus());
  } else {
    columnSettingsButton.focus();
  }
}

function setStatus(message) {
  statusLine.textContent = message || "";
}

function formatDate(dateValue) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00`);
  return Number.isNaN(date.getTime()) ? dateValue : new Intl.DateTimeFormat("ru-RU").format(date);
}

function formatMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(Number(match[1]), Number(match[2]) - 1, 1),
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date);
}

function updatePeriodButton() {
  const active = Boolean(appliedDateRange.from && appliedDateRange.to);
  periodToggleButton.classList.toggle("is-active", active);
  periodToggleButton.textContent = active
    ? `${formatShortDate(appliedDateRange.from)} — ${formatShortDate(appliedDateRange.to)}`
    : "Период";
  periodToggleButton.title = active
    ? `Выбран период с ${formatDate(appliedDateRange.from)} по ${formatDate(appliedDateRange.to)}`
    : "Выбрать период по датам";
}

function setPeriodPanelOpen(open) {
  periodPanel.classList.toggle("hidden", !open);
  periodToggleButton.setAttribute("aria-expanded", String(open));
  if (open) {
    periodDateFrom.value = appliedDateRange.from;
    periodDateTo.value = appliedDateRange.to;
    periodError.textContent = "";
    requestAnimationFrame(() => periodDateFrom.focus());
  }
}

function resetAppliedDateRange() {
  appliedDateRange = { from: "", to: "" };
  periodDateFrom.value = "";
  periodDateTo.value = "";
  periodError.textContent = "";
  updatePeriodButton();
}

function money(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function plainMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round((number + Number.EPSILON) * 100) / 100) : "0";
}

function selectOptions(options, selectedValue, emptyLabel = null) {
  const values = emptyLabel === null ? options : ["", ...options];
  return values
    .map((value) => {
      const label = value || emptyLabel;
      return `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function setFilterOptions(select, values, allLabel, labelFormatter = (value) => value) {
  const selectedValue = select.value;
  select.innerHTML = [
    `<option value="">${escapeHtml(allLabel)}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labelFormatter(value))}</option>`),
  ].join("");
  if (values.includes(selectedValue)) select.value = selectedValue;
}

function renderFilterOptions() {
  const months = [...new Set(records.map((record) => String(record.date || "").slice(0, 7)).filter((value) => /^\d{4}-\d{2}$/.test(value)))]
    .sort((a, b) => b.localeCompare(a));
  const managers = [...new Set(records.map((record) => record.ownerLogin || "admin"))].sort((a, b) => a.localeCompare(b, "ru"));
  const sourceOptions = records.some((record) => !record.registryMeta.source)
    ? [EMPTY_SOURCE_FILTER, ...window.ContractRegistry.SOURCE_OPTIONS]
    : window.ContractRegistry.SOURCE_OPTIONS;
  setFilterOptions(monthFilter, months, "Все месяцы", formatMonth);
  setFilterOptions(sourceFilter, sourceOptions, "Все источники", (value) => (value === EMPTY_SOURCE_FILTER ? "Не указано" : value));
  setFilterOptions(paymentStatusFilter, window.ContractRegistry.PAYMENT_STATUS_OPTIONS, "Все варианты");
  setFilterOptions(paymentTypeFilter, window.ContractRegistry.PAYMENT_TYPE_OPTIONS, "Все варианты");
  setFilterOptions(closingDocsFilter, window.ContractRegistry.CLOSING_DOCS_OPTIONS, "Все варианты");
  setFilterOptions(managerFilter, managers, "Все менеджеры");
}

function bonusAmount(record) {
  const type = record.registryMeta.bonusType;
  if (type === "оклад") return 0;
  if (type === "от прибыли") return Number(record.registryMeta.bonusAmount) || 0;
  const percent = Number.parseFloat(type);
  return Number.isFinite(percent) ? (record.amount * percent) / 100 : 0;
}

function remainder(record, prepayment = record.registryMeta.prepayment) {
  const difference = (Number(record.amount) || 0) - (Number(prepayment) || 0);
  return Math.max(0, Math.round((difference + Number.EPSILON) * 100) / 100);
}

function hasPaymentRemainder(record, prepayment = record.registryMeta.prepayment) {
  return remainder(record, prepayment) > 0;
}

function dealStatus(record) {
  const { paymentStatus, closingDocs } = record.registryMeta;
  const closingComplete = closingDocs === "Отправлены" || closingDocs === "Не нужно";
  if (paymentStatus === "Да" && !hasPaymentRemainder(record) && closingComplete) return "Завершена";
  if (paymentStatus === "Да" || paymentStatus === "Предоплата") return "В работе";
  return "Планируется";
}

function paymentTone(status) {
  if (status === "Да") return "payment-tone-paid";
  if (status === "Предоплата") return "payment-tone-prepaid";
  return "payment-tone-planned";
}

function dealTone(status) {
  if (status === "Завершена") return "deal-tone-complete";
  if (status === "В работе") return "deal-tone-active";
  return "deal-tone-planned";
}

function closingTone(status) {
  if (status === "Отправлены" || status === "Не нужно") return "closing-tone-complete";
  return "closing-tone-pending";
}

function statusLabel(status) {
  return status === "exported" ? "выгружен" : "черновик";
}

function isNumberlessDeal(record) {
  return Boolean(record?.data?.registryDealWithoutNumber && record?.data?.registryPlaceholderNumber === record.number);
}

function displayRecordNumber(record) {
  return isNumberlessDeal(record) ? "Без номера" : record.number;
}

function localDateValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function createNumberlessDealId() {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `Планируемая сделка без номера ${Date.now()}-${random}`;
}

function setAddDealModalOpen(open) {
  addDealModal.classList.toggle("hidden", !open);
  if (open) {
    addDealForm.reset();
    addDealError.textContent = "";
    requestAnimationFrame(() => newDealTitle.focus());
  } else {
    addDealButton.focus();
  }
}

async function addPlannedDeal(event) {
  event.preventDefault();
  addDealError.textContent = "";
  if (!addDealForm.reportValidity()) return;

  const title = newDealTitle.value.trim();
  const enteredNumber = newDealNumber.value.trim();
  const amount = Number(newDealAmount.value);
  const source = newDealSource.value;
  if (!title || !source || !Number.isFinite(amount) || amount <= 0) return;
  if (enteredNumber && records.some((record) => record.number.toLowerCase() === enteredNumber.toLowerCase())) {
    addDealError.textContent = `Сделка с номером ${enteredNumber} уже есть в реестре.`;
    newDealNumber.focus();
    return;
  }

  const number = enteredNumber || createNumberlessDealId();
  const date = localDateValue();
  const data = {
    contractNumber: enteredNumber,
    contractDate: date,
    documentTemplate: "invoiceContract",
    sellerKey: "ip",
    customerType: "legal",
    customer: {},
    paymentTerms: "0",
    finalPaymentTiming: "beforeShipment",
    items: [{ name: title, qty: 1, price: amount, sum: amount }],
    totals: { totalWithoutVat: amount, vat: 0, grandTotal: amount },
    technicalBlocks: [],
    registryDealTitle: title,
    registryDealSource: source,
    registryDealWithoutNumber: !enteredNumber,
    registryPlaceholderNumber: enteredNumber ? "" : number,
  };
  const record = {
    number,
    date,
    counterparty: "",
    amount,
    status: "draft",
    updatedAt: new Date().toISOString(),
    registryMeta: {
      title,
      source,
      paymentStatus: "Планируется",
      prepayment: 0,
      prepaymentOverridden: true,
      paymentType: "",
      closingDocs: "Не отправлены",
      bonusType: "12%",
      bonusAmount: 0,
    },
    data,
  };

  const submitButton = addDealForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    await window.ContractRegistry.upsertRecord(record);
    setAddDealModalOpen(false);
    await loadRecords();
    setStatus(`Сделка «${title}» добавлена${enteredNumber ? ` под номером ${enteredNumber}` : " без номера"}.`);
  } catch (error) {
    addDealError.textContent = error.message || "Не удалось добавить сделку.";
  } finally {
    submitButton.disabled = false;
  }
}

function sortValue(record, field) {
  const meta = record.registryMeta;
  const values = {
    number: record.number,
    date: record.date,
    title: meta.title,
    counterparty: record.counterparty,
    amount: Number(record.amount) || 0,
    source: meta.source,
    paymentStatus: PAYMENT_STATUS_SORT_ORDER[meta.paymentStatus] ?? -1,
    prepayment: Number(meta.prepayment) || 0,
    remainder: remainder(record),
    paymentType: meta.paymentType,
    closingDocs: meta.closingDocs,
    dealStatus: dealStatus(record),
    bonusType: meta.bonusType,
    bonusAmount: bonusAmount(record),
    recordStatus: statusLabel(record.status),
    manager: record.ownerLogin || "admin",
  };
  return values[field] ?? "";
}

function sortRecords(recordsToSort) {
  if (!sortState.field) return recordsToSort;
  const direction = sortState.direction === "desc" ? -1 : 1;
  return recordsToSort
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      const leftValue = sortValue(left.record, sortState.field);
      const rightValue = sortValue(right.record, sortState.field);
      let comparison;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        comparison = leftValue - rightValue;
      } else {
        comparison = registryCollator.compare(String(leftValue), String(rightValue));
      }
      return comparison === 0 ? left.index - right.index : comparison * direction;
    })
    .map(({ record }) => record);
}

function renderSortHeaders() {
  tableHead?.querySelectorAll("[data-sort-field]").forEach((button) => {
    const active = button.dataset.sortField === sortState.field;
    const directionLabel = sortState.direction === "asc" ? "по возрастанию" : "по убыванию";
    button.classList.toggle("is-active", active);
    button.querySelector("span").textContent = active ? (sortState.direction === "asc" ? "↑" : "↓") : "↕";
    button.closest("th").setAttribute("aria-sort", active ? (sortState.direction === "asc" ? "ascending" : "descending") : "none");
    button.title = active ? `Сейчас ${directionLabel}. Нажмите, чтобы изменить порядок` : "Нажмите, чтобы отсортировать";
  });
}

function filteredRecords() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = records.filter((record) => {
    const meta = record.registryMeta;
    const ownerLogin = record.ownerLogin || "admin";
    const recordDate = String(record.date || "");
    const inAppliedDateRange =
      !appliedDateRange.from ||
      (recordDate && recordDate >= appliedDateRange.from && recordDate <= appliedDateRange.to);
    return (
      (!query || record.number.toLowerCase().includes(query) || meta.title.toLowerCase().includes(query) || record.counterparty.toLowerCase().includes(query)) &&
      (!monthFilter.value || String(record.date || "").startsWith(monthFilter.value)) &&
      inAppliedDateRange &&
      (!sourceFilter.value || (sourceFilter.value === EMPTY_SOURCE_FILTER ? !meta.source : meta.source === sourceFilter.value)) &&
      (!paymentStatusFilter.value || meta.paymentStatus === paymentStatusFilter.value) &&
      (!paymentTypeFilter.value || meta.paymentType === paymentTypeFilter.value) &&
      (!closingDocsFilter.value || meta.closingDocs === closingDocsFilter.value) &&
      (!managerFilter.value || ownerLogin === managerFilter.value)
    );
  });
  return sortRecords(filtered);
}

function sumRecords(recordsToSum, predicate, selector) {
  return recordsToSum.reduce((total, record) => (predicate(record) ? total + selector(record) : total), 0);
}

function renderSummary(visibleRecords) {
  if (!summaryContainer || !summaryCount) return;
  const planned = (record) => dealStatus(record) === "Планируется";
  const active = (record) => dealStatus(record) === "В работе";
  const complete = (record) => dealStatus(record) === "Завершена";
  const activeOrComplete = (record) => active(record) || complete(record);
  const anyRecord = () => true;
  const amount = (record) => Number(record.amount) || 0;
  const bonus = (record) => bonusAmount(record);
  const columns = [
    [
      ["Сумма Завершенных Договоров", sumRecords(visibleRecords, complete, amount), "registry-summary-card-complete"],
      ["Сумма Бонусов по Завершенным", sumRecords(visibleRecords, complete, bonus), "registry-summary-card-complete"],
      ["Сумма Остатка по Договорам в работе", sumRecords(visibleRecords, active, remainder), "registry-summary-card-remainder"],
    ],
    [
      ["Сумма Договоров по завершенным и в работе", sumRecords(visibleRecords, activeOrComplete, amount), "registry-summary-card-active-complete"],
      ["Сумма бонусов по завершенным и в работе", sumRecords(visibleRecords, activeOrComplete, bonus), "registry-summary-card-bonus"],
    ],
    [
      ["Сумма Договоров в работе", sumRecords(visibleRecords, active, amount), ""],
      ["Сумма бонусов в Работе", sumRecords(visibleRecords, active, bonus), "registry-summary-card-bonus"],
    ],
    [
      ["Сумма планируемых Договоров", sumRecords(visibleRecords, planned, amount), ""],
      ["Сумма Бонусов по планируемым", sumRecords(visibleRecords, planned, bonus), "registry-summary-card-bonus"],
    ],
    [
      ["Сумма Договоров", sumRecords(visibleRecords, anyRecord, amount), "registry-summary-card-total"],
      ["Сумма бонусов по всем", sumRecords(visibleRecords, anyRecord, bonus), "registry-summary-card-bonus"],
    ],
  ];

  summaryCount.textContent = `В выборке: ${visibleRecords.length}`;
  const pairedCards = columns
    .map((cards) => {
      const content = cards
        .map(
          ([label, value, tone]) => `
            <article class="registry-summary-card ${tone}">
              <span class="registry-summary-label">${escapeHtml(label)}</span>
              <strong class="registry-summary-value">${escapeHtml(money(value))}</strong>
            </article>`,
        )
        .join("");
      return `<div class="registry-summary-column">${content}</div>`;
    })
    .join("");
  summaryContainer.innerHTML = pairedCards;
}

function staticCell(value, extraClass = "", title = value, column = "") {
  return `<td${column ? ` data-column="${escapeHtml(column)}"` : ""}><div class="registry-cell-value registry-cell-readonly ${extraClass}" title="${escapeHtml(title)}">${escapeHtml(value)}</div></td>`;
}

function markupCell(content, extraClass = "", column = "") {
  return `<td${column ? ` data-column="${escapeHtml(column)}"` : ""}><div class="registry-cell-value registry-cell-readonly ${extraClass}">${content}</div></td>`;
}

function editableDisplayValue(record, field) {
  const meta = record.registryMeta;
  if (field === "title") return meta.title || "Без названия";
  if (field === "source") return meta.source || "Не указано";
  if (field === "paymentStatus") return meta.paymentStatus;
  if (field === "prepayment") return money(meta.prepayment);
  if (field === "paymentType") return meta.paymentType || "Не указано";
  if (field === "closingDocs") return meta.closingDocs;
  if (field === "bonusType") return meta.bonusType;
  if (field === "bonusAmount") return money(bonusAmount(record));
  return "";
}

function editorMarkup(record, field) {
  const meta = record.registryMeta;
  const common = `data-registry-editor data-registry-field="${field}" aria-label="${escapeHtml(field)}"`;
  if (field === "title") {
    return `<input class="registry-control registry-cell-editor" ${common} type="text" maxlength="160" value="${escapeHtml(meta.title)}" />`;
  }
  if (field === "prepayment") {
    return `<input class="registry-control registry-cell-editor" ${common} type="number" min="0" max="${escapeHtml(record.amount)}" step="0.01" value="${escapeHtml(plainMoney(meta.prepayment))}" />`;
  }
  if (field === "bonusAmount") {
    return `<input class="registry-control registry-cell-editor" ${common} type="number" min="0" step="0.01" value="${escapeHtml(plainMoney(bonusAmount(record)))}" />`;
  }
  const optionsByField = {
    source: [window.ContractRegistry.SOURCE_OPTIONS, "Не указано"],
    paymentStatus: [window.ContractRegistry.PAYMENT_STATUS_OPTIONS, null],
    paymentType: [window.ContractRegistry.PAYMENT_TYPE_OPTIONS, "Не указано"],
    closingDocs: [window.ContractRegistry.CLOSING_DOCS_OPTIONS, null],
    bonusType: [window.ContractRegistry.BONUS_TYPE_OPTIONS, null],
  };
  const [options, emptyLabel] = optionsByField[field];
  const toneClass =
    field === "paymentStatus"
      ? paymentTone(meta.paymentStatus)
      : field === "closingDocs"
        ? closingTone(meta.closingDocs)
        : "";
  return `<select class="registry-control registry-cell-editor ${toneClass}" ${common}>
    ${selectOptions(options, meta[field], emptyLabel)}
  </select>`;
}

function editableCell(record, field, enabled = true, extraClass = "") {
  const isEditing = enabled && editingCell?.number === record.number && editingCell?.field === field;
  if (isEditing) return `<td class="registry-data-cell is-editing" data-column="${escapeHtml(field)}">${editorMarkup(record, field)}</td>`;
  const value = editableDisplayValue(record, field);
  if (!enabled) return staticCell(value, `${extraClass} registry-cell-disabled`, value, field);
  return `<td class="registry-data-cell" data-column="${escapeHtml(field)}">
    <button class="registry-cell-value registry-cell-editable ${extraClass}" data-edit-field="${field}" type="button" title="Нажмите, чтобы изменить">
      <span>${escapeHtml(value)}</span><span class="registry-edit-mark" aria-hidden="true">✎</span>
    </button>
  </td>`;
}

function render() {
  const isAdmin = window.ManagerAuth.isAdmin;
  const visibleRecords = filteredRecords();
  tableBody.innerHTML = visibleRecords
    .map((record) => {
      const meta = record.registryMeta;
      const prepaymentEnabled = meta.paymentStatus === "Да" || meta.paymentStatus === "Предоплата";
      const profitBonus = meta.bonusType === "от прибыли";
      const currentDealStatus = dealStatus(record);
      return `
        <tr data-number="${escapeHtml(record.number)}">
          <td data-column="number"><a class="registry-cell-value registry-number-link" data-open-number="${escapeHtml(record.number)}" href="index.html" title="Открыть форму создания счёта и договора">${escapeHtml(displayRecordNumber(record))}</a></td>
          ${staticCell(formatDate(record.date), "", formatDate(record.date), "date")}
          ${editableCell(record, "title")}
          ${staticCell(record.counterparty || "Без контрагента", "registry-counterparty", record.counterparty || "Без контрагента", "counterparty")}
          ${staticCell(money(record.amount), "registry-money-value", money(record.amount), "amount")}
          ${editableCell(record, "source")}
          ${editableCell(record, "paymentStatus", true, paymentTone(meta.paymentStatus))}
          ${editableCell(record, "prepayment", prepaymentEnabled)}
          ${staticCell(money(remainder(record)), "registry-money-value", money(remainder(record)), "remainder")}
          ${editableCell(record, "paymentType")}
          ${editableCell(record, "closingDocs", true, closingTone(meta.closingDocs))}
          ${staticCell(currentDealStatus, dealTone(currentDealStatus), currentDealStatus, "dealStatus")}
          ${editableCell(record, "bonusType")}
          ${editableCell(record, "bonusAmount", profitBonus)}
          ${isAdmin ? markupCell(`<span class="status-badge ${record.status}">${escapeHtml(statusLabel(record.status))}</span>`, "", "recordStatus") : ""}
          ${isAdmin ? staticCell(record.ownerLogin || "admin", "", record.ownerLogin || "admin", "manager") : ""}
          ${
            isAdmin
              ? `<td data-column="delete"><div class="registry-cell-value registry-cell-actions"><button class="icon-button" data-delete-number="${escapeHtml(record.number)}" type="button" title="Удалить сделку">×</button></div></td>`
              : ""
          }
        </tr>`;
    })
    .join("");
  emptyState.classList.toggle("hidden", visibleRecords.length > 0);
  renderSortHeaders();
  renderSummary(visibleRecords);
  applyColumnLayout();
}

function canEditField(record, field) {
  if (field === "prepayment") return record.registryMeta.paymentStatus === "Да" || record.registryMeta.paymentStatus === "Предоплата";
  if (field === "bonusAmount") return record.registryMeta.bonusType === "от прибыли";
  return true;
}

function startEditing(number, field) {
  const record = records.find((item) => item.number === number);
  if (!record || !canEditField(record, field)) return;
  editingCell = { number, field };
  render();
  requestAnimationFrame(() => {
    const editor = tableBody.querySelector(`tr[data-number="${CSS.escape(number)}"] [data-registry-field="${field}"]`);
    editor?.focus();
    if (editor?.tagName === "INPUT") editor.select();
  });
}

function cancelEditing() {
  editingCell = null;
  render();
}

async function commitEditor(control) {
  if (!control || control.dataset.committing === "true") return;
  const row = control.closest("tr[data-number]");
  const record = records.find((item) => item.number === row?.dataset.number);
  if (!record) return;
  const field = control.dataset.registryField;
  const previousMeta = { ...record.registryMeta };
  const value = control.type === "number"
    ? Math.max(0, Number(control.value) || 0)
    : field === "title"
      ? control.value.trim()
      : control.value;
  if (field === "paymentStatus" && value === "Да" && hasPaymentRemainder(record)) {
    const message = `Нельзя поставить «Оплачен — Да»: по договору остаётся ${money(remainder(record))}. Сначала укажите полную оплату в поле «Предоплата».`;
    control.setCustomValidity(message);
    control.reportValidity();
    setStatus(message);
    control.focus();
    return;
  }
  if (field === "prepayment" && value > record.amount) {
    control.setCustomValidity("Предоплата не может превышать полную сумму договора.");
    control.reportValidity();
    control.focus();
    return;
  }
  if (field === "prepayment" && record.registryMeta.paymentStatus === "Да" && hasPaymentRemainder(record, value)) {
    const message = "При статусе «Оплачен — Да» сумма оплаты должна быть равна полной сумме договора.";
    control.setCustomValidity(message);
    control.reportValidity();
    setStatus(message);
    control.focus();
    return;
  }
  control.setCustomValidity("");
  control.dataset.committing = "true";
  record.registryMeta = { ...record.registryMeta, [field]: value };
  editingCell = null;
  setStatus(`Сохраняю изменения по сделке ${displayRecordNumber(record)}...`);
  setTimeout(() => {
    if (!editingCell) render();
  }, 0);
  try {
    const result = await window.ContractRegistry.updateRegistryMeta(record.number, { [field]: value });
    if (result.records.length) records = result.records;
    const currentRecord = records.find((item) => item.number === record.number);
    if (result.record && currentRecord) currentRecord.registryMeta = result.record.registryMeta;
    if (!editingCell) render();
    setStatus(`Изменения по сделке ${displayRecordNumber(record)} сохранены.`);
  } catch (error) {
    const currentRecord = records.find((item) => item.number === record.number);
    if (currentRecord) currentRecord.registryMeta = previousMeta;
    if (!editingCell) render();
    setStatus(error.message || "Не удалось сохранить изменения в реестре.");
  }
}

async function loadRecords() {
  setStatus("Загружаю реестр...");
  try {
    records = await window.ContractRegistry.loadRegistry({ cache: false });
    editingCell = null;
    renderFilterOptions();
    render();
    setStatus(records.length ? `Загружено сделок: ${records.length}` : "Реестр пуст.");
  } catch (error) {
    records = [];
    editingCell = null;
    renderFilterOptions();
    render();
    setStatus(error.message || "Не удалось загрузить реестр.");
  }
}

function openRecord(number) {
  const record = records.find((item) => item.number === number);
  if (!record) return;
  const data = {
    ...record.data,
    contractNumber: isNumberlessDeal(record) ? "" : (record.data?.contractNumber || record.number),
    registryDealTitle: record.registryMeta.title || "",
    registryDealSource: record.registryMeta.source || "",
    registryPlaceholderNumber: isNumberlessDeal(record) ? record.number : "",
    registryDealWithoutNumber: isNumberlessDeal(record),
  };
  window.ContractRegistry.setContractToOpen(data);
  window.location.href = "index.html";
}

async function deleteRecord(number) {
  if (!window.ManagerAuth.isAdmin) return;
  const record = records.find((item) => item.number === number);
  if (!confirm(`Удалить сделку «${record ? displayRecordNumber(record) : number}» из реестра?`)) return;
  try {
    setStatus("Удаляю сделку...");
    const result = await window.ContractRegistry.deleteRecord(number);
    records = result.records;
    renderFilterOptions();
    render();
    setStatus("Сделка удалена из общего реестра.");
  } catch (error) {
    setStatus(error.message || "Не удалось удалить договор из реестра.");
  }
}

let draggedColumnId = "";

function setupColumnDragging() {
  tableHead.querySelectorAll("th[data-column]").forEach((header) => {
    if (header.querySelector("[data-drag-column]")) return;
    const handle = document.createElement("span");
    handle.className = "registry-column-drag-handle";
    handle.dataset.dragColumn = header.dataset.column;
    handle.draggable = false;
    handle.title = "Перетащить столбец";
    handle.setAttribute("aria-label", "Изменить порядок столбца");
    handle.textContent = "⋮⋮";
    header.prepend(handle);
  });
}

function clearColumnDropIndicators() {
  tableHead.querySelectorAll(".is-dragging, .drop-before, .drop-after").forEach((header) => {
    header.classList.remove("is-dragging", "drop-before", "drop-after");
  });
}

function moveColumn(draggedId, targetId, placeAfter) {
  if (!draggedId || !targetId || draggedId === targetId) return;
  const nextOrder = normalizeColumnOrder(columnOrder).filter((id) => id !== draggedId);
  const targetIndex = nextOrder.indexOf(targetId);
  if (targetIndex < 0) return;
  nextOrder.splice(targetIndex + (placeAfter ? 1 : 0), 0, draggedId);
  columnOrder = normalizeColumnOrder(nextOrder);
  saveColumnOrder();
  applyColumnLayout();
  renderColumnSettings();
  setStatus("Порядок столбцов сохранён.");
}

function startColumnReorder(event) {
  const dragHandle = event.target.closest("[data-drag-column]");
  const sourceHeader = dragHandle?.closest("th[data-column]");
  if (!dragHandle || !sourceHeader || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  draggedColumnId = sourceHeader.dataset.column;
  sourceHeader.classList.add("is-dragging");
  const startX = event.clientX;
  const startY = event.clientY;
  let targetColumnId = "";
  let placeAfter = false;
  let moved = false;

  const move = (moveEvent) => {
    if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
    moved = true;
    const targetHeader = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest("th[data-column]");
    tableHead.querySelectorAll(".drop-before, .drop-after").forEach((header) => header.classList.remove("drop-before", "drop-after"));
    if (!targetHeader || !tableHead.contains(targetHeader) || targetHeader.dataset.column === draggedColumnId) {
      targetColumnId = "";
      return;
    }
    const rect = targetHeader.getBoundingClientRect();
    targetColumnId = targetHeader.dataset.column;
    placeAfter = moveEvent.clientX > rect.left + rect.width / 2;
    targetHeader.classList.add(placeAfter ? "drop-after" : "drop-before");
  };

  const finish = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", finish);
    if (moved && targetColumnId) moveColumn(draggedColumnId, targetColumnId, placeAfter);
    draggedColumnId = "";
    clearColumnDropIndicators();
  };

  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", finish);
}

function startColumnResize(event) {
  const handle = event.target.closest("[data-resize-column]");
  if (!handle || event.button !== 0) return;
  const column = REGISTRY_COLUMNS.find((item) => item.id === handle.dataset.resizeColumn);
  if (!column || !isColumnVisible(column)) return;
  if (event.detail >= 2) {
    autoFitColumn(event);
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  const scale = tableScalePercent / 100;
  const header = handle.closest("th");
  REGISTRY_COLUMNS.filter(isColumnVisible).forEach((visibleColumn) => {
    const visibleHeader = tableHead.querySelector(`th[data-column="${visibleColumn.id}"]`);
    const measuredWidth = visibleHeader?.getBoundingClientRect().width;
    if (Number.isFinite(measuredWidth) && measuredWidth > 0) columnWidths[visibleColumn.id] = measuredWidth / scale;
  });
  applyColumnLayout();

  const frozenRect = header.getBoundingClientRect();
  const grabOffset = event.clientX - frozenRect.right;
  const columnLeft = frozenRect.left;
  handle.classList.add("is-resizing");
  registryTable.classList.add("is-resizing");

  const move = (moveEvent) => {
    const targetRight = moveEvent.clientX - grabOffset;
    columnWidths[column.id] = Math.max(MIN_COLUMN_WIDTH, (targetRight - columnLeft) / scale);
    applyColumnLayout();
  };
  const finish = () => {
    handle.classList.remove("is-resizing");
    registryTable.classList.remove("is-resizing");
    saveColumnWidths();
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", finish);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", finish);
}

function measureAutoFitText(measurement, target, text) {
  const style = window.getComputedStyle(target);
  measurement.style.fontFamily = style.fontFamily;
  measurement.style.fontSize = style.fontSize;
  measurement.style.fontStyle = style.fontStyle;
  measurement.style.fontWeight = style.fontWeight;
  measurement.style.letterSpacing = style.letterSpacing;
  measurement.textContent = String(text || "").replace(/\s+/g, " ").trim();
  const textWidth = measurement.getBoundingClientRect().width;
  const horizontalChrome =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0) +
    (Number.parseFloat(style.borderLeftWidth) || 0) +
    (Number.parseFloat(style.borderRightWidth) || 0);
  return textWidth + horizontalChrome;
}

function autoFitColumn(event) {
  const handle = event.target.closest("[data-resize-column]");
  if (!handle) return;
  const column = REGISTRY_COLUMNS.find((item) => item.id === handle.dataset.resizeColumn);
  if (!column || !isColumnVisible(column)) return;
  event.preventDefault();
  event.stopPropagation();

  const measurement = document.createElement("span");
  measurement.className = "registry-column-measurement";
  document.body.append(measurement);

  const header = handle.closest("th");
  const headerTarget = header.querySelector(".registry-sort-button") || header;
  let fittedWidth = measureAutoFitText(measurement, headerTarget, column.label) + 30;

  tableBody.querySelectorAll(`td[data-column="${column.id}"]`).forEach((cell) => {
    const target =
      cell.querySelector(".status-badge, .icon-button, .registry-cell-value, .registry-control") || cell;
    const content = target.innerText || target.textContent || "";
    fittedWidth = Math.max(fittedWidth, measureAutoFitText(measurement, target, content) + 3);
  });

  measurement.remove();
  columnWidths[column.id] = Math.max(MIN_COLUMN_WIDTH, Math.ceil(fittedWidth));
  saveColumnWidths();
  applyColumnLayout();
  setStatus(`Ширина столбца «${column.label}» подобрана автоматически.`);
}

function setupColumnResizeHandles() {
  tableHead.querySelectorAll("[data-resize-column]").forEach((handle) => {
    handle.title = "Перетащите для изменения ширины. Двойной клик — автоподбор по содержимому.";
  });
}

reloadButton.addEventListener("click", loadRecords);
columnSettingsButton.addEventListener("click", () => setColumnSettingsModalOpen(true));
closeColumnSettingsModalButton.addEventListener("click", () => setColumnSettingsModalOpen(false));
finishColumnSettingsButton.addEventListener("click", () => setColumnSettingsModalOpen(false));
columnSettingsModal.addEventListener("click", (event) => {
  if (event.target === columnSettingsModal) setColumnSettingsModalOpen(false);
});
columnSettingsModal.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setColumnSettingsModalOpen(false);
  }
});
columnSettingsList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-column-visibility]");
  if (!checkbox) return;
  if (checkbox.checked) hiddenColumns.delete(checkbox.dataset.columnVisibility);
  else hiddenColumns.add(checkbox.dataset.columnVisibility);
  saveHiddenColumns();
  applyColumnLayout();
});
showAllColumnsButton.addEventListener("click", () => {
  availableColumns().forEach((column) => hiddenColumns.delete(column.id));
  saveHiddenColumns();
  renderColumnSettings();
  applyColumnLayout();
});
resetColumnWidthsButton.addEventListener("click", () => {
  availableColumns().forEach((column) => delete columnWidths[column.id]);
  saveColumnWidths();
  applyColumnLayout();
  setStatus("Стандартная ширина столбцов восстановлена.");
});
tableScaleInput.addEventListener("input", () => {
  tableScalePercent = Math.min(MAX_TABLE_SCALE, Math.max(MIN_TABLE_SCALE, Number(tableScaleInput.value) || 100));
  applyTableScale();
});
tableScaleInput.addEventListener("change", saveTableScale);
addDealButton.addEventListener("click", () => setAddDealModalOpen(true));
closeAddDealModalButton.addEventListener("click", () => setAddDealModalOpen(false));
cancelAddDealButton.addEventListener("click", () => setAddDealModalOpen(false));
addDealForm.addEventListener("submit", addPlannedDeal);
addDealModal.addEventListener("click", (event) => {
  if (event.target === addDealModal) setAddDealModalOpen(false);
});
addDealModal.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setAddDealModalOpen(false);
  }
});
searchInput.addEventListener("input", render);
[sourceFilter, paymentStatusFilter, paymentTypeFilter, closingDocsFilter, managerFilter].forEach((filter) => {
  filter.addEventListener("change", render);
});
monthFilter.addEventListener("change", () => {
  if (monthFilter.value) resetAppliedDateRange();
  setPeriodPanelOpen(false);
  render();
});
periodToggleButton.addEventListener("click", () => {
  setPeriodPanelOpen(periodPanel.classList.contains("hidden"));
});
periodApplyButton.addEventListener("click", () => {
  const from = periodDateFrom.value;
  const to = periodDateTo.value;
  if (!from || !to) {
    periodError.textContent = "Укажите начало и конец периода.";
    return;
  }
  if (from > to) {
    periodError.textContent = "Дата начала не может быть позже даты окончания.";
    return;
  }
  appliedDateRange = { from, to };
  monthFilter.value = "";
  updatePeriodButton();
  setPeriodPanelOpen(false);
  render();
  setStatus(`Показаны договоры с ${formatDate(from)} по ${formatDate(to)}.`);
});
periodResetButton.addEventListener("click", () => {
  resetAppliedDateRange();
  setPeriodPanelOpen(false);
  render();
});
document.addEventListener("click", (event) => {
  if (!periodPanel.classList.contains("hidden") && !dateFilter.contains(event.target)) setPeriodPanelOpen(false);
});
periodPanel.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setPeriodPanelOpen(false);
    periodToggleButton.focus();
  }
});
tableHead.addEventListener("click", (event) => {
  const sortButton = event.target.closest("[data-sort-field]");
  if (!sortButton) return;
  const field = sortButton.dataset.sortField;
  sortState = {
    field,
    direction: sortState.field === field && sortState.direction === "asc" ? "desc" : "asc",
  };
  render();
});
tableHead.addEventListener("mousedown", startColumnResize);
tableHead.addEventListener("mousedown", startColumnReorder);
tableHead.addEventListener("dblclick", autoFitColumn);
tableHead.addEventListener("dragstart", (event) => {
  const dragHandle = event.target.closest("[data-drag-column]");
  const header = dragHandle?.closest("th[data-column]");
  if (!dragHandle || !header || !isColumnVisible(REGISTRY_COLUMNS.find((column) => column.id === header.dataset.column))) {
    event.preventDefault();
    return;
  }
  draggedColumnId = header.dataset.column;
  header.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedColumnId);
});
tableHead.addEventListener("dragover", (event) => {
  if (!draggedColumnId) return;
  const targetHeader = event.target.closest("th[data-column]");
  if (!targetHeader || targetHeader.dataset.column === draggedColumnId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  tableHead.querySelectorAll(".drop-before, .drop-after").forEach((header) => header.classList.remove("drop-before", "drop-after"));
  const rect = targetHeader.getBoundingClientRect();
  targetHeader.classList.add(event.clientX > rect.left + rect.width / 2 ? "drop-after" : "drop-before");
});
tableHead.addEventListener("drop", (event) => {
  if (!draggedColumnId) return;
  const targetHeader = event.target.closest("th[data-column]");
  if (!targetHeader || targetHeader.dataset.column === draggedColumnId) return;
  event.preventDefault();
  const placeAfter = targetHeader.classList.contains("drop-after");
  moveColumn(draggedColumnId, targetHeader.dataset.column, placeAfter);
  draggedColumnId = "";
  clearColumnDropIndicators();
});
tableHead.addEventListener("dragend", () => {
  draggedColumnId = "";
  clearColumnDropIndicators();
});
registrySheetViewport.addEventListener("scroll", () => {
  if (stickyScrollbar.scrollLeft !== registrySheetViewport.scrollLeft) stickyScrollbar.scrollLeft = registrySheetViewport.scrollLeft;
});
stickyScrollbar.addEventListener("scroll", () => {
  if (registrySheetViewport.scrollLeft !== stickyScrollbar.scrollLeft) registrySheetViewport.scrollLeft = stickyScrollbar.scrollLeft;
});
window.addEventListener("scroll", updateStickyScrollbar, { passive: true });
window.addEventListener("resize", updateStickyScrollbar);
tableBody.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-number]");
  if (deleteButton) {
    deleteRecord(deleteButton.dataset.deleteNumber);
    return;
  }
  const numberLink = event.target.closest("[data-open-number]");
  if (numberLink) {
    event.preventDefault();
    openRecord(numberLink.dataset.openNumber);
    return;
  }
  const editButton = event.target.closest("[data-edit-field]");
  if (editButton) {
    const row = editButton.closest("tr[data-number]");
    startEditing(row.dataset.number, editButton.dataset.editField);
  }
});
tableBody.addEventListener("focusout", (event) => {
  const editor = event.target.closest("[data-registry-editor]");
  if (editor) commitEditor(editor);
});
tableBody.addEventListener("keydown", (event) => {
  const editor = event.target.closest("[data-registry-editor]");
  if (!editor) return;
  if (event.key === "Enter") {
    event.preventDefault();
    editor.blur();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancelEditing();
  }
});
tableBody.addEventListener("change", (event) => {
  const editor = event.target.closest("select[data-registry-field]");
  if (!editor) return;
  if (editor.dataset.registryField === "paymentStatus") {
    const row = editor.closest("tr[data-number]");
    const record = records.find((item) => item.number === row?.dataset.number);
    if (record && editor.value === "Да" && hasPaymentRemainder(record)) {
      const message = `Нельзя поставить «Оплачен — Да»: по договору остаётся ${money(remainder(record))}. Сначала укажите полную оплату в поле «Предоплата».`;
      editor.setCustomValidity(message);
      editor.reportValidity();
      setStatus(message);
      editor.value = record.registryMeta.paymentStatus;
      editor.setCustomValidity("");
    }
    editor.classList.remove("payment-tone-paid", "payment-tone-prepaid", "payment-tone-planned");
    editor.classList.add(paymentTone(editor.value));
  }
  if (editor.dataset.registryField === "closingDocs") {
    editor.classList.remove("closing-tone-complete", "closing-tone-pending");
    editor.classList.add(closingTone(editor.value));
  }
});

async function initRegistry() {
  await window.ManagerAuth.ready;
  loadColumnPreferences();
  loadTableScale();
  setupColumnDragging();
  setupColumnResizeHandles();
  renderColumnSettings();
  applyTableScale();
  applyColumnLayout();
  newDealSource.innerHTML = [
    '<option value="">Выберите источник</option>',
    ...window.ContractRegistry.SOURCE_OPTIONS.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`),
  ].join("");
  updatePeriodButton();
  await loadRecords();
}

initRegistry();
