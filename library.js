const GITHUB_OWNER = "jenechkakor-web";
const GITHUB_REPO = "manager-web-app";
const GITHUB_BRANCH = "main";
const GITHUB_PRESETS_PATH = "templates/tech-presets.json";
const GITHUB_RAW_PRESETS_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${GITHUB_PRESETS_PATH}`;

const reloadButton = document.querySelector("#reloadLibraryButton");
const saveButton = document.querySelector("#saveLibraryButton");
const addButton = document.querySelector("#addLibraryPresetButton");
const groupFilter = document.querySelector("#libraryGroupFilter");
const subgroupFilter = document.querySelector("#librarySubgroupFilter");
const presetList = document.querySelector("#libraryPresetList");
const statusLine = document.querySelector("#libraryStatus");

let presets = [];
let isAdmin = false;
const CUSTOM_CHOICE = "__custom__";

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

function presetEndpoints() {
  if (window.ManagerAuth?.usesServerAuth) return [cacheBusted("/api/tech-presets")];
  const endpoints = [cacheBusted("templates/tech-presets.json"), cacheBusted(GITHUB_RAW_PRESETS_URL)];
  return endpoints;
}

function setStatus(message) {
  statusLine.textContent = message || "";
}

async function loadPresets() {
  setStatus("Загружаю справочник...");
  let bestPresets = [];
  let bestScore = 0;
  for (const endpoint of presetEndpoints()) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) continue;
      const loaded = normalizePresets(await response.json());
      const score = presetSourceScore(loaded);
      if (score >= bestScore) {
        bestPresets = loaded;
        bestScore = score;
      }
    } catch {
      // Try the next source.
    }
  }

  presets = bestPresets;
  render();
  setStatus(presets.length ? `Загружено шаблонов: ${presets.length}` : "Не удалось загрузить справочник.");
}

function uniqueValues(field) {
  return [...new Set(presets.map((preset) => preset[field]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
}

function subgroupValues(group = "") {
  return [
    ...new Set(
      presets
        .filter((preset) => !group || preset.group === group)
        .map((preset) => preset.subgroup)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, "ru"));
}

function presetSourceScore(source) {
  const groups = new Set(source.map((preset) => preset.group).filter(Boolean)).size;
  const subgroups = new Set(source.map((preset) => preset.subgroup).filter(Boolean)).size;
  return groups * 1000 + subgroups * 100 + source.length;
}

function choiceOptions(values, selected, placeholder, customLabel) {
  const options = [`<option value=""${selected ? "" : " selected"}>${escapeHtml(placeholder)}</option>`];
  values.forEach((value) => {
    options.push(`<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`);
  });
  options.push(`<option value="${CUSTOM_CHOICE}"${selected === CUSTOM_CHOICE ? " selected" : ""}>${escapeHtml(customLabel)}</option>`);
  return options.join("");
}

function renderChoice({ selectClass, customClass, values, selected, placeholder, customLabel, customPlaceholder }) {
  const useCustom = selected && !values.includes(selected);
  const selectValue = useCustom ? CUSTOM_CHOICE : selected;
  return `
    <div class="library-choice-stack">
      <select class="${selectClass} library-choice-select" data-custom-class="${customClass}">
        ${choiceOptions(values, selectValue, placeholder, customLabel)}
      </select>
      <input class="${customClass} library-choice-custom${useCustom ? "" : " hidden"}" value="${useCustom ? escapeHtml(selected) : ""}" placeholder="${escapeHtml(customPlaceholder)}" />
    </div>
  `;
}

function readChoice(row, selectSelector, customSelector) {
  const select = row.querySelector(selectSelector);
  if (select.value === CUSTOM_CHOICE) return row.querySelector(customSelector).value.trim();
  return select.value.trim();
}

function toggleCustomChoice(select) {
  const input = select.closest(".library-choice-stack")?.querySelector(`.${select.dataset.customClass}`);
  if (!input) return;
  input.classList.toggle("hidden", select.value !== CUSTOM_CHOICE);
  if (select.value === CUSTOM_CHOICE) input.focus();
}

function renderGroupFilter() {
  const selected = groupFilter.value;
  const groups = uniqueValues("group");
  groupFilter.innerHTML = `<option value="">Все группы</option>${groups
    .map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)
    .join("")}`;
  if (groups.includes(selected)) groupFilter.value = selected;
}

function renderSubgroupFilter() {
  const selected = subgroupFilter.value;
  const subgroups = subgroupValues(groupFilter.value);
  subgroupFilter.innerHTML = `<option value="">Все подгруппы</option>${subgroups
    .map((subgroup) => `<option value="${escapeHtml(subgroup)}">${escapeHtml(subgroup)}</option>`)
    .join("")}`;
  if (subgroups.includes(selected)) subgroupFilter.value = selected;
}

function renderRows() {
  const selectedGroup = groupFilter.value;
  const selectedSubgroup = subgroupFilter.value;
  const groups = uniqueValues("group");
  const subgroups = uniqueValues("subgroup");
  const visiblePresets = presets
    .map((preset, index) => ({ preset, index }))
    .filter(
      ({ preset }) =>
        (!selectedGroup || preset.group === selectedGroup) &&
        (!selectedSubgroup || preset.subgroup === selectedSubgroup),
    );

  presetList.innerHTML = visiblePresets
    .map(
      ({ preset, index }) => `
        <div class="library-row" data-index="${index}">
          <div class="library-group-grid">
            <label>
              <span>Группа</span>
              ${renderChoice({
                selectClass: "library-group",
                customClass: "library-group-custom",
                values: groups,
                selected: preset.group,
                placeholder: "Выберите группу",
                customLabel: "+ Новая группа",
                customPlaceholder: "Новая группа",
              })}
            </label>
            <label>
              <span>Подгруппа</span>
              ${renderChoice({
                selectClass: "library-subgroup",
                customClass: "library-subgroup-custom",
                values: subgroups,
                selected: preset.subgroup,
                placeholder: "Выберите подгруппу",
                customLabel: "+ Новая подгруппа",
                customPlaceholder: "Новая подгруппа",
              })}
            </label>
            ${isAdmin ? `<button class="icon-button" data-remove-preset="${index}" type="button" title="Удалить шаблон">×</button>` : ""}
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
  if (!isAdmin) {
    presetList.querySelectorAll("input, select, textarea").forEach((control) => {
      control.disabled = true;
    });
  }
}

