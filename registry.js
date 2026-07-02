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
const tableHead = document.querySelector(".registry-table thead");

let records = [];
let editingCell = null;
let sortState = { field: null, direction: "asc" };
let appliedDateRange = { from: "", to: "" };
const EMPTY_SOURCE_FILTER = "__empty_source__";
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

function sortValue(record, field) {
  const meta = record.registryMeta;
  const values = {
    number: record.number,
    date: record.date,
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
      (!query || record.number.toLowerCase().includes(query) || record.counterparty.toLowerCase().includes(query)) &&
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

function staticCell(value, extraClass = "", title = value) {
  return `<td><div class="registry-cell-value registry-cell-readonly ${extraClass}" title="${escapeHtml(title)}">${escapeHtml(value)}</div></td>`;
}

function markupCell(content, extraClass = "") {
  return `<td><div class="registry-cell-value registry-cell-readonly ${extraClass}">${content}</div></td>`;
}

function editableDisplayValue(record, field) {
  const meta = record.registryMeta;
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
  if (isEditing) return `<td class="registry-data-cell is-editing">${editorMarkup(record, field)}</td>`;
  const value = editableDisplayValue(record, field);
  if (!enabled) return staticCell(value, `${extraClass} registry-cell-disabled`);
  return `<td class="registry-data-cell">
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
          <td><a class="registry-cell-value registry-number-link" data-open-number="${escapeHtml(record.number)}" href="index.html">${escapeHtml(record.number)}</a></td>
          ${staticCell(formatDate(record.date))}
          ${staticCell(record.counterparty || "Без контрагента", "registry-counterparty", record.counterparty || "Без контрагента")}
          ${staticCell(money(record.amount), "registry-money-value")}
          ${editableCell(record, "source")}
          ${editableCell(record, "paymentStatus", true, paymentTone(meta.paymentStatus))}
          ${editableCell(record, "prepayment", prepaymentEnabled)}
          ${staticCell(money(remainder(record)), "registry-money-value")}
          ${editableCell(record, "paymentType")}
          ${editableCell(record, "closingDocs", true, closingTone(meta.closingDocs))}
          ${staticCell(currentDealStatus, dealTone(currentDealStatus))}
          ${editableCell(record, "bonusType")}
          ${editableCell(record, "bonusAmount", profitBonus)}
          ${isAdmin ? markupCell(`<span class="status-badge ${record.status}">${escapeHtml(statusLabel(record.status))}</span>`) : ""}
          ${isAdmin ? staticCell(record.ownerLogin || "admin") : ""}
          ${
            isAdmin
              ? `<td><div class="registry-cell-value registry-cell-actions"><button class="icon-button" data-delete-number="${escapeHtml(record.number)}" type="button" title="Удалить договор">×</button></div></td>`
              : ""
          }
        </tr>`;
    })
    .join("");
  emptyState.classList.toggle("hidden", visibleRecords.length > 0);
  renderSortHeaders();
  renderSummary(visibleRecords);
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
  const value = control.type === "number" ? Math.max(0, Number(control.value) || 0) : control.value;
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
  setStatus(`Сохраняю изменения по договору № ${record.number}...`);
  setTimeout(() => {
    if (!editingCell) render();
  }, 0);
  try {
    const result = await window.ContractRegistry.updateRegistryMeta(record.number, { [field]: value });
    if (result.records.length) records = result.records;
    const currentRecord = records.find((item) => item.number === record.number);
    if (result.record && currentRecord) currentRecord.registryMeta = result.record.registryMeta;
    if (!editingCell) render();
    setStatus(`Изменения по договору № ${record.number} сохранены.`);
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
    setStatus(records.length ? `Загружено договоров: ${records.length}` : "Реестр пуст.");
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
  window.ContractRegistry.setContractToOpen(record.data);
  window.location.href = "index.html";
}

async function deleteRecord(number) {
  if (!window.ManagerAuth.isAdmin) return;
  if (!confirm(`Удалить договор № ${number} из реестра?`)) return;
  try {
    setStatus("Удаляю договор...");
    const result = await window.ContractRegistry.deleteRecord(number);
    records = result.records;
    renderFilterOptions();
    render();
    setStatus("Договор удалён из общего реестра.");
  } catch (error) {
    setStatus(error.message || "Не удалось удалить договор из реестра.");
  }
}

reloadButton.addEventListener("click", loadRecords);
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
  updatePeriodButton();
  await loadRecords();
}

initRegistry();
