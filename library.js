const ADMIN_LOGIN = "admin";
const ADMIN_PASSWORD = "admin2026";
const GITHUB_OWNER = "jenechkakor-web";
const GITHUB_REPO = "manager-web-app";
const GITHUB_BRANCH = "main";
const GITHUB_PRESETS_PATH = "templates/tech-presets.json";
const GITHUB_RAW_PRESETS_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${GITHUB_PRESETS_PATH}`;
const GITHUB_CONTENTS_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PRESETS_PATH}`;

const loginPanel = document.querySelector("#libraryLoginPanel");
const editorPanel = document.querySelector("#libraryEditorPanel");
const loginInput = document.querySelector("#libraryLoginInput");
const passwordInput = document.querySelector("#libraryPasswordInput");
const loginButton = document.querySelector("#libraryLoginButton");
const reloadButton = document.querySelector("#reloadLibraryButton");
const saveButton = document.querySelector("#saveLibraryButton");
const addButton = document.querySelector("#addLibraryPresetButton");
const tokenInput = document.querySelector("#libraryGitHubTokenInput");
const groupFilter = document.querySelector("#libraryGroupFilter");
const groupList = document.querySelector("#libraryGroupList");
const subgroupList = document.querySelector("#librarySubgroupList");
const presetList = document.querySelector("#libraryPresetList");
const statusLine = document.querySelector("#libraryStatus");

let presets = [];
let isAdmin = sessionStorage.getItem("techLibraryToken") === "browser-admin";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizePresets(source) {
  return (Array.isArray(source) ? source : [])
    .map((entry) => ({
      group: String(entry.group || entry.category || "Общее").trim(),
      subgroup: String(entry.subgroup || entry.subcategory || "Без подгруппы").trim(),
      title: String(entry.title || "").trim(),
      description: String(entry.description || "").trim(),
    }))
    .filter((entry) => entry.title && entry.description)
    .map((entry) => ({
      ...entry,
      group: entry.group || "Общее",
      subgroup: entry.subgroup || "Без подгруппы",
    }));
}

function cacheBusted(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

function isLocalAppServer() {
  return ["127.0.0.1", "localhost"].includes(window.location.hostname);
}

function presetEndpoints() {
  const endpoints = [cacheBusted(GITHUB_RAW_PRESETS_URL)];
  if (isLocalAppServer()) endpoints.push(cacheBusted("/api/tech-presets"));
  endpoints.push(cacheBusted("templates/tech-presets.json"));
  return endpoints;
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function setStatus(message) {
  statusLine.textContent = message || "";
}

async function loadPresets() {
  setStatus("Загружаю справочник...");
  for (const endpoint of presetEndpoints()) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) continue;
      const loaded = normalizePresets(await response.json());
      if (loaded.length) {
        presets = loaded;
        render();
        setStatus(`Загружено шаблонов: ${presets.length}`);
        return;
      }
    } catch {
      // Try the next source.
    }
  }

  presets = [];
  render();
  setStatus("Не удалось загрузить справочник.");
}

