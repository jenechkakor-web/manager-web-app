const createUserForm = document.querySelector("#createUserForm");
const newUserLogin = document.querySelector("#newUserLogin");
const newUserPassword = document.querySelector("#newUserPassword");
const newUserRole = document.querySelector("#newUserRole");
const createUserButton = document.querySelector("#createUserButton");
const usersStatus = document.querySelector("#usersStatus");
const usersList = document.querySelector("#usersList");

let users = [];

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU").format(date);
}

async function apiRequest(options = {}) {
  const response = await fetch("/api/users", {
    cache: "no-store",
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Не удалось выполнить операцию.");
  return result;
}

function renderUsers() {
  const currentUserId = window.ManagerAuth.user?.id;
  usersList.innerHTML = users
    .map((user) => {
      const isCurrent = user.id === currentUserId;
      return `
        <article class="user-row" data-user-id="${user.id}">
          <div class="user-name">
            <strong>${escapeHtml(user.login)}</strong>
            <small>${isCurrent ? "Текущая учётная запись" : `Создан ${escapeHtml(formatDate(user.createdAt))}`}</small>
          </div>
          <label>
            <span>Права</span>
            <select data-user-role${isCurrent ? " disabled" : ""}>
              <option value="user"${user.role === "user" ? " selected" : ""}>Пользователь</option>
              <option value="admin"${user.role === "admin" ? " selected" : ""}>Администратор</option>
            </select>
          </label>
          <button class="button danger" type="button" data-delete-user${isCurrent ? " disabled" : ""}>Удалить</button>
        </article>`;
    })
    .join("");
}

async function loadUsers() {
  usersStatus.textContent = "Загружаю пользователей...";
  try {
    users = await apiRequest();
    renderUsers();
    usersStatus.textContent = `Пользователей: ${users.length}`;
  } catch (error) {
    usersStatus.textContent = error.message;
  }
}

createUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  createUserButton.disabled = true;
  usersStatus.textContent = "Создаю пользователя...";
  try {
    users = await apiRequest({
      method: "POST",
      body: JSON.stringify({
        login: newUserLogin.value.trim(),
        password: newUserPassword.value,
        role: newUserRole.value,
      }),
    });
    createUserForm.reset();
    renderUsers();
    usersStatus.textContent = "Пользователь создан.";
  } catch (error) {
    usersStatus.textContent = error.message;
  } finally {
    createUserButton.disabled = false;
  }
});

usersList.addEventListener("change", async (event) => {
  const roleSelect = event.target.closest("[data-user-role]");
  if (!roleSelect) return;
  const row = roleSelect.closest("[data-user-id]");
  roleSelect.disabled = true;
  try {
    users = await apiRequest({
      method: "PUT",
      body: JSON.stringify({ id: Number(row.dataset.userId), role: roleSelect.value }),
    });
    renderUsers();
    usersStatus.textContent = "Права пользователя обновлены.";
  } catch (error) {
    usersStatus.textContent = error.message;
    await loadUsers();
  }
});

usersList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-user]");
  if (!deleteButton) return;
  const row = deleteButton.closest("[data-user-id]");
  const user = users.find((item) => item.id === Number(row.dataset.userId));
  if (!user || !confirm(`Удалить пользователя ${user.login}? Его договоры останутся в реестре администратора.`)) return;
  deleteButton.disabled = true;
  try {
    users = await apiRequest({ method: "DELETE", body: JSON.stringify({ id: user.id }) });
    renderUsers();
    usersStatus.textContent = "Пользователь удалён.";
  } catch (error) {
    usersStatus.textContent = error.message;
    deleteButton.disabled = false;
  }
});

async function initUsers() {
  await window.ManagerAuth.ready;
  if (!window.ManagerAuth.isAdmin) {
    window.location.replace("index.html");
    return;
  }
  await loadUsers();
}

initUsers();
