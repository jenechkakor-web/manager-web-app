const ADMIN_LOGIN = "admin";
const ADMIN_PASSWORD = "admin2026";

const searchInput = document.querySelector("#registrySearchInput");
const reloadButton = document.querySelector("#reloadRegistryButton");
const adminToggleButton = document.querySelector("#adminToggleButton");
const loginPanel = document.querySelector("#registryLoginPanel");
const adminPanel = document.querySelector("#registryAdminPanel");
const loginInput = document.querySelector("#registryLoginInput");
const passwordInput = document.querySelector("#registryPasswordInput");
const loginButton = document.querySelector("#registryLoginButton");
const logoutButton = document.querySelector("#registryLogoutButton");
const tokenInput = document.querySelector("#registryGitHubTokenInput");
const saveTokenButton = document.querySelector("#saveRegistryTokenButton");
const statusLine = document.querySelector("#registryStatus");
const tableBody = document.querySelector("#registryTableBody");
const emptyState = document.querySelector("#registryEmpty");

let records = [];
let isAdmin = sessionStorage.getItem("contractsRegistryAdmin") === "true";

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
  if (Number.isNaN(date.getTime())) return dateValue;
  return new Intl.DateTimeFormat("ru-RU").format(date);
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

function renderAdminState() {
  adminPanel.classList.toggle("hidden", !isAdmin);
  loginPanel.classList.add("hidden");
  adminToggleButton.classList.toggle("hidden", isAdmin);
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("hidden", !isAdmin);
  });
  if (isAdmin) tokenInput.value = window.ContractRegistry.registryToken();
}

function filteredRecords() {
  const query = searchInput.value.trim().toLowerCase();
  return records.filter((record) => !query || record.number.toLowerCase().includes(query));
}

function render() {
  renderAdminState();
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
          <td class="admin-only${isAdmin ? "" : " hidden"}">
            <button class="icon-button" data-delete-number="${escapeHtml(record.number)}" type="button" title="Удалить договор">×</button>
          </td>
        </tr>
      `,
    )
    .join("");

  emptyState.classList.toggle("hidden", visibleRecords.length > 0);
}

async function loadRecords() {
  try {
    setStatus("Загружаю реестр...");
    records = await window.ContractRegistry.loadRegistry();
    render();
    setStatus(records.length ? `Загружено договоров: ${records.length}` : "Реестр пуст.");
  } catch {
    records = window.ContractRegistry.getLocalRecords();
    render();
    setStatus("Не удалось загрузить общий реестр. Показаны локальные записи.");
  }
}

function openRecord(number) {
  const record = records.find((item) => item.number === number);
  if (!record) return;
  window.ContractRegistry.setContractToOpen(record.data);
  window.open("index.html?v=20260606-registry-1", "_blank", "noopener");
}

function login() {
  const loginValue = loginInput.value.trim();
  const passwordValue = passwordInput.value;
  if (loginValue !== ADMIN_LOGIN || passwordValue !== ADMIN_PASSWORD) {
    alert("Неверный логин или пароль.");
    return;
  }

  isAdmin = true;
  sessionStorage.setItem("contractsRegistryAdmin", "true");
  passwordInput.value = "";
  render();
}

function logout() {
  isAdmin = false;
  sessionStorage.removeItem("contractsRegistryAdmin");
  render();
}

async function deleteRecord(number) {
  if (!isAdmin) return;
  if (!confirm(`Удалить договор № ${number} из реестра?`)) return;

  try {
    setStatus("Удаляю договор...");
    const result = await window.ContractRegistry.deleteRecord(number, {
      token: window.ContractRegistry.registryToken(),
    });
    records = result.records;
    render();
    setStatus(result.remoteSaved ? "Договор удалён из общего реестра." : "Договор удалён из локального реестра.");
  } catch (error) {
    alert(error.message || "Не удалось удалить договор из реестра.");
    setStatus("");
  }
}

adminToggleButton.addEventListener("click", () => {
  loginPanel.classList.toggle("hidden");
  loginInput.focus();
});

loginButton.addEventListener("click", login);
passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});
logoutButton.addEventListener("click", logout);
reloadButton.addEventListener("click", loadRecords);
searchInput.addEventListener("input", render);
saveTokenButton.addEventListener("click", async () => {
  window.ContractRegistry.setRegistryToken(tokenInput.value.trim());
  setStatus("Token сохранён для этого браузера.");
  await loadRecords();
});

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

renderAdminState();
loadRecords();