function uniqueValues(field) {
  return [...new Set(presets.map((preset) => preset[field]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
}

function renderDatalists() {
  groupList.innerHTML = uniqueValues("group").map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  subgroupList.innerHTML = uniqueValues("subgroup")
    .map((value) => `<option value="${escapeHtml(value)}"></option>`)
    .join("");
}

function renderGroupFilter() {
  const selected = groupFilter.value;
  const groups = uniqueValues("group");
  groupFilter.innerHTML = `<option value="">Все группы</option>${groups
    .map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)
    .join("")}`;
  if (groups.includes(selected)) groupFilter.value = selected;
}

function renderRows() {
  const selectedGroup = groupFilter.value;
  const visiblePresets = presets
    .map((preset, index) => ({ preset, index }))
    .filter(({ preset }) => !selectedGroup || preset.group === selectedGroup);

  presetList.innerHTML = visiblePresets
    .map(
      ({ preset, index }) => `
        <div class="library-row" data-index="${index}">
          <div class="library-group-grid">
            <label>
              <span>Группа</span>
              <input class="library-group" list="libraryGroupList" value="${escapeHtml(preset.group)}" />
            </label>
            <label>
              <span>Подгруппа</span>
              <input class="library-subgroup" list="librarySubgroupList" value="${escapeHtml(preset.subgroup)}" />
            </label>
            <button class="icon-button" data-remove-preset="${index}" type="button" title="Удалить шаблон">×</button>
          </div>
          <label>
            <span>Название шаблона</span>
            <input class="library-title" value="${escapeHtml(preset.title)}" />
          </label>
          <label>
            <span>Текст описания</span>
            <textarea class="library-description" rows="5">${escapeHtml(preset.description)}</textarea>
          </label>
        </div>
      `,
    )
    .join("");
}

function render() {
  renderDatalists();
  renderGroupFilter();
  renderRows();
}

function syncVisibleRows() {
  presetList.querySelectorAll(".library-row").forEach((row) => {
    const index = Number(row.dataset.index);
    presets[index] = {
      group: row.querySelector(".library-group").value.trim(),
      subgroup: row.querySelector(".library-subgroup").value.trim(),
      title: row.querySelector(".library-title").value.trim(),
      description: row.querySelector(".library-description").value.trim(),
    };
  });
}

function readEditorPresets() {
  syncVisibleRows();
  const normalized = normalizePresets(presets);

  if (normalized.length !== presets.length) {
    alert("Заполните группу, подгруппу, название и текст каждого шаблона.");
    return null;
  }

  const keys = normalized.map((preset) => preset.title.toLowerCase());
  if (new Set(keys).size !== keys.length) {
    alert("Названия шаблонов не должны повторяться.");
    return null;
  }

  return normalized;
}

function showEditor() {
  loginPanel.classList.add("hidden");
  editorPanel.classList.remove("hidden");
  saveButton.classList.remove("hidden");
  tokenInput.value = localStorage.getItem("techGitHubToken") || "";
  render();
}

function login() {
  const loginValue = loginInput.value.trim();
  const passwordValue = passwordInput.value;
  if (loginValue !== ADMIN_LOGIN || passwordValue !== ADMIN_PASSWORD) {
    alert("Неверный логин или пароль.");
    return;
  }

  isAdmin = true;
  sessionStorage.setItem("techLibraryToken", "browser-admin");
  passwordInput.value = "";
  showEditor();
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function saveToGitHub(nextPresets, token) {
  const currentResponse = await fetch(`${GITHUB_CONTENTS_API_URL}?ref=${GITHUB_BRANCH}`, {
    headers: githubHeaders(token),
    cache: "no-store",
  });
  if (!currentResponse.ok) throw new Error("Не удалось прочитать файл на GitHub.");

  const currentFile = await currentResponse.json();
  const content = `${JSON.stringify(nextPresets, null, 2)}\n`;
  const saveResponse = await fetch(GITHUB_CONTENTS_API_URL, {
    method: "PUT",
    headers: {
      ...githubHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "Update technical description presets",
      content: utf8ToBase64(content),
      branch: GITHUB_BRANCH,
      sha: currentFile.sha,
    }),
  });

  if (!saveResponse.ok) {
    const details = await saveResponse.json().catch(() => ({}));
    throw new Error(details.message || "Не удалось сохранить файл на GitHub.");
  }
}

async function saveLibrary() {
  const nextPresets = readEditorPresets();
  if (!nextPresets) return;

  const token = tokenInput.value.trim();
  if (!token) {
    alert("Введите GitHub token для сохранения общего справочника.");
    return;
  }

  try {
    setStatus("Сохраняю справочник...");
    await saveToGitHub(nextPresets, token);
    localStorage.setItem("techGitHubToken", token);
    presets = nextPresets;
    render();
    setStatus("Справочник сохранен. Обновление у менеджеров появится после перезагрузки страницы.");
  } catch (error) {
    setStatus("");
    alert(error.message || "Не удалось сохранить справочник.");
  }
}

function addPreset() {
  syncVisibleRows();
  presets.push({
    group: groupFilter.value || "Новая группа",
    subgroup: "Новая подгруппа",
    title: "Новый шаблон",
    description: "Описание конструкции.",
  });
  render();
  presetList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
}

loginButton.addEventListener("click", login);
passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});
reloadButton.addEventListener("click", loadPresets);
saveButton.addEventListener("click", saveLibrary);
addButton.addEventListener("click", addPreset);
groupFilter.addEventListener("change", () => {
  syncVisibleRows();
  renderRows();
});
presetList.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-preset]");
  if (!removeButton) return;
  presets.splice(Number(removeButton.dataset.removePreset), 1);
  render();
});
presetList.addEventListener("input", () => {
  setStatus("Есть несохраненные изменения.");
});

loadPresets().then(() => {
  if (isAdmin) showEditor();
});
