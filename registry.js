const searchInput = document.querySelector("#registrySearchInput");
const reloadButton = document.querySelector("#reloadRegistryButton");
const statusLine = document.querySelector("#registryStatus");
const tableBody = document.querySelector("#registryTableBody");
const emptyState = document.querySelector("#registryEmpty");
const monthFilter = document.querySelector("#registryMonthFilter");
const paymentStatusFilter = document.querySelector("#registryPaymentStatusFilter");
const paymentTypeFilter = document.querySelector("#registryPaymentTypeFilter");
const closingDocsFilter = document.querySelector("#registryClosingDocsFilter");
const managerFilter = document.querySelector("#registryManagerFilter");

let records = [];
let editingCell = null;

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
  setFilterOptions(monthFilter, months, "Все месяцы", formatMonth);
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

function remainder(record) {
  return Math.max(0, record.amount - (Number(record.registryMeta.prepayment) || 0));
}

function dealStatus(record) {
  const { paymentStatus, closingDocs } = record.registryMeta;
  const closingComplete = closingDocs === "Отправлены" || closingDocs === "Не нужно";
  if (paymentStatus === "Да" && closingComplete) return "Завершена";
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

function statusLabel(status) {
  return status === "exported" ? "выгружен" : "черновик";
}

function filteredRecords() {
  const query = searchInput.value.trim().toLowerCase();
  return records.filter((record) => {
    const meta = record.registryMeta;
    const ownerLogin = record.ownerLogin || "admin";
    return (
      (!query || record.number.toLowerCase().includes(query) || record.counterparty.toLowerCase().includes(query)) &&
      (!monthFilter.value || String(record.date || "").startsWith(monthFilter.value)) &&
      (!paymentStatusFilter.value || meta.paymentStatus === paymentStatusFilter.value) &&
      (!paymentTypeFilter.value || meta.paymentType === paymentTypeFilter.value) &&
      (!closingDocsFilter.value || meta.closingDocs === closingDocsFilter.value) &&
      (!managerFilter.value || ownerLogin === managerFilter.value)
    );
  });
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
  const toneClass = field === "paymentStatus" ? paymentTone(meta.paymentStatus) : "";
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
          ${editableCell(record, "closingDocs")}
          ${staticCell(currentDealStatus, dealTone(currentDealStatus))}
          ${editableCell(record, "bonusType")}
          ${editableCell(record, "bonusAmount", profitBonus)}
          ${markupCell(`<span class="status-badge ${record.status}">${escapeHtml(statusLabel(record.status))}</span>`)}
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
  if (field === "prepayment" && value > record.amount) {
    control.setCustomValidity("Предоплата не может превышать полную сумму договора.");
    control.reportValidity();
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
[monthFilter, paymentStatusFilter, paymentTypeFilter, closingDocsFilter, managerFilter].forEach((filter) => {
  filter.addEventListener("change", render);
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
  const editor = event.target.closest('select[data-registry-field="paymentStatus"]');
  if (!editor) return;
  editor.classList.remove("payment-tone-paid", "payment-tone-prepaid", "payment-tone-planned");
  editor.classList.add(paymentTone(editor.value));
});

async function initRegistry() {
  await window.ManagerAuth.ready;
  await loadRecords();
}

initRegistry();
