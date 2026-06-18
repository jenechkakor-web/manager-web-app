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
      (record) => `
        <tr data-number="${escapeHtml(record.number)}">
          <td><strong>${escapeHtml(record.number)}</strong></td>
          <td>${escapeHtml(formatDate(record.date))}</td>
          <td>${escapeHtml(record.counterparty || "Без контрагента")}</td>
          <td>${escapeHtml(money(record.amount))}</td>
          <td><span class="status-badge ${record.status}">${escapeHtml(statusLabel(record.status))}</span></td>
          ${isAdmin ? `<td>${escapeHtml(record.ownerLogin || "admin")}</td>` : ""}
          ${
            isAdmin
              ? `<td><button class="icon-button" data-delete-number="${escapeHtml(record.number)}" type="button" title="Удалить договор">×</button></td>`
              : ""
          }
        </tr>`,
    )
    .join("");
  emptyState.classList.toggle("hidden", visibleRecords.length > 0);
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
  const row = event.target.closest("tr[data-number]");
  if (row) openRecord(row.dataset.number);
});

async function initRegistry() {
  await window.ManagerAuth.ready;
  await loadRecords();
}

initRegistry();
