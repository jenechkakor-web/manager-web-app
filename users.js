const createUserForm = document.querySelector("#createUserForm");
const newUserLogin = document.querySelector("#newUserLogin");
const newUserFullName = document.querySelector("#newUserFullName");
const newUserPassword = document.querySelector("#newUserPassword");
const newUserRole = document.querySelector("#newUserRole");
const createUserButton = document.querySelector("#createUserButton");
const reloadUsersButton = document.querySelector("#reloadUsersButton");
const usersStatus = document.querySelector("#usersStatus");
const usersList = document.querySelector("#usersList");
const bitrixStatus = document.querySelector("#bitrixStatus");
const bitrixManagers = document.querySelector("#bitrixManagers");
const bitrixConfigForm = document.querySelector("#bitrixConfigForm");
const bitrixSyncForm = document.querySelector("#bitrixSyncForm");

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
          <div class="user-profile-action">
            <label>
              <span>ФИО</span>
              <input data-user-full-name maxlength="191" autocomplete="off" placeholder="Имя Фамилия, как в Б24" value="${escapeHtml(user.fullName)}" />
            </label>
            <button class="button ghost" type="button" data-save-profile>Сохранить ФИО</button>
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
    await loadBitrixStatus();
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
        fullName: newUserFullName.value.trim(),
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
  const profileButton = event.target.closest("[data-save-profile]");
  if (profileButton) {
    const row = profileButton.closest("[data-user-id]");
    const input = row.querySelector("[data-user-full-name]");
    profileButton.disabled = true;
    try {
      users = await apiRequest({ method: "PUT", body: JSON.stringify({ action: "profile", id: Number(row.dataset.userId), fullName: input.value.trim() }) });
      setUsersStatus("ФИО сохранено. Оно используется для связи с Битрикс24.", "success");
      await loadBitrixStatus();
    } catch (error) {
      setUsersStatus(error.message, "error");
    } finally {
      profileButton.disabled = false;
    }
    return;
  }
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

async function bitrixRequest(route, body) {
  const response = await fetch(`/api/bitrix/${route}`, { cache: "no-store", method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "Ошибка подключения Б24."), {status:response.status});
  return result;
}

async function loadBitrixStatus() {
  try {
    const status = await bitrixRequest("status");
    bitrixStatus.textContent = status.configured ? `Подключение настроено: ${status.domain}.` : "Подключение ещё не настроено.";
    bitrixManagers.innerHTML = `<ul>${status.managers.map(manager => `<li>${escapeHtml(manager.name)} — ${manager.linked ? escapeHtml(manager.login) : "заполните ФИО в единственной учётной записи"}</li>`).join("")}</ul>`;
    for (const key of ["numberField"]) {
      if (document.activeElement !== bitrixConfigForm.elements[key]) bitrixConfigForm.elements[key].value = status[key] || "";
    }
  } catch (error) { bitrixStatus.textContent = error.message; }
}

bitrixConfigForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await bitrixRequest("config", Object.fromEntries(new FormData(bitrixConfigForm)));
    bitrixConfigForm.elements.webhookUrl.value = "";
    bitrixConfigForm.elements.eventToken.value = "";
    await loadBitrixStatus();
  } catch (error) { bitrixStatus.textContent = error.message; }
  finally { button.disabled = false; }
});

bitrixSyncForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  bitrixStatus.textContent = "Синхронизирую сделку…";
  try {
    const result = await bitrixRequest("sync", { dealId: bitrixSyncForm.elements.dealId.value.trim() });
    const skipped = { manager_not_allowed_or_unmapped: "Создатель сделки не связан с разрешённым пользователем приложения.", record_deleted: "Запись ранее удалена из реестра.", stale_snapshot: "В реестре уже сохранены более свежие данные." };
    bitrixStatus.textContent = result.synced ? `Данные сделки ${result.number} обновлены.` : skipped[result.skipped] || "Сделка пропущена.";
  } catch (error) { bitrixStatus.textContent = error.message; }
  finally { button.disabled = false; }
});

async function initUsers() {
  await window.ManagerAuth.ready;
  if (!window.ManagerAuth.isAdmin) {
    window.location.replace("index.html");
    return;
  }
  resetCreateUserForm();
  await loadUsers();
}

const refreshButton = document.querySelector('#bitrixRefreshButton');
const refreshStop = document.querySelector('#bitrixRefreshStop');
const refreshStatus = document.querySelector('#bitrixRefreshStatus');
const refreshProgress = document.querySelector('#bitrixRefreshProgress');
const refreshResults = document.querySelector('#bitrixRefreshResults');
let refreshStopped = false;
refreshStop.addEventListener('click', () => { refreshStopped = true; refreshStop.disabled = true; });
refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true; refreshStop.disabled = false; refreshStopped = false;
  refreshResults.replaceChildren(); refreshStatus.textContent = 'Получаю список сделок…';
  const runId = crypto.randomUUID();
  let completed = 0, updated = 0, skipped = 0, failed = 0;
  const reasons = {needs_deal_id:'Номер требует уточнения', creator_mismatch:'Создатель Б24 отличается от менеджера реестра',
    manager_not_allowed_or_unmapped:'Создатель не связан с разрешённым менеджером', record_deleted:'Запись удалена',
    link_conflict:'Конфликт привязки к Б24', stale_snapshot:'В реестре более свежие данные'};
  try {
    const list = await bitrixRequest('refresh');
    refreshProgress.max = Math.max(1,list.length); refreshProgress.value = 0;
    for (const {number} of list) {
      if (refreshStopped) break;
      const row = document.createElement('li'); row.dataset.number = number;
      row.textContent = `${number}: загружаю…`; refreshResults.append(row);
      try {
        let result;
        for (let attempt=0; attempt<3; attempt++) {
          try { result = await bitrixRequest('refresh',{number,runId}); break; }
          catch(error) {
            if (attempt===2 || ![429,502,503,504].includes(error.status)) throw error;
            await new Promise(resolve=>setTimeout(resolve,3000*(attempt+1)));
          }
        }
        row.dataset.result = result.synced ? 'updated' : 'skipped';
        if (result.synced) {
          updated++;
          row.textContent = `${number}: ${result.title} — ${new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(result.amount)}`;
        } else { skipped++; row.textContent = `${number}: ${reasons[result.skipped] || 'Пропущена'}`; }
      } catch(error) { failed++; row.dataset.result='error'; row.textContent=`${number}: ${error.message}`; }
      completed++; refreshProgress.value = completed;
      refreshStatus.textContent = `Обработано ${completed} из ${list.length}. Обновлено: ${updated}. Пропущено: ${skipped}. Ошибок: ${failed}.`;
      if (completed<list.length && !refreshStopped) await new Promise(resolve=>setTimeout(resolve,2400));
    }
    refreshStatus.textContent = `${refreshStopped ? 'Остановлено.' : 'Обновление завершено.'} Обработано ${completed} из ${list.length}. Обновлено: ${updated}. Пропущено: ${skipped}. Ошибок: ${failed}.`;
  } catch(error) { refreshStatus.textContent=error.message; }
  finally { refreshButton.disabled=false; refreshStop.disabled=true; }
});

initUsers();
