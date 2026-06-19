const createUserForm = document.querySelector("#createUserForm");
const newUserLogin = document.querySelector("#newUserLogin");
const newUserPassword = document.querySelector("#newUserPassword");
const newUserRole = document.querySelector("#newUserRole");
const createUserButton = document.querySelector("#createUserButton");
const reloadUsersButton = document.querySelector("#reloadUsersButton");
const usersStatus = document.querySelector("#usersStatus");
const usersList = document.querySelector("#usersList");

let users = [];

function setUsersStatus(message, type = "") {
  usersStatus.textContent = message || "";
  usersStatus.classList.toggle("status-error", type === "error");
  usersStatus.classList.toggle("status-success", type === "success");
}

function resetCreateUserForm() {
  createUserForm.reset();
  newUserLogin.value = "";
  newUserPassword.value = "";
  newUserRole.value = "user";
}

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
          <div class="user-password-action">
            <label>
              <span>Новый пароль</span>
              <input type="password" data-user-password autocomplete="new-password" minlength="8" placeholder="Не менее 8 символов" />
            </label>
            <button class="button ghost" type="button" data-change-password>Сменить пароль</button>
          </div>
          <button class="button danger" type="button" data-delete-user${isCurrent ? " disabled" : ""}>Удалить</button>
        </article>`;
    })
    .join("");
}

async function loadUsers(successMessage = "") {
  setUsersStatus("Загружаю пользователей...");
  try {
    users = await apiRequest();
    renderUsers();
    setUsersStatus(successMessage || `Пользователей: ${users.length}`, successMessage ? "success" : "");
  } catch (error) {
    setUsersStatus(error.message, "error");
  }
}

createUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  createUserButton.disabled = true;
  setUsersStatus("Создаю пользователя...");
  try {
    await apiRequest({
      method: "POST",
      body: JSON.stringify({
        login: newUserLogin.value.trim(),
        password: newUserPassword.value,
        role: newUserRole.value,
      }),
    });
    resetCreateUserForm();
    await loadUsers("Пользователь создан и добавлен в список.");
  } catch (error) {
    setUsersStatus(error.message, "error");
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
    await apiRequest({
      method: "PUT",
      body: JSON.stringify({ id: Number(row.dataset.userId), role: roleSelect.value }),
    });
    await loadUsers("Права пользователя обновлены.");
  } catch (error) {
    setUsersStatus(error.message, "error");
    await loadUsers();
  }
});

usersList.addEventListener("click", async (event) => {
  const passwordButton = event.target.closest("[data-change-password]");
  if (passwordButton) {
    const row = passwordButton.closest("[data-user-id]");
    const user = users.find((item) => item.id === Number(row.dataset.userId));
    const passwordInput = row.querySelector("[data-user-password]");
    if (!user || passwordInput.value.length < 8) {
      setUsersStatus("Новый пароль должен содержать не менее 8 символов.", "error");
      passwordInput.focus();
      return;
    }
    passwordButton.disabled = true;
    try {
      await apiRequest({
        method: "PUT",
        body: JSON.stringify({ action: "password", id: user.id, password: passwordInput.value }),
      });
      passwordInput.value = "";
      setUsersStatus(`Пароль пользователя ${user.login} изменён.`, "success");
    } catch (error) {
      setUsersStatus(error.message, "error");
    } finally {
      passwordButton.disabled = false;
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-user]");
  if (!deleteButton) return;
  const row = deleteButton.closest("[data-user-id]");
  const user = users.find((item) => item.id === Number(row.dataset.userId));
  if (!user || !confirm(`Удалить пользователя ${user.login}? Его договоры останутся в реестре администратора.`)) return;
  deleteButton.disabled = true;
  try {
    await apiRequest({ method: "DELETE", body: JSON.stringify({ id: user.id }) });
    await loadUsers("Пользователь удалён.");
  } catch (error) {
    setUsersStatus(error.message, "error");
    deleteButton.disabled = false;
  }
});

reloadUsersButton.addEventListener("click", () => loadUsers());

async function initUsers() {
  await window.ManagerAuth.ready;
  if (!window.ManagerAuth.isAdmin) {
    window.location.replace("index.html");
    return;
  }
  resetCreateUserForm();
  await loadUsers();
}

initUsers();
