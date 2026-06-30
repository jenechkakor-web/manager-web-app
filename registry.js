const searchInput = document.querySelector("#registrySearchInput");
const reloadButton = document.querySelector("#reloadRegistryButton");
const statusLine = document.querySelector("#registryStatus");
const tableBody = document.querySelector("#registryTableBody");
const emptyState = document.querySelector("#registryEmpty");

let records = [];

function escapeHtml(value) {
  return String(value || "")
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

function selectOptions(options, selectedValue, emptyLabel = "Не указано") {
  const values = emptyLabel ? ["", ...options] : options;
  return values
    .map((value) => {
      const label = value || emptyLabel;
      return `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
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

function statusLabel(status) {
  return status === "exported" ? "выгружен" : "черновик";
}

function filteredRecords() {
  const query = searchInput.value.trim().toLowerCase();
  return records.filter(
    (record) =>
      !query || record.number.toLowerCase().includes(query) || record.counterparty.toLowerCase().includes(query),
  );
}

function render() {
  const isAdmin = window.ManagerAuth.isAdmin;
  const visibleRecords = filteredRecords();
  tableBody.innerHTML = visibleRecords
    .map(
      (record) => {
        const meta = record.registryMeta;
        const prepaymentEnabled = meta.paymentStatus === "Да" || meta.paymentStatus === "Предоплата";
        const profitBonus = meta.bonusType === "от прибыли";
        return `
        <tr data-number="${escapeHtml(record.number)}">
          <td><strong>${escapeHtml(record.number)}</strong></td>
          <td>${escapeHtml(formatDate(record.date))}</td>
          <td>${escapeHtml(record.counterparty || "Без контрагента")}</td>
          <td>${escapeHtml(money(record.amount))}</td>
          <td>
            <select class="registry-control" data-registry-field="source" aria-label="Источник">
              ${selectOptions(window.ContractRegistry.SOURCE_OPTIONS, meta.source)}
            </select>
          </td>
          <td>
            <select class="registry-control" data-registry-field="paymentStatus" aria-label="Оплачен">
              ${selectOptions(window.ContractRegistry.PAYMENT_STATUS_OPTIONS, meta.paymentStatus, "")}
            </select>
          </td>
          <td>
            <input class="registry-control registry-money-input" data-registry-field="prepayment" type="number"
              min="0" max="${escapeHtml(record.amount)}" step="0.01" value="${escapeHtml(plainMoney(meta.prepayment))}"
              aria-label="Предоплата" ${prepaymentEnabled ? "" : "disabled"} />
          </td>
          <td class="registry-calculated">${escapeHtml(money(remainder(record)))}</td>
          <td>
            <select class="registry-control" data-registry-field="paymentType" aria-label="Вид оплаты">
              ${selectOptions(window.ContractRegistry.PAYMENT_TYPE_OPTIONS, meta.paymentType)}
            </select>
          </td>
          <td>
            <select class="registry-control" data-registry-field="closingDocs" aria-label="Закрывашки">
              ${selectOptions(window.ContractRegistry.CLOSING_DOCS_OPTIONS, meta.closingDocs, "")}
            </select>
          </td>
          <td>
            <select class="registry-control" data-registry-field="bonusType" aria-label="Тип бонуса">
              ${selectOptions(window.ContractRegistry.BONUS_TYPE_OPTIONS, meta.bonusType, "")}
            </select>
          </td>
          <td>
            <input class="registry-control registry-money-input" data-registry-field="bonusAmount" type="number"
              min="0" step="0.01" value="${escapeHtml(plainMoney(bonusAmount(record)))}"
              aria-label="Сумма бонуса" ${profitBonus ? "" : "disabled"} />
          </td>
          <td><span class="status-badge ${record.status}">${escapeHtml(statusLabel(record.status))}</span></td>
          ${isAdmin ? `<td>${escapeHtml(record.ownerLogin || "admin")}</td>` : ""}
          ${
            isAdmin
              ? `<td><button class="icon-button" data-delete-number="${escapeHtml(record.number)}" type="button" title="Удалить договор">×</button></td>`
              : ""
          }
        </tr>`;
      },
    )
    .join("");
  emptyState.classList.toggle("hidden", visibleRecords.length > 0);
}

async function updateRegistryField(control) {
  const row = control.closest("tr[data-number]");
  const record = records.find((item) => item.number === row?.dataset.number);
  if (!record) return;
  const field = control.dataset.registryField;
  const previousMeta = { ...record.registryMeta };
  const value = control.type === "number" ? Math.max(0, Number(control.value) || 0) : control.value;
  if (field === "prepayment" && value > record.amount) {
    control.setCustomValidity("Предоплата не может превышать полную сумму договора.");
    control.reportValidity();
    return;
  }
  control.setCustomValidity("");
  record.registryMeta = { ...record.registryMeta, [field]: value };
  render();
  setStatus(`Сохраняю изменения по договору № ${record.number}...`);
  try {
    const result = await window.ContractRegistry.updateRegistryMeta(record.number, { [field]: value });
    if (result.record) record.registryMeta = result.record.registryMeta;
    if (result.records.length) records = result.records;
    render();
    setStatus(`Изменения по договору № ${record.number} сохранены.`);
  } catch (error) {
    record.registryMeta = previousMeta;
    render();
    setStatus(error.message || "Не удалось сохранить изменения в реестре.");
  }
}

async function loadRecords() {
  setStatus("Загружаю реестр...");
  try {
    records = await window.ContractRegistry.loadRegistry({ cache: false });
    render();
    setStatus(records.length ? `Загружено договоров: ${records.length}` : "Реестр пуст.");
  } catch (error) {
    records = [];
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
    render();
    setStatus("Договор удалён из общего реестра.");
  } catch (error) {
    setStatus(error.message || "Не удалось удалить договор из реестра.");
  }
}

reloadButton.addEventListener("click", loadRecords);
searchInput.addEventListener("input", render);
tableBody.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-number]");
  if (deleteButton) {
    event.stopPropagation();
    deleteRecord(deleteButton.dataset.deleteNumber);
    return;
  }
  if (event.target.closest("input, select")) return;
  const row = event.target.closest("tr[data-number]");
  if (row) openRecord(row.dataset.number);
});
tableBody.addEventListener("change", (event) => {
  const control = event.target.closest("[data-registry-field]");
  if (control?.tagName === "SELECT") updateRegistryField(control);
});
tableBody.addEventListener("focusout", (event) => {
  const control = event.target.closest('input[data-registry-field]');
  if (control) updateRegistryField(control);
});

async function initRegistry() {
  await window.ManagerAuth.ready;
  await loadRecords();
}

initRegistry();