function render() {
  renderGroupFilter();
  renderSubgroupFilter();
  renderRows();
}

function syncVisibleRows() {
  presetList.querySelectorAll(".library-row").forEach((row) => {
    const index = Number(row.dataset.index);
    presets[index] = {
      group: readChoice(row, ".library-group", ".library-group-custom"),
      subgroup: readChoice(row, ".library-subgroup", ".library-subgroup-custom"),
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

async function saveLibrary() {
  if (!isAdmin) return;
  const nextPresets = readEditorPresets();
  if (!nextPresets) return;

  try {
    setStatus("Сохраняю справочник...");
    const response = await fetch("/api/tech-presets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextPresets),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Не удалось сохранить справочник.");
    presets = normalizePresets(result);
    render();
    setStatus("Справочник сохранён для всех пользователей.");
  } catch (error) {
    setStatus(error.message || "Не удалось сохранить справочник.");
  }
}

function addPreset() {
  if (!isAdmin) return;
  syncVisibleRows();
  presets.push({
    group: groupFilter.value,
    subgroup: subgroupFilter.value,
    title: "",
    description: "",
  });
  render();
  presetList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
}

reloadButton.addEventListener("click", loadPresets);
saveButton.addEventListener("click", saveLibrary);
addButton.addEventListener("click", addPreset);
groupFilter.addEventListener("change", () => {
  syncVisibleRows();
  renderSubgroupFilter();
  renderRows();
});
subgroupFilter.addEventListener("change", () => {
  syncVisibleRows();
  renderRows();
});
presetList.addEventListener("click", (event) => {
  if (!isAdmin) return;
  const removeButton = event.target.closest("[data-remove-preset]");
  if (!removeButton) return;
  presets.splice(Number(removeButton.dataset.removePreset), 1);
  render();
});
presetList.addEventListener("input", () => {
  if (!isAdmin) return;
  setStatus("Есть несохраненные изменения.");
});

presetList.addEventListener("change", (event) => {
  if (!isAdmin) return;
  if (event.target.matches(".library-choice-select")) toggleCustomChoice(event.target);
  setStatus("Есть несохраненные изменения.");
});

async function initLibrary() {
  await window.ManagerAuth.ready;
  isAdmin = window.ManagerAuth.isAdmin;
  await loadPresets();
}

initLibrary();
