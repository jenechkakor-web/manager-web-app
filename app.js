const SELLERS = {
  ip: {
    title: "ИП Купорова",
    fullName: "Индивидуальный предприниматель Купорова Евгения Александровна",
    vatRate: 0.05,
    vatLabel: "НДС 5%",
    inn: "500805209810",
    ogrn: "320508100357479",
    ogrnLabel: "ОГРНИП",
    legalAddress: "143930 МО, г. Балашиха, Мирской пр-д, 9",
    phone: "8 (909) 655-98-48",
    email: "kuporov.biz@yandex.ru",
    checkingAccount: "40802810320000702819",
    bankName: 'ООО "Банк Точка"',
    bankInn: "9721194461",
    correspondentAccount: "30101810745374525104",
    bankBik: "044525104",
    bankAddress:
      "109044, Российская Федерация, г. Москва, вн.тер.г. муниципальный округ Южнопортовый, пер. 3-й Крутицкий, д.11, помещ. 7Н",
  },
  ooo: {
    title: "ООО Веркуп",
    fullName: 'ООО "ВЕРКУП"',
    vatRate: 0.22,
    vatLabel: "НДС 22%",
    legalAddress:
      "107065, РОССИЯ, г МОСКВА, ул КУРГАНСКАЯ, ДОМ 3А, корпус строение 1, оф ПОМЕЩ. 1/1",
    inn: "9718284789",
    kpp: "771801001",
    ogrn: "1257700358475",
    ogrnLabel: "ОГРН",
    checkingAccount: "40702810920000232070",
    bankName: 'ООО "Банк Точка"',
    bankInn: "9721194461",
    correspondentAccount: "30101810745374525104",
    bankBik: "044525104",
    bankAddress:
      "109044, Российская Федерация, г. Москва, вн.тер.г. муниципальный округ Южнопортовый, пер. 3-й Крутицкий, д.11, помещ. 7Н",
  },
};

const DEFAULT_TECH_PRESETS = [
  {
    group: "Вывески",
    subgroup: "Световые",
    title: "Световая вывеска с объемными буквами",
    description:
      "Световая вывеска с объемными буквами, лицевой поверхностью из акрила, бортами из ПВХ/алюминия, внутренней LED-подсветкой и креплением на подготовленное основание.",
  },
  {
    group: "Вывески",
    subgroup: "Несветовые",
    title: "Несветовая вывеска на композитной основе",
    description:
      "Несветовая вывеска на композитной основе с нанесением пленки/печати, подготовкой крепежных элементов и монтажом на согласованной поверхности.",
  },
  {
    group: "Таблички",
    subgroup: "Навигация",
    title: "Интерьерная навигационная табличка",
    description:
      "Интерьерная навигационная табличка с печатью/аппликацией, защитным покрытием и креплением согласно согласованному макету.",
  },
];

const form = document.querySelector("#contractForm");
const itemsBody = document.querySelector("#itemsBody");
const legalFields = document.querySelector("#legalFields");
const personFields = document.querySelector("#personFields");
const totalWithoutVat = document.querySelector("#totalWithoutVat");
const vatAmount = document.querySelector("#vatAmount");
const totalAmount = document.querySelector("#totalAmount");
const sellerDetails = document.querySelector("#sellerDetails");
const finalPaymentTimingLabel = document.querySelector("#finalPaymentTimingLabel");
const techDescriptions = document.querySelector("#techDescriptions");

let itemId = 0;
let techId = 0;
let activeTechCard = null;
let techPresets = [...DEFAULT_TECH_PRESETS];

const GITHUB_OWNER = "jenechkakor-web";
const GITHUB_REPO = "manager-web-app";
const GITHUB_BRANCH = "main";
const GITHUB_PRESETS_PATH = "templates/tech-presets.json";
const GITHUB_RAW_PRESETS_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${GITHUB_PRESETS_PATH}`;

const WORD_PAGE_WIDTH = 12240;
const WORD_PAGE_HEIGHT = 15840;
const WORD_PAGE_MARGIN_X = 1134;
const WORD_PAGE_MARGIN_Y = 1134;
const EMU_PER_DXA = 635;
const IMAGE_MAX_WIDTH_EMU = (WORD_PAGE_WIDTH - WORD_PAGE_MARGIN_X * 2) * EMU_PER_DXA;
const IMAGE_MAX_HEIGHT_EMU = Math.round((WORD_PAGE_HEIGHT - WORD_PAGE_MARGIN_Y * 2) * 0.3 * EMU_PER_DXA);
const WORD_FONT = "Calibri";
const WORD_FONT_SIZE = 18;
const WORD_SINGLE_LINE = 240;
const EMU_PER_INCH = 914400;
const SELLER_SIGNATURE_SEAL_ASSETS = {
  ip: {
    signature: "assets/ip-signature.png",
    stamp: "assets/ip-stamp.png",
  },
};

function money(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function plainMoney(value) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateValue) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00`);
  return new Intl.DateTimeFormat("ru-RU").format(date);
}

function getField(name) {
  return form.elements[name];
}

function setField(name, value) {
  const field = getField(name);
  if (field) field.value = value || "";
}

function setRadioValue(name, value) {
  [...form.querySelectorAll(`input[name="${name}"]`)].forEach((input) => {
    input.checked = input.value === value;
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeTechPresets(source) {
  const entries = Array.isArray(source)
    ? source
    : Object.entries(source || {}).map(([title, description]) => ({ title, description }));

  return entries
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

function techPresetEndpoints() {
  const endpoints = [cacheBusted("templates/tech-presets.json"), cacheBusted(GITHUB_RAW_PRESETS_URL)];
  if (isLocalAppServer()) endpoints.unshift(cacheBusted("/api/tech-presets"));
  return endpoints;
}

function techPresetByTitle(title) {
  return techPresets.find((preset) => preset.title === title);
}

function techPresetText(title) {
  return techPresetByTitle(title)?.description || "";
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function techGroups() {
  return uniqueSorted(techPresets.map((preset) => preset.group || "Общее"));
}

function techSubgroups(group) {
  return uniqueSorted(
    techPresets
      .filter((preset) => !group || preset.group === group)
      .map((preset) => preset.subgroup || "Без подгруппы"),
  );
}

function techPresetTitles(group, subgroup) {
  return techPresets.filter(
    (preset) => (!group || preset.group === group) && (!subgroup || preset.subgroup === subgroup),
  );
}

function techPresetSourceScore(presets) {
  const groups = new Set(presets.map((preset) => preset.group).filter(Boolean)).size;
  const subgroups = new Set(presets.map((preset) => preset.subgroup).filter(Boolean)).size;
  return groups * 1000 + subgroups * 100 + presets.length;
}

function selectOptions(values, selected, placeholder) {
  const options = values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");
  const missingSelected =
    selected && !values.includes(selected) ? `<option value="${escapeHtml(selected)}">${escapeHtml(selected)}</option>` : "";
  return `<option value="">${escapeHtml(placeholder)}</option>${missingSelected}${options}`;
}

function techGroupOptions(selected = "") {
  return selectOptions(techGroups(), selected, "Группа");
}

function techSubgroupOptions(group = "", selected = "") {
  return selectOptions(techSubgroups(group), selected, "Подгруппа");
}

function techPresetOptions(group = "", subgroup = "", selected = "") {
  const values = group ? techPresetTitles(group, subgroup).map((preset) => preset.title) : [];
  return selectOptions(values, selected, "Своё описание");
}

function syncTechPresetControls(card) {
  const groupSelect = card.querySelector(".tech-group");
  const subgroupSelect = card.querySelector(".tech-subgroup");
  const presetSelect = card.querySelector(".tech-preset");
  const selectedPreset = techPresetByTitle(card.dataset.preset || "");
  const group = card.dataset.group || selectedPreset?.group || "";
  const subgroup = card.dataset.subgroup || selectedPreset?.subgroup || "";
  const preset = selectedPreset?.title || "";

  groupSelect.innerHTML = techGroupOptions(group);
  groupSelect.value = group;
  subgroupSelect.innerHTML = techSubgroupOptions(group, subgroup);
  subgroupSelect.value = subgroup;
  subgroupSelect.disabled = !group;
  presetSelect.innerHTML = techPresetOptions(group, subgroup, preset);
  presetSelect.value = preset;

  card.dataset.group = group;
  card.dataset.subgroup = subgroup;
  card.dataset.preset = preset;
}

function refreshTechPresetSelects() {
  techDescriptions.querySelectorAll(".tech-card").forEach(syncTechPresetControls);
}

async function loadTechPresets() {
  let bestPresets = [];
  let bestScore = 0;
  for (const endpoint of techPresetEndpoints()) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) continue;
      const presets = normalizeTechPresets(await response.json());
      const score = techPresetSourceScore(presets);
      if (score >= bestScore) {
        bestPresets = presets;
        bestScore = score;
      }
    } catch {
      // Try the next source.
    }
  }

  techPresets = bestPresets.length ? bestPresets : [...DEFAULT_TECH_PRESETS];
  refreshTechPresetSelects();
}

function addItem(data = {}) {
  itemId += 1;
  const row = document.createElement("div");
  row.className = "item-row";
  row.dataset.itemId = String(itemId);
  row.innerHTML = `
    <span class="item-number"></span>
    <input class="item-name" placeholder="Наименование работ / товара" value="${escapeHtml(data.name)}" />
    <input class="item-qty" type="number" min="0" step="0.01" value="${data.qty ?? 1}" />
    <input class="item-price" type="number" min="0" step="0.01" value="${data.price ?? 0}" />
    <input class="item-sum" readonly value="0" />
    <button class="icon-button" type="button" title="Удалить позицию">×</button>
  `;
  itemsBody.append(row);
  row.addEventListener("input", recalculate);
  row.querySelector(".icon-button").addEventListener("click", () => {
    row.remove();
    recalculate();
  });
  recalculate();
}

function readImageFile(file, fallbackName = "Изображение") {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", async () => {
      const src = reader.result;
      const dimensions = await readImageDimensions(src);
      resolve({
        name: file.name || fallbackName,
        src,
        ...dimensions,
      });
    });
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    });
    image.addEventListener("error", () => resolve({}));
    image.src = src;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => resolve(""));
    reader.readAsDataURL(blob);
  });
}

function renderTechImagePreview(card) {
  const preview = card.querySelector(".tech-image-preview");
  preview.innerHTML = "";

  card.mockups.forEach((mockup, index) => {
    const thumb = document.createElement("div");
    thumb.className = "tech-image-thumb";

    const image = document.createElement("img");
    image.src = mockup.src;
    image.alt = mockup.name;

    const removeButton = document.createElement("button");
    removeButton.className = "icon-button";
    removeButton.type = "button";
    removeButton.title = "Удалить изображение";
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      card.mockups.splice(index, 1);
      renderTechImagePreview(card);
    });

    const caption = document.createElement("span");
    caption.textContent = mockup.name;

    thumb.append(image, removeButton, caption);
    preview.append(thumb);
  });
}

function imageExtension(mime) {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function setActiveTechCard(card) {
  if (!card) return;
  activeTechCard = card;
  techDescriptions
    .querySelectorAll(".tech-card")
    .forEach((item) => item.classList.toggle("is-active", item === card));
}

async function addImageFilesToCard(card, files, source = "file") {
  if (!files.length) return;

  setActiveTechCard(card);
  const images = await Promise.all(
    files.map((file, index) =>
      readImageFile(
        file,
        source === "clipboard"
          ? `Изображение из буфера ${index + 1}.${imageExtension(file.type || "")}`
          : undefined,
      ),
    ),
  );
  card.mockups.push(...images);
  renderTechImagePreview(card);
}

async function handleTechImages(card, event) {
  const files = [...event.target.files];
  await addImageFilesToCard(card, files);
  event.target.value = "";
}

function clipboardImageFiles(event) {
  return [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

async function handleTechPaste(card, event) {
  const files = clipboardImageFiles(event);
  if (!files.length) return;
  event.preventDefault();
  await addImageFilesToCard(card, files, "clipboard");
}

async function pasteImagesFromClipboard(card) {
  if (!navigator.clipboard?.read) {
    alert("Нажмите Ctrl+V в карточке технического описания.");
    return;
  }

  try {
    const clipboardItems = await navigator.clipboard.read();
    const files = [];

    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      files.push(
        new File([blob], `Изображение из буфера ${files.length + 1}.${imageExtension(imageType)}`, {
          type: imageType,
        }),
      );
    }

    if (!files.length) {
      alert("В буфере нет изображения.");
      return;
    }

    await addImageFilesToCard(card, files, "clipboard");
  } catch {
    alert("Не удалось вставить изображение из буфера. Нажмите Ctrl+V в карточке технического описания.");
  }
}

function addTechDescription(value = "") {
  const data = typeof value === "string" ? { description: value, mockups: [] } : value || {};
  const dataPreset = techPresetByTitle(data.preset || "");
  techId += 1;
  const card = document.createElement("div");
  card.className = "tech-card";
  card.tabIndex = 0;
  card.mockups = [...(data.mockups || data.images || [])];
  card.dataset.group = data.group || dataPreset?.group || "";
  card.dataset.subgroup = data.subgroup || dataPreset?.subgroup || "";
  card.dataset.preset = data.preset || "";
  card.innerHTML = `
    <div class="tech-card-header">
      <label>
        <span>Группа</span>
        <select class="tech-group"></select>
      </label>
      <label>
        <span>Подгруппа</span>
        <select class="tech-subgroup"></select>
      </label>
      <label>
        <span>Шаблон</span>
        <select class="tech-preset"></select>
      </label>
      <button class="icon-button tech-remove-button" type="button" title="Удалить описание">×</button>
    </div>
    <div class="tech-attachments">
      <div class="tech-attachment-actions">
        <label class="button ghost tech-upload-button">
          Приложить изображения
          <input class="tech-image-input" type="file" accept="image/*" multiple />
        </label>
        <button class="button ghost tech-paste-button" type="button">Вставить из буфера</button>
      </div>
      <div class="tech-image-preview"></div>
    </div>
    <textarea class="technical-description" rows="6" placeholder="Описание продукта, материалов, размеров, подсветки, крепления и комплектации.">${escapeHtml(data.description || "")}</textarea>
  `;
  techDescriptions.append(card);
  card.addEventListener("focusin", () => setActiveTechCard(card));
  card.addEventListener("pointerdown", (event) => {
    setActiveTechCard(card);
    if (!event.target.closest("input, textarea, select, button, label")) card.focus({ preventScroll: true });
  });
  card.addEventListener("paste", (event) => handleTechPaste(card, event));
  card.querySelector(".tech-group").addEventListener("change", (event) => {
    card.dataset.group = event.target.value;
    card.dataset.subgroup = "";
    card.dataset.preset = "";
    syncTechPresetControls(card);
  });
  card.querySelector(".tech-subgroup").addEventListener("change", (event) => {
    card.dataset.subgroup = event.target.value;
    card.dataset.preset = "";
    syncTechPresetControls(card);
  });
  card.querySelector(".tech-preset").addEventListener("change", (event) => {
    const preset = event.target.value;
    const presetData = techPresetByTitle(preset);
    card.dataset.group = presetData?.group || card.dataset.group || "";
    card.dataset.subgroup = presetData?.subgroup || card.dataset.subgroup || "";
    card.dataset.preset = preset;
    syncTechPresetControls(card);
    if (preset) card.querySelector(".technical-description").value = techPresetText(preset);
  });
  card.querySelector(".tech-image-input").addEventListener("change", (event) => handleTechImages(card, event));
  card.querySelector(".tech-paste-button").addEventListener("click", () => pasteImagesFromClipboard(card));
  card.querySelector(".tech-remove-button").addEventListener("click", () => {
    if (activeTechCard === card) activeTechCard = null;
    card.remove();
    if (!techDescriptions.children.length) addTechDescription();
  });
  renderTechImagePreview(card);
  syncTechPresetControls(card);
}

function getTechnicalBlocks() {
  return [...techDescriptions.querySelectorAll(".tech-card")]
    .map((card) => ({
      group: card.dataset.group || card.querySelector(".tech-group").value || "",
      subgroup: card.dataset.subgroup || card.querySelector(".tech-subgroup").value || "",
      preset: card.dataset.preset || card.querySelector(".tech-preset").value || "",
      description: card.querySelector(".technical-description").value.trim(),
      mockups: [...(card.mockups || [])],
    }))
    .filter((block) => block.description || block.mockups.length);
}

function getTechnicalDescriptions() {
  return getTechnicalBlocks()
    .map((block) => block.description)
    .filter(Boolean);
}

function renderTechPresetEditor() {
  techPresetEditorList.innerHTML = techPresets
    .map(
      (preset, index) => `
        <div class="library-row">
          <div class="library-row-header">
            <label>
              <span>Название шаблона</span>
              <input class="library-title" value="${escapeHtml(preset.title)}" />
            </label>
            <button class="icon-button" data-remove-preset="${index}" type="button" title="Удалить шаблон">×</button>
          </div>
          <label>
            <span>Текст описания</span>
            <textarea class="library-description" rows="5">${escapeHtml(preset.description)}</textarea>
          </label>
        </div>
      `,
    )
    .join("");
}

function readTechPresetEditor() {
  const rows = [...techPresetEditorList.querySelectorAll(".library-row")];
  const presets = rows.map((row) => ({
    title: row.querySelector(".library-title").value.trim(),
    description: row.querySelector(".library-description").value.trim(),
  }));

  if (presets.some((preset) => !preset.title || !preset.description)) {
    alert("Заполните название и текст каждого шаблона.");
    return null;
  }

  const titles = presets.map((preset) => preset.title.toLowerCase());
  if (new Set(titles).size !== titles.length) {
    alert("Названия шаблонов не должны повторяться.");
    return null;
  }

  return presets;
}

async function loginTechLibrary() {
  const login = techLibraryLoginInput.value.trim();
  const password = techLibraryPasswordInput.value;

  if (login === TECH_LIBRARY_ADMIN_LOGIN && password === TECH_LIBRARY_ADMIN_PASSWORD) {
    techLibraryToken = "browser-admin";
    sessionStorage.setItem("techLibraryToken", techLibraryToken);
    techLibraryPasswordInput.value = "";
    showTechLibraryEditor(true);
    return;
  }

  if (!isLocalAppServer()) {
    alert("Неверный логин или пароль.");
    return;
  }

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });

    if (!response.ok) {
      alert("Неверный логин или пароль.");
      return;
    }

    const result = await response.json();
    techLibraryToken = result.token || "";
    sessionStorage.setItem("techLibraryToken", techLibraryToken);
    techLibraryPasswordInput.value = "";
    showTechLibraryEditor(true);
  } catch {
    alert("Общее редактирование доступно при запуске через сервер приложения.");
  }
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function saveTechLibraryToGitHub(presets, token) {
  const currentResponse = await fetch(`${GITHUB_CONTENTS_API_URL}?ref=${GITHUB_BRANCH}`, {
    headers: githubHeaders(token),
    cache: "no-store",
  });

  if (!currentResponse.ok) throw new Error("GitHub read failed");
  const currentFile = await currentResponse.json();
  const content = `${JSON.stringify(presets, null, 2)}\n`;
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
    throw new Error(details.message || "GitHub save failed");
  }

  return presets;
}

async function saveTechLibrary() {
  const presets = readTechPresetEditor();
  if (!presets) return;
  const githubToken = techGitHubTokenInput.value.trim();

  try {
    if (!githubToken) {
      alert("Введите GitHub token для сохранения общего справочника.");
      return;
    }

    const savedPresets = await saveTechLibraryToGitHub(presets, githubToken);

    techGitHubToken = githubToken;
    localStorage.setItem("techGitHubToken", techGitHubToken);
    techPresets = normalizeTechPresets(savedPresets);
    refreshTechPresetSelects();
    renderTechPresetEditor();
    alert("Справочник сохранен.");
  } catch {
    alert("Не удалось сохранить справочник.");
  }
}

function getItems() {
  return [...itemsBody.querySelectorAll(".item-row")].map((row, index) => {
    const qty = Number(row.querySelector(".item-qty").value) || 0;
    const price = Number(row.querySelector(".item-price").value) || 0;
    return {
      number: index + 1,
      name: row.querySelector(".item-name").value.trim(),
      qty,
      price,
      sum: qty * price,
    };
  });
}

function getSeller() {
  return SELLERS[getField("seller").value];
}

function renderSellerDetails() {
  const seller = getSeller();
  sellerDetails.innerHTML = `
    <div><span>Наименование</span><strong>${escapeHtml(seller.fullName)}</strong></div>
    <div><span>${escapeHtml(seller.ogrnLabel)}</span><strong>${escapeHtml(seller.ogrn)}</strong></div>
    <div><span>ИНН</span><strong>${escapeHtml(seller.inn)}</strong></div>
    <div><span>КПП</span><strong>${escapeHtml(seller.kpp || "не применяется")}</strong></div>
    <div><span>Расчетный счет</span><strong>${escapeHtml(seller.checkingAccount)}</strong></div>
    <div><span>Банк</span><strong>${escapeHtml(seller.bankName)}</strong></div>
    <div><span>БИК</span><strong>${escapeHtml(seller.bankBik)}</strong></div>
    <div><span>Корр. счет</span><strong>${escapeHtml(seller.correspondentAccount)}</strong></div>
  `;
}

function recalculate() {
  const seller = getSeller();
  const items = getItems();
  const total = items.reduce((sum, item) => sum + item.sum, 0);
  const vat = (total * seller.vatRate) / (1 + seller.vatRate);

  itemsBody.querySelectorAll(".item-row").forEach((row, index) => {
    const item = items[index];
    row.querySelector(".item-number").textContent = item.number;
    row.querySelector(".item-sum").value = plainMoney(item.sum);
  });

  totalWithoutVat.textContent = money(total - vat);
  vatAmount.textContent = `${money(vat)} (${seller.vatLabel})`;
  totalAmount.textContent = money(total);
  renderSellerDetails();
}

function toggleCustomerFields() {
  const isLegal = getField("customerType").value === "legal";
  legalFields.classList.toggle("hidden", !isLegal);
  personFields.classList.toggle("hidden", isLegal);
}

function collectData() {
  const seller = getSeller();
  const items = getItems();
  const technicalBlocks = getTechnicalBlocks();
  const technicalDescriptions = technicalBlocks.map((block) => block.description).filter(Boolean);
  const total = items.reduce((sum, item) => sum + item.sum, 0);
  const vat = (total * seller.vatRate) / (1 + seller.vatRate);
  const customerType = getField("customerType").value;

  return {
    contractNumber: getField("contractNumber").value.trim(),
    contractDate: getField("contractDate").value,
    documentTemplate: getField("documentTemplate").value,
    sellerKey: getField("seller").value,
    seller,
    customerType,
    customer:
      customerType === "legal"
        ? {
            type: "Юридическое лицо",
            inn: getField("customerInn").value.trim(),
            kpp: getField("customerKpp").value.trim(),
            name: getField("customerName").value.trim(),
            address: getField("customerAddress").value.trim(),
            ogrn: getField("customerOgrn").value.trim(),
            director: getField("customerDirector").value.trim(),
          }
        : {
            type: "Физическое лицо",
            name: getField("personName").value.trim(),
            passport: getField("passport").value.trim(),
            address: getField("personAddress").value.trim(),
          },
    paymentTerms: getField("paymentTerms").value,
    finalPaymentTiming: getField("finalPaymentTiming").value,
    warranty: getField("warranty").value.trim(),
    addSignatureSeal: getField("addSignatureSeal").value === "yes",
    workDays: getField("workDays").value.trim(),
    workAddress: getField("workAddress").value.trim(),
    technicalBlocks,
    technicalDescriptions,
    technicalDescription: technicalDescriptions.join("\n"),
    requestLibraryAdd: getField("requestLibraryAdd").checked,
    items,
    totals: {
      totalWithoutVat: total - vat,
      vat,
      grandTotal: total,
    },
    mockups: technicalBlocks.flatMap((block) => block.mockups),
  };
}

function validateBeforeDownload() {
  if (!form.reportValidity()) return false;
  const data = collectData();
  if (!data.items.some((item) => item.name && item.qty > 0 && item.price > 0)) {
    alert("Добавьте хотя бы одну заполненную позицию.");
    return false;
  }
  return true;
}

function renderItemsTable(items) {
  const rows = items
    .map(
      (item) => `
      <tr>
        <td>${item.number}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${plainMoney(item.qty)}</td>
        <td>${money(item.price)}</td>
        <td>${money(item.sum)}</td>
      </tr>
    `,
    )
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>№</th>
          <th>Наименование</th>
          <th>Кол-во</th>
          <th>Цена</th>
          <th>Сумма</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderMockups(mockupList) {
  if (!mockupList.length) return "";
  return mockupList
    .map(
      (mockup) => `
      <div class="mockup">
        <p>${escapeHtml(mockup.name)}</p>
        <img src="${mockup.src}" alt="${escapeHtml(mockup.name)}" />
      </div>
    `,
    )
    .join("");
}

function renderTechnicalBlocks(data) {
  const blocks = getDocumentTechnicalBlocks(data);
  return blocks
    .map(
      (block, index) => `
        ${block.preset ? `<p><strong>${escapeHtml(block.preset)}</strong></p>` : ""}
        ${renderMockups(block.mockups)}
        <p>${escapeHtml(block.description || "Техническое описание не указано.")}</p>
      `,
    )
    .join("");
}

function documentStyles() {
  return `
    <style>
      body { font-family: Calibri, Arial, sans-serif; font-size: 9pt; line-height: 1; color: #111; }
      h1 { text-align: center; font-size: 16pt; margin: 0 0 18px; }
      h2 { font-size: 13pt; margin: 18px 0 8px; }
      p { margin: 7px 0; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; }
      th, td { border: 1px solid #111; padding: 6px; vertical-align: top; }
      th { text-align: center; }
      .right { text-align: right; }
      .muted { color: #555; }
      .mockup { page-break-inside: avoid; margin-top: 14px; }
      .mockup img { max-width: 100%; max-height: 520px; }
    </style>
  `;
}

function renderContract(data) {
  const customer = data.customer;
  return `
    <!doctype html>
    <html>
      <head><meta charset="utf-8" />${documentStyles()}</head>
      <body>
        <h1>Договор подряда № ${escapeHtml(data.contractNumber)} от ${formatDate(data.contractDate)}</h1>
        <p><strong>Исполнитель:</strong> ${escapeHtml(data.seller.fullName)} (${escapeHtml(data.seller.vatLabel)}).</p>
        <p><strong>Реквизиты Исполнителя:</strong> ИНН ${escapeHtml(data.seller.inn)}${
          data.seller.kpp ? `, КПП ${escapeHtml(data.seller.kpp)}` : ""
        }, ${escapeHtml(data.seller.ogrnLabel)} ${escapeHtml(data.seller.ogrn)}.</p>
        ${
          data.seller.legalAddress
            ? `<p><strong>Юридический адрес Исполнителя:</strong> ${escapeHtml(data.seller.legalAddress)}.</p>`
            : ""
        }
        <p><strong>Банковские реквизиты Исполнителя:</strong> р/с ${escapeHtml(data.seller.checkingAccount)}, ${escapeHtml(data.seller.bankName)}, БИК ${escapeHtml(data.seller.bankBik)}, к/с ${escapeHtml(data.seller.correspondentAccount)}.</p>
        <p><strong>Заказчик:</strong> ${escapeHtml(customer.name || "")}, ${escapeHtml(customer.type)}.</p>
        ${
          data.customerType === "legal"
            ? `<p><strong>ИНН/КПП:</strong> ${escapeHtml(customer.inn)} / ${escapeHtml(customer.kpp)}. <strong>ОГРН:</strong> ${escapeHtml(customer.ogrn)}.</p>
               <p><strong>Адрес:</strong> ${escapeHtml(customer.address)}.</p>
               <p><strong>Представитель:</strong> ${escapeHtml(customer.director)}.</p>`
            : `<p><strong>Паспорт:</strong> ${escapeHtml(customer.passport)}.</p>
               <p><strong>Адрес регистрации:</strong> ${escapeHtml(customer.address)}.</p>`
        }
        <h2>Предмет договора</h2>
        <p>Исполнитель обязуется выполнить работы и/или поставить продукцию согласно согласованным позициям, техническому описанию и макетам, а Заказчик обязуется принять и оплатить результат работ.</p>
        ${renderItemsTable(data.items)}
        <p class="right"><strong>Итого без НДС:</strong> ${money(data.totals.totalWithoutVat)}</p>
        <p class="right"><strong>В том числе ${escapeHtml(data.seller.vatLabel)}:</strong> ${money(data.totals.vat)}</p>
        <p class="right"><strong>Итого к оплате:</strong> ${money(data.totals.grandTotal)}</p>
        <h2>Порядок оплаты</h2>
        <p>${escapeHtml(data.paymentTerms)}.</p>
        <h2>Срок выполнения работ</h2>
        <p>Срок выполнения работ ${escapeHtml(data.workDays)} рабочих дней.</p>
        <h2>Адрес монтажа / доставки / проведения работ</h2>
        <p>${escapeHtml(data.workAddress)}</p>
        <h2>Гарантийные сроки</h2>
        <p>${escapeHtml(data.warranty)}</p>
        <h2>Техническое описание</h2>
        ${renderTechnicalBlocks(data)}
        ${
          data.requestLibraryAdd
            ? "<p class=\"muted\">Описание требуется добавить в библиотеку технических описаний.</p>"
            : ""
        }
      </body>
    </html>
  `;
}

function renderAnnex(data) {
  return `
    <!doctype html>
    <html>
      <head><meta charset="utf-8" />${documentStyles()}</head>
      <body>
        <h1>Приложение № 1 к Договору № ${escapeHtml(data.contractNumber)} от ${formatDate(data.contractDate)}</h1>
        <p><strong>Исполнитель:</strong> ${escapeHtml(data.seller.fullName)}, ИНН ${escapeHtml(data.seller.inn)}${
          data.seller.kpp ? `, КПП ${escapeHtml(data.seller.kpp)}` : ""
        }, р/с ${escapeHtml(data.seller.checkingAccount)}, ${escapeHtml(data.seller.bankName)}.</p>
        <h2>Спецификация</h2>
        ${renderItemsTable(data.items)}
        <p class="right"><strong>Итого к оплате с НДС:</strong> ${money(data.totals.grandTotal)}</p>
        <p class="right"><strong>В том числе ${escapeHtml(data.seller.vatLabel)}:</strong> ${money(data.totals.vat)}</p>
        <h2>Срок выполнения работ</h2>
        <p>Срок выполнения работ ${escapeHtml(data.workDays)} рабочих дней.</p>
        <h2>Адрес монтажа / доставки / проведения работ</h2>
        <p>${escapeHtml(data.workAddress)}</p>
        <h2>Техническое описание</h2>
        ${renderTechnicalBlocks(data)}
      </body>
    </html>
  `;
}

function toggleFinalPaymentTiming() {
  const percent = Number(getField("paymentTerms").value) || 0;
  finalPaymentTimingLabel.classList.toggle("hidden", percent === 100);
}

function normalizePaymentValue(value) {
  if (["100", "70", "50", "30", "0"].includes(String(value))) return String(value);
  const match = String(value || "").match(/\d+/);
  if (match) return match[0];
  return "0";
}

function downloadWordHtml(filename, html) {
  const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function paymentPhrase(value) {
  const percent = Number(value) || 0;
  if (percent > 0) return "со дня получения авансового платежа";
  return "со дня подписания настоящего Приложения";
}

function finalPaymentTimingText(value) {
  return value === "afterUpd" ? "после подписания УПД" : "перед отгрузкой конструкции с производства";
}

function rubleWords(amount) {
  const ones = [
    ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
    ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
  ];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const units = [
    ["", "", "", 0],
    ["тысяча", "тысячи", "тысяч", 1],
    ["миллион", "миллиона", "миллионов", 0],
  ];
  const plural = (number, forms) => {
    const lastTwo = number % 100;
    const last = number % 10;
    if (lastTwo >= 11 && lastTwo <= 19) return forms[2];
    if (last === 1) return forms[0];
    if (last >= 2 && last <= 4) return forms[1];
    return forms[2];
  };
  const triadWords = (number, gender) => {
    const result = [];
    const h = Math.floor(number / 100);
    const t = Math.floor((number % 100) / 10);
    const o = number % 10;
    if (h) result.push(hundreds[h]);
    if (t === 1) result.push(teens[o]);
    else {
      if (t) result.push(tens[t]);
      if (o) result.push(ones[gender][o]);
    }
    return result.join(" ");
  };
  const rounded = Math.round(Number(amount) * 100);
  const rubles = Math.floor(rounded / 100);
  const kopecks = rounded % 100;
  if (!rubles) return `Ноль рублей ${String(kopecks).padStart(2, "0")} копеек`;
  const words = [];
  let rest = rubles;
  let rank = 0;
  while (rest > 0) {
    const triad = rest % 1000;
    if (triad) {
      const unit = units[rank];
      const text = triadWords(triad, unit[3]);
      words.unshift(`${text}${unit[0] ? ` ${plural(triad, unit)}` : ""}`.trim());
    }
    rest = Math.floor(rest / 1000);
    rank += 1;
  }
  const phrase = `${words.join(" ")} ${plural(rubles, ["рубль", "рубля", "рублей"])} ${String(kopecks).padStart(2, "0")} копеек`;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function paymentAmountText(amount) {
  return `${plainMoney(amount)} руб. (${rubleWords(amount)})`;
}

function paymentAmountRuns(amount) {
  return [
    { text: `${plainMoney(amount)} руб.`, bold: true },
    { text: ` (${rubleWords(amount)})` },
  ];
}

function docMoney(amount) {
  return `${plainMoney(amount)} руб.`;
}

function invoiceMoney(amount) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(amount)) ? Number(amount) : 0);
}

function longDateText(dateValue) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00`);
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(date);
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function workDaysText(value) {
  const words = {
    1: "одного",
    2: "двух",
    3: "трех",
    4: "четырех",
    5: "пяти",
    6: "шести",
    7: "семи",
    8: "восьми",
    9: "девяти",
    10: "десяти",
    11: "одиннадцати",
    12: "двенадцати",
    13: "тринадцати",
    14: "четырнадцати",
    15: "пятнадцати",
    20: "двадцати",
    30: "тридцати",
  };
  const days = Number(value) || 0;
  return words[days] ? `${days} (${words[days]})` : String(days || value || "");
}

function sellerAddress(seller) {
  return seller.legalAddress || "";
}

function invoiceSellerIntro(seller) {
  const address = sellerAddress(seller);
  return `Исполнитель: ${sellerShortName(seller)} (ИНН: ${seller.inn} / ${seller.ogrnLabel}: ${seller.ogrn}${address ? ` / ${address}` : ""})`;
}

function invoiceContractorLines(data) {
  const seller = data.seller;
  return {
    name: `${sellerShortName(seller)} ИНН ${seller.inn} КПП ${seller.kpp || "-"}`,
    address: `Адрес: ${sellerAddress(seller)}${seller.phone ? ` Т. ${seller.phone}` : ""}`,
    email: `${seller.email ? `Email: ${seller.email} ` : ""}Р/С № ${seller.checkingAccount}`,
    bank: `В ${seller.bankName}`,
    correspondent: `К/С № ${seller.correspondentAccount}`,
    bik: `БИК: ${seller.bankBik}`,
  };
}

function invoiceCustomerLines(data) {
  if (data.customerType === "legal") {
    return {
      name: data.customer.name || "Заказчик",
      address: data.customer.address ? `Юр. Адрес: ${data.customer.address}` : "Юр. Адрес:",
      inn: `ИНН: ${data.customer.inn || ""}${data.customer.kpp ? ` КПП: ${data.customer.kpp}` : ""}`,
      ogrn: `ОГРН: ${data.customer.ogrn || ""}`,
      account: "р/с:",
      bik: "БИК:",
      correspondent: "к/с:",
    };
  }

  return {
    name: data.customer.name || "Заказчик",
    address: data.customer.address ? `Адрес регистрации: ${data.customer.address}` : "Адрес регистрации:",
    inn: data.customer.passport ? `Паспорт: ${data.customer.passport}` : "Паспорт:",
    ogrn: "",
    account: "",
    bik: "",
    correspondent: "",
  };
}

function invoicePaymentTermsText(data) {
  const percent = Number(data.paymentTerms) || 0;
  const total = data.totals.grandTotal;
  const prefix = "Оплата настоящего Счет-Договора производится следующим образом: ";

  if (percent === 100) {
    return `${prefix}Предоплата в размере ${docMoney(total)} (${rubleWords(total)}) в течение 5 (пяти) рабочих дней от даты его составления.`;
  }

  if (percent > 0) {
    const prepay = (total * percent) / 100;
    const rest = total - prepay;
    return `${prefix}Предоплата ${percent}% в размере ${docMoney(prepay)} (${rubleWords(prepay)}) в течение 5 (пяти) рабочих дней от даты его составления, оплата остатка ${100 - percent}% в размере ${docMoney(rest)} (${rubleWords(rest)}) ${finalPaymentTimingText(data.finalPaymentTiming)}.`;
  }

  return `${prefix}Оплата в размере ${docMoney(total)} (${rubleWords(total)}) ${finalPaymentTimingText(data.finalPaymentTiming)}.`;
}

function buildPaymentTermsText(data) {
  return buildPaymentTermsRuns(data).map((run) => run.text).join("");
}

function buildPaymentTermsRuns(data) {
  const percent = Number(data.paymentTerms) || 0;
  const total = data.totals.grandTotal;
  const timing = finalPaymentTimingText(data.finalPaymentTiming);
  const prefix = "1.1.2. Оплата настоящего Договора производится на следующих условиях: ";
  const suffix = " Оплата настоящего Договора означает согласие Заказчика с условиями оплаты и выполнения работ и/или услуг.";
  if (percent === 100) {
    return [
      { text: `${prefix}Предоплата 100% от общей суммы в размере ` },
      ...paymentAmountRuns(total),
      { text: ` в течение 5 (пяти) рабочих дней от даты его составления.${suffix}` },
    ];
  }
  if (percent > 0) {
    const prepay = (total * percent) / 100;
    const rest = total - prepay;
    return [
      { text: `${prefix}Предоплата ${percent}% от общей суммы в размере ` },
      ...paymentAmountRuns(prepay),
      { text: ` в течение 5 (пяти) рабочих дней от даты его составления, и оплата остатка от общей суммы ${100 - percent}% в размере ` },
      ...paymentAmountRuns(rest),
      { text: `, ${timing}.${suffix}` },
    ];
  }
  return [
    { text: `${prefix}Оплата 100% от общей суммы в размере ` },
    ...paymentAmountRuns(total),
    { text: `, ${timing}.${suffix}` },
  ];
}

function customerShortName(data) {
  return data.customerType === "legal"
    ? data.customer.name || "Заказчик"
    : data.customer.name || "Заказчик";
}

function sellerShortName(seller) {
  return seller.title === "ИП Купорова" ? "ИП Купорова Е.А." : 'ООО "ВЕРКУП"';
}

function signatureName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length >= 3) return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
  return name || "Заказчик";
}

function customerSignatureName(data) {
  return data.customerType === "legal" ? customerShortName(data) : signatureName(customerShortName(data));
}

function partyIntro(data) {
  const seller = data.seller;
  const contractor = `${seller.fullName}, ИНН: ${seller.inn} / ${seller.ogrnLabel} № ${seller.ogrn}, именуемое в дальнейшем «Подрядчик»`;
  if (data.customerType === "legal") {
    const customer = `${data.customer.name}, ИНН: ${data.customer.inn}${
      data.customer.kpp ? ` / КПП: ${data.customer.kpp}` : ""
    }${data.customer.ogrn ? ` / ОГРН № ${data.customer.ogrn}` : ""}, именуемое в дальнейшем «Заказчик»`;
    return `${customer}, с одной стороны и ${contractor}, с другой стороны, совместно именуемые «Стороны», заключили настоящий Договор о нижеследующем:`;
  }
  const customer = `${data.customer.name}, паспорт: ${data.customer.passport}, адрес регистрации: ${data.customer.address}, именуемый(ая) в дальнейшем «Заказчик»`;
  return `${customer}, с одной стороны и ${contractor}, с другой стороны, совместно именуемые «Стороны», заключили настоящий Договор о нижеследующем:`;
}

function contractorDetails(data) {
  const seller = data.seller;
  return [
    seller.fullName,
    `ИНН ${seller.inn}`,
    seller.kpp ? `КПП ${seller.kpp}` : "",
    `${seller.ogrnLabel} ${seller.ogrn}`,
    seller.legalAddress ? `Адрес: ${seller.legalAddress}` : "",
    `Р/С № ${seller.checkingAccount}`,
    seller.bankName,
    `К/С № ${seller.correspondentAccount}`,
    `БИК: ${seller.bankBik}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function customerDetails(data) {
  if (data.customerType === "legal") {
    return [
      data.customer.name,
      `ИНН ${data.customer.inn}`,
      data.customer.kpp ? `КПП ${data.customer.kpp}` : "",
      data.customer.ogrn ? `ОГРН ${data.customer.ogrn}` : "",
      data.customer.address ? `Адрес: ${data.customer.address}` : "",
      data.customer.director ? `Представитель: ${data.customer.director}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    data.customer.name,
    data.customer.passport ? `Паспорт: ${data.customer.passport}` : "",
    data.customer.address ? `Адрес регистрации: ${data.customer.address}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function wText(text, options = {}) {
  const safe = escapeXml(text);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  const rPr = options.rPr || "<w:rPr/>";
  const runProperties = options.bold ? ensureBoldRunProperties(rPr) : rPr;
  return `<w:r>${runProperties}<w:t${preserve}>${safe}</w:t></w:r>`;
}

function stripHighlight(xml) {
  return xml.replace(/<w:highlight\b[^/]*\/>/g, "");
}

function ensureBoldRunProperties(rPr = "<w:rPr/>") {
  const source = rPr || "<w:rPr/>";
  if (/<w:b\b/.test(source)) return source;
  if (source.includes("</w:rPr>")) return source.replace("</w:rPr>", "<w:b/></w:rPr>");
  return "<w:rPr><w:b/></w:rPr>";
}

function runPropertiesFromTemplate(original, options = {}) {
  const rPr = stripHighlight(original.match(/<w:rPr[\s\S]*?<\/w:rPr>/)?.[0] || "<w:rPr/>");
  return options.bold ? ensureBoldRunProperties(rPr) : rPr;
}

function wParagraph(text = "", options = {}) {
  const bold = options.bold ? "<w:b/>" : "";
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : "";
  const pPr = `<w:pPr>${align}</w:pPr>`;
  const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "<w:rPr/>";
  const runs = String(text)
    .split("\n")
    .map((line, index) => `${index ? "<w:br/>" : ""}${wText(line, { rPr })}`)
    .join("");
  return `<w:p>${pPr}${runs}</w:p>`;
}

function wParagraphRuns(runs, options = {}) {
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : "";
  const pPr = `<w:pPr>${align}</w:pPr>`;
  const body = runs.map((run) => wText(run.text, { bold: run.bold })).join("");
  return `<w:p>${pPr}${body}</w:p>`;
}

function wPageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function normalizeCell(cell) {
  if (cell && typeof cell === "object" && !Array.isArray(cell)) return cell;
  return { text: cell };
}

function wCell(content, width, options = {}) {
  const cell = normalizeCell(content);
  const paragraphs = Array.isArray(cell.text) ? cell.text : String(cell.text || "").split("\n");
  const align = cell.align ?? options.align;
  const bold = cell.bold ?? options.bold;
  const inner = paragraphs.map((line) => wParagraph(line, { after: 0, bold, align })).join("");
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr>${inner}</w:tc>`;
}

function wTable(rows, widths) {
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const body = rows
    .map((row, rowIndex) => `<w:tr>${row.map((cell, index) => wCell(cell, widths[index], { bold: rowIndex === 0, align: index === 0 || index > 1 ? "center" : undefined })).join("")}</w:tr>`)
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

function wImage(relId, name, index) {
  const image = typeof relId === "object" ? relId : { relId, name, documentIndex: index };
  const size = imageSizeEmu(image);
  const cx = size.cx;
  const cy = size.cy;
  const docIndex = image.documentIndex ?? index ?? 0;
  const imageName = image.name || name || "image";
  const imageRelId = image.relId;
  return `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docIndex + 1}" name="${escapeXml(imageName)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docIndex + 1}" name="${escapeXml(imageName)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${imageRelId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function imageSizeEmu(image) {
  const width = Number(image.width);
  const height = Number(image.height);
  if (width > 0 && height > 0) {
    const ratio = width / height;
    let cy = IMAGE_MAX_HEIGHT_EMU;
    let cx = Math.round(cy * ratio);
    if (cx > IMAGE_MAX_WIDTH_EMU) {
      cx = IMAGE_MAX_WIDTH_EMU;
      cy = Math.round(cx / ratio);
    }
    return { cx, cy };
  }
  return { cx: IMAGE_MAX_WIDTH_EMU, cy: IMAGE_MAX_HEIGHT_EMU };
}

function buildCombinedDocumentXml(data, imageRels) {
  const contractDate = formatDate(data.contractDate);
  const customerSign = signatureName(customerShortName(data));
  const itemRows = [
    ["№", "Наименование", "Кол-во, шт.", "Цена, руб.", "Сумма, руб."],
    ...data.items.map((item) => [String(item.number), item.name, plainMoney(item.qty), plainMoney(item.price), plainMoney(item.sum)]),
    ["ИТОГО:", "", "", "", `${money(data.totals.grandTotal)} в т.ч. ${data.seller.vatLabel}`],
  ];
  const body = [
    wParagraph(`ДОГОВОР ПОДРЯДА №${data.contractNumber}`, { align: "center", bold: true, size: 28, after: 160 }),
    wParagraph(`г. Москва    «${contractDate.split(".")[0]}» ${new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(new Date(`${data.contractDate}T00:00:00`))} ${new Date(`${data.contractDate}T00:00:00`).getFullYear()} года`, { after: 200 }),
    wParagraph(partyIntro(data)),
    wParagraph("1. Предмет Договора", { bold: true, before: 180 }),
    wParagraph("1.1. Заказчик поручает, а Подрядчик принимает на себя обязательства по изготовлению, монтажу и подключению рекламно-информационных изделий, конструкций, согласно Техническому заданию и цене, согласованными Сторонами в Приложениях к Договору, являющимися неотъемлемой его частью."),
    wParagraph("Работы выполняются с помощью оборудования и материалов «Подрядчика»."),
    wParagraph("Подрядчик выполняет работы собственными или привлеченными силами, оставаясь при этом ответственным за действия привлеченных третьих лиц перед Заказчиком."),
    wParagraph("2. Права и обязанности Сторон", { bold: true, before: 180 }),
    ...[
      "2.1. Заказчик обязуется:",
      "2.1.1. Обеспечить беспрепятственный проход работников Подрядчика к объекту (при необходимости, в выходные и праздничные дни).",
      "2.1.2. Предоставить место для разгрузки и складирования материалов.",
      "2.1.3. Предоставить место для хранения техники и механизмов Подрядчика круглосуточно, на протяжении всего срока производства работ.",
      "2.1.4. Обеспечить готовность места установки рекламно-информационных изделий к моменту начала на нем работ, выполняемых Подрядчиком по данному Договору.",
      "2.1.5. Утверждать спецификации по изготовлению и монтажу конструкций, указанных Приложениях к настоящему договору. Предоставить рекламные (информационные) материалы, которые касаются фирменного стиля Заказчика.",
      "2.1.6. Своевременно полностью производить платежи Подрядчику, в объеме, сроки и на условиях, предусмотренных настоящим Договором.",
      "2.1.7. Принять результаты полностью и качественно выполненных работ Подрядчиком на объекте.",
      "2.1.8. В случае досрочного выполнения Подрядчиком Работ по настоящему Договору, при отсутствии претензий к качеству выполнения Работ, принять результаты Работ по настоящему Договору досрочно.",
      "2.1.9. Сообщить в письменной форме Подрядчику о недостатках, обнаруженных в ходе выполнения работ, в течение 3 (трех) рабочих дней после обнаружения таких недостатков.",
      "2.1.10. Назначить своего представителя - специалиста, имеющего полномочия осуществлять контроль (технический надзор) за действиями Подрядчика на Объекте, в случае необходимости останавливать проведение Работ, осуществлять проверку качества и имеет право осуществлять контроль и надзор за ходом и качеством выполняемых Работ, соблюдением сроков их выполнения, качеством предоставленных Исполнителем материалов, без вмешательства в хозяйственную деятельность Подрядчика.",
      "2.2. Подрядчик обязуется:",
      "2.2.1. Своими силами и средствами, инструментом, оборудованием и механизмами, из собственных либо приобретенных за свой счет материалов и комплектующих, выполнить все работы в объеме и в сроки, предусмотренные настоящим Договором и приложением к нему, а также сдать выполненные работы Заказчику в установленный срок в состоянии, обеспечивающем нормальную эксплуатацию.",
      "2.2.2. Выполнить работы качественно и в сроки, согласованные Сторонами. Подрядчик несет ответственность перед Заказчиком за качество выполняемых работ и за сроки их выполнения.",
      "2.2.3. Обеспечить производство и качество всех Работ в соответствии с действующими нормами и техническими условиями, включая требования, предъявляемые Государственными органами и иными уполномоченными организациями к порядку производства работ, соблюдения техники безопасности при проведении работ, а также пожарной безопасности, санитарных норм и правил, охране окружающей среды и т.п.",
      "2.2.4. Вывезти в течение 5 (пяти) календарных дней со дня подписания акта сдачи-приемки работ за пределы объекта, принадлежащие Подрядчику строительные машины, оборудование, инвентарь, инструменты, строительные материалы, а также строительный мусор.",
      "2.2.5. Обеспечить порядок на объекте и не допускать на объект третьих лиц без письменного согласия Заказчика, обеспечивать на объекте выполнение необходимых мероприятий по технике безопасности, охране труда, охране окружающей среды.",
      "2.2.6. Подрядчик несет риск случайной гибели или случайного повреждения результата выполненной работы до его окончательной приемки Заказчиком.",
      "2.2.7. Немедленно известить Заказчика и до получения от него указаний приостановить работы при обнаружении возможных неблагоприятных последствий выполнения указаний Заказчика, либо иных обстоятельств, угрожающих годности или прочности результатов выполняемой работы, либо создающих невозможность ее завершения в срок.",
      "2.2.8. По завершении монтажных работ Подрядчик обязан предоставить Заказчику макет с техническим описанием конструкции.",
      "2.2.9. Подрядчик подтверждает, что его персонал и персонал привлекаемых подрядных организаций профессионально обучен, аттестован и имеет квалификацию, соответствующую выполняемым объемам работ.",
      "2.3. Заказчик вправе требовать от Подрядчика надлежащего исполнения обязательств, своевременного устранения выявленных недостатков, представления отчетной документации, осуществлять контроль за ходом и качеством работ, а также принимать досрочно выполненные работы.",
      "2.4. Подрядчик вправе требовать своевременного подписания актов, оплаты выполненных работ, запрашивать уточнения, досрочно исполнить обязательства и привлекать субподрядчиков, оставаясь ответственным за результат.",
    ].map((text) => wParagraph(text)),
    wParagraph("3. Стоимость и порядок расчетов", { bold: true, before: 180 }),
    wParagraph("3.1. Стоимость работ, выполняемых Исполнителем, определяется в Приложениях к настоящему Договору."),
    wParagraph("3.2. Стоимость работ является твердой при условии неизменности объема и технических характеристик работ, предусмотренных Приложениями к настоящему Договору. В случае изменения объема, проектных решений, технического задания или выявления скрытых работ стоимость подлежит дополнительному согласованию Сторонами."),
    wParagraph(`3.3. Оплата работы производится Заказчиком в следующем порядке: ${data.paymentTerms}.`),
    wParagraph("3.4. Оплата по Договору осуществляется в рублях Российской Федерации, путем перечисления заказчиком денежных средств на расчетный счет Подрядчика."),
    wParagraph("4. Срок проведения и порядок сдачи работ", { bold: true, before: 180 }),
    wParagraph(`4.1. Срок выполнения работ составляет ${data.workDays} рабочих дней. Подрядчик вправе досрочно выполнить работы по согласованию с Заказчиком.`, { bold: true }),
    wParagraph("4.2. Сдача-приемка выполненных работ по настоящему Договору производится по акту сдачи-приемки работ. Заказчик рассматривает предоставленные документы, подписывает их либо направляет мотивированный отказ."),
    wParagraph("В случае непредоставления доступа к объекту, неподготовленности площадки, отсутствия электропитания либо задержки согласований срок выполнения работ автоматически продлевается на соответствующий период без применения штрафных санкций к Подрядчику."),
    wParagraph("5. Гарантийные обязательства", { bold: true, before: 180 }),
    wParagraph(`5.1. Подрядчик предоставляет гарантию на выполненные работы сроком ${data.warranty} со дня подписания Заказчиком Акта приемки-передачи выполненных работ.`, { bold: true }),
    wParagraph("5.2. Подрядчик несет ответственность за недостатки, обнаруженные в пределах гарантийного срока, если эти недостатки не явились следствием нормального износа, неправильной эксплуатации, повреждений со стороны третьих лиц либо по иным причинам, независящим от Исполнителя."),
    wParagraph("5.3. Демонтаж и повторный монтаж осуществляется за счет Подрядчика только в случае подтвержденного производственного дефекта. В иных случаях расходы несет Заказчик."),
    wParagraph("5.4. При наступлении гарантийного случая Подрядчик производит диагностику конструкций и комплектующих в течение 3 рабочих дней со дня получения запроса на гарантийное обслуживание от Заказчика."),
    wParagraph("6. Ответственность сторон.", { bold: true, before: 180 }),
    ...[
      "6.1. Подрядчик несет ответственность за соблюдение правил техники безопасности, несчастные случаи, происшествия с персоналом, за аварии, возгорания, нарушения природоохранного законодательства на выделенном участке работы.",
      "6.2. Подрядчик несет ответственность за действия своих сотрудников или привлекаемых лиц.",
      "6.3. Заказчик не несет ответственности за травмы, увечья или смерть работников Подрядчика или третьих лиц, привлеченных Подрядчиком, не по вине Заказчика.",
      "6.4. В случаях, когда работы выполнены Подрядчиком с отступлением от настоящего Договора или с недостатками, Заказчик вправе потребовать соразмерного уменьшения цены либо устранения выявленных недостатков.",
      "6.5. За неисполнение или ненадлежащее исполнение обязательств Стороны несут ответственность в соответствии с действующим законодательством Российской Федерации.",
      "6.6. В случае нарушения сроков выполнения работ по вине Подрядчика Заказчик вправе требовать уплаты неустойки в размере 0,1% от стоимости просроченного этапа работ за каждый день просрочки, но не более 10% от общей стоимости Договора.",
      "6.7. В случае просрочки оплаты Подрядчик вправе требовать от Заказчика выплаты неустойки в размере 0,1% от неоплаченной суммы за каждый день просрочки платежа, но не более 10% от общей стоимости Договора.",
      "6.8. Уплата неустойки не освобождает стороны от исполнения обязательств или устранения нарушений.",
      "6.9. Общая ответственность Подрядчика по настоящему Договору ограничивается суммой фактически полученного по Договору вознаграждения.",
    ].map((text) => wParagraph(text)),
    wParagraph("7. Изменение и расторжение Договора", { bold: true, before: 180 }),
    ...[
      "7.1. Стороны могут в любое время по обоюдному согласию изменить условия настоящего Договора. Изменения и дополнения вступают в силу только, если они оформлены в письменном виде и подписаны уполномоченными представителями Сторон.",
      "7.2. Заказчик вправе в одностороннем порядке расторгнуть Договор в случаях задержки начала работ, систематического нарушения сроков или иных существенных нарушений условий Договора.",
      "7.3. В случае расторжения Договора Подрядчиком, Подрядчик возвращает Заказчику уплаченные предоплатой денежные средства, за исключением оплаты за уже выполненные работы.",
      "7.4. В случае одностороннего отказа Заказчика от Договора по основаниям, не связанным с виновными действиями Подрядчика, Заказчик обязан оплатить фактически выполненные работы, понесенные расходы и упущенную выгоду Подрядчика в размере не менее 10% от стоимости невыполненной части работ.",
      "7.5. При расторжении Договора незавершенные работы передаются Заказчику, который оплачивает Подрядчику стоимость выполненных работ в согласованном объеме.",
    ].map((text) => wParagraph(text)),
    wParagraph("8. Обстоятельства непреодолимой силы", { bold: true, before: 180 }),
    wParagraph("8.1. Стороны освобождаются от ответственности за частичное или полное неисполнение обязательств по Договору, если оно явилось следствием обстоятельств непреодолимой силы: пожара, наводнения, землетрясения, военных действий, забастовок и иных обстоятельств, непосредственно повлиявших на исполнение настоящего Договора."),
    wParagraph("8.2. К обстоятельствам непреодолимой силы также относится невозможность исполнения обязательств вследствие экономических ограничений, задержки поставки материалов поставщиками, санкционных ограничений, колебаний валютных курсов и ограничений государственных органов, не зависящих от Подрядчика."),
    wParagraph("9. Особые условия", { bold: true, before: 180 }),
    wParagraph("9.1. Настоящий договор вступает в силу с момента подписания и действует до выполнения Сторонами всех принятых на себя обязательств в полном объеме."),
    wParagraph("9.2. Все изменения и дополнения к настоящему Договору имеют силу только в том случае, если они оформлены в письменном виде и подписаны обеими сторонами."),
    wParagraph("9.3. Настоящий Договор заключен в 2-х экземплярах, по одному для каждой из Сторон, имеющих одинаковую юридическую силу."),
    wParagraph("9.4. Во всем, что не предусмотрено настоящим Договором, Стороны руководствуются действующим законодательством Российской Федерации."),
    wParagraph("10. Юридические адреса и реквизиты Сторон", { bold: true, before: 180 }),
    wTable(
      [
        ["Подрядчик:", "Заказчик:"],
        [contractorDetails(data), customerDetails(data)],
        [`_____________/ ${sellerShortName(data.seller)}/\nм.п.`, `_____________/ ${customerSign}/\nм.п.`],
      ],
      [4680, 4680],
    ),
    wParagraph("ПРИЛОЖЕНИЕ № 1", { align: "center", bold: true, size: 28, pageBreakBefore: true }),
    wParagraph(`к Договору подряда № ${data.contractNumber} от ${contractDate} года`, { align: "center" }),
    wParagraph("1. Предмет приложения", { bold: true, before: 180 }),
    wParagraph("Исполнитель обязуется выполнить следующие работы:"),
    wParagraph("1.1. Изготовить и смонтировать информационные конструкции согласно спецификации и визуализации:"),
    wParagraph("1.1.1. Спецификация на изготовление и монтаж рекламной конструкции:", { bold: true }),
    wTable(itemRows, [650, 4200, 1100, 1450, 1960]),
    wParagraph("1.1.2. Техническое задание на изготовление рекламной конструкции:", { bold: true, before: 180 }),
    technicalBlockXml(data, imageRels),
    wParagraph(`Адрес монтажа / доставки / проведения работ: ${data.workAddress || "не указан"}.`),
    wParagraph(`Срок производства - до ${data.workDays} рабочих дней, ${paymentPhrase(data.paymentTerms)}.`),
    wParagraph(data.paymentTerms === "Без предоплаты" ? "Оплата производится без предоплаты в порядке, согласованном Сторонами." : data.paymentTerms),
    blankParagraphs(3),
    wTable(
      [[`_____________/ ${sellerShortName(data.seller)}/\nм.п.`, `_____________/ ${customerSign}/\nм.п.`]],
      [4680, 4680],
    ),
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function base64ToBytes(dataUrl) {
  const [, meta, base64] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: meta || "image/png", bytes };
}

function crc32(bytes) {
  let crc = -1;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function u16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
    ]);
    chunks.push(local, name, data);
    central.push({ file, name, data, crc, offset });
    offset += local.length + name.length + data.length;
  });

  const centralStart = offset;
  central.forEach((entry) => {
    const header = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(entry.crc),
      ...u32(entry.data.length),
      ...u32(entry.data.length),
      ...u16(entry.name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(entry.offset),
    ]);
    chunks.push(header, entry.name);
    offset += header.length + entry.name.length;
  });

  const centralSize = offset - centralStart;
  chunks.push(
    new Uint8Array([
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(files.length),
      ...u16(files.length),
      ...u32(centralSize),
      ...u32(centralStart),
      ...u16(0),
    ]),
  );
  return new Blob(chunks, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function buildDocxBlob(data) {
  const imageFiles = createImageFilesFromBlocks(data, { relPrefix: "rIdImage", filePrefix: "mockup" });
  const rels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    ...imageFiles.map((image) => `<Relationship Id="${image.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.path.split("/").pop()}"/>`),
  ].join("");
  const imageTypes = [...new Set(imageFiles.map((image) => image.mime))]
    .map((mime) => {
      const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
      return `<Default Extension="${ext}" ContentType="${mime}"/>`;
    })
    .join("");
  return makeZip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: "word/_rels/document.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    },
    {
      name: "word/styles.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="${WORD_SINGLE_LINE}" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="${WORD_FONT}" w:hAnsi="${WORD_FONT}" w:cs="${WORD_FONT}"/><w:sz w:val="${WORD_FONT_SIZE}"/><w:szCs w:val="${WORD_FONT_SIZE}"/></w:rPr></w:style></w:styles>`,
    },
    { name: "word/document.xml", content: buildCombinedDocumentXml(data, imageFiles) },
    ...imageFiles.map((image) => ({ name: image.path, content: image.bytes })),
  ]);
}

function downloadDocx(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("Browser does not support DOCX template decompression");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipDocx(buffer) {
  const bytes = new Uint8Array(buffer);
  const files = [];
  let offset = 0;

  while (offset < bytes.length) {
    const signature =
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
    if (signature !== 0x04034b50) break;

    const method = bytes[offset + 8] | (bytes[offset + 9] << 8);
    const compressedSize =
      bytes[offset + 18] |
      (bytes[offset + 19] << 8) |
      (bytes[offset + 20] << 16) |
      (bytes[offset + 21] << 24);
    const fileNameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameEnd));
    const compressed = bytes.slice(dataStart, dataEnd);
    const content = method === 8 ? await inflateRaw(compressed) : compressed;
    files.push({ name, content });
    offset = dataEnd;
  }

  return files;
}

function fileText(files, name) {
  const file = files.find((entry) => entry.name === name);
  return file ? new TextDecoder().decode(file.content) : "";
}

function replaceFile(files, name, content) {
  const encoded = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const index = files.findIndex((entry) => entry.name === name);
  if (index >= 0) files[index] = { name, content: encoded };
  else files.push({ name, content: encoded });
}

function paragraphText(xml) {
  return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1].replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"))
    .join("");
}

function paragraphFromTemplate(original, text, options = {}) {
  const pPr = stripHighlight(original.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] || "");
  const rPr = runPropertiesFromTemplate(original, options);
  return `<w:p>${pPr}${String(text)
    .split("\n")
    .map((line, index) => `${index ? "<w:r><w:br/></w:r>" : ""}${wText(line, { rPr })}`)
    .join("")}</w:p>`;
}

function paragraphFromTemplateWithLeadingBreaks(original, text, options = {}) {
  const pPr = stripHighlight(original.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] || "");
  const rPr = runPropertiesFromTemplate(original, options);
  const leadingBreakRuns = [];
  const runs = [...original.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];

  for (const run of runs) {
    if (/<w:t\b/.test(run[0])) break;
    if (/<w:br\b/.test(run[0])) leadingBreakRuns.push(run[0]);
  }

  return `<w:p>${pPr}${leadingBreakRuns.join("")}${wText(text, { rPr })}</w:p>`;
}

function paragraphRunsFromTemplate(original, runs, options = {}) {
  const pPr = stripHighlight(original.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] || "");
  const baseRPr = runPropertiesFromTemplate(original, options);
  return `<w:p>${pPr}${runs.map((run) => wText(run.text, { rPr: baseRPr, bold: run.bold })).join("")}</w:p>`;
}

function replaceParagraphByPredicate(xml, predicate, text, options = {}) {
  let replaced = false;
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!replaced && predicate(paragraphText(paragraph))) {
      replaced = true;
      return paragraphFromTemplate(paragraph, text, options);
    }
    return paragraph;
  });
}

function replaceParagraphByPredicateWithLeadingBreaks(xml, predicate, text, options = {}) {
  let replaced = false;
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!replaced && predicate(paragraphText(paragraph))) {
      replaced = true;
      return paragraphFromTemplateWithLeadingBreaks(paragraph, text, options);
    }
    return paragraph;
  });
}

function replaceParagraphRunsByPredicate(xml, predicate, runs, options = {}) {
  let replaced = false;
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!replaced && predicate(paragraphText(paragraph))) {
      replaced = true;
      return paragraphRunsFromTemplate(paragraph, runs, options);
    }
    return paragraph;
  });
}

function replaceParagraphRange(xml, startPredicate, endPredicate, replacementParagraphs) {
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => ({
    xml: match[0],
    start: match.index,
    end: match.index + match[0].length,
    text: paragraphText(match[0]),
  }));
  const start = paragraphs.findIndex((paragraph) => startPredicate(paragraph.text));
  if (start < 0) return xml;
  const end = paragraphs.findIndex((paragraph, index) => index > start && endPredicate(paragraph.text));
  if (end < 0 || end <= start + 1) return xml;
  const replacement = replacementParagraphs.map((text) => paragraphFromTemplate(paragraphs[start + 1].xml, text)).join("");
  return xml.slice(0, paragraphs[start + 1].start) + replacement + xml.slice(paragraphs[end].start);
}

function replaceParagraphRangeWithXml(xml, startPredicate, endPredicate, replacementXml) {
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => ({
    xml: match[0],
    start: match.index,
    end: match.index + match[0].length,
    text: paragraphText(match[0]),
  }));
  const start = paragraphs.findIndex((paragraph) => startPredicate(paragraph.text));
  if (start < 0) return xml;
  const end = paragraphs.findIndex((paragraph, index) => index > start && endPredicate(paragraph.text));
  if (end < 0) return xml;
  return xml.slice(0, paragraphs[start + 1].start) + replacementXml + xml.slice(paragraphs[end].start);
}

function replaceAfterParagraphUntilNextTableWithXml(xml, startPredicate, replacementXml) {
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => ({
    xml: match[0],
    start: match.index,
    end: match.index + match[0].length,
    text: paragraphText(match[0]),
  }));
  const start = paragraphs.findIndex((paragraph) => startPredicate(paragraph.text));
  if (start < 0) return xml;

  const tableStart = xml.indexOf("<w:tbl", paragraphs[start].end);
  if (tableStart < 0) return xml;

  return xml.slice(0, paragraphs[start].end) + replacementXml + xml.slice(tableStart);
}

function removeEmptyParagraphsBeforeAppendix(xml) {
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => ({
    xml: match[0],
    start: match.index,
    end: match.index + match[0].length,
    text: paragraphText(match[0]),
  }));
  const appendix = paragraphs.findIndex((paragraph) => paragraph.text.includes("ПРИЛОЖЕНИЕ № 1"));
  if (appendix < 0) return xml;

  let removeFrom = paragraphs[appendix].start;
  for (let index = appendix - 1; index >= 0; index -= 1) {
    if (paragraphs[index].text.trim()) break;
    removeFrom = paragraphs[index].start;
  }

  return xml.slice(0, removeFrom) + xml.slice(paragraphs[appendix].start);
}

function replaceTableAt(xml, tableIndex, replacement) {
  let index = -1;
  return xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (table) => {
    index += 1;
    return index === tableIndex ? replacement : table;
  });
}

function updateTableAt(xml, tableIndex, updater) {
  let index = -1;
  return xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (table) => {
    index += 1;
    return index === tableIndex ? updater(table) : table;
  });
}

function tableRows(tableXml) {
  return [...tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((match) => ({
    xml: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function updateTableCellAt(tableXml, rowIndex, cellIndex, updater) {
  const rows = tableRows(tableXml);
  const row = rows[rowIndex];
  if (!row) return tableXml;

  let currentCell = -1;
  const rowXml = row.xml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cellXml) => {
    currentCell += 1;
    return currentCell === cellIndex ? updater(cellXml) : cellXml;
  });

  return tableXml.slice(0, row.start) + rowXml + tableXml.slice(row.end);
}

function sellerKeyFromData(data) {
  if (data.sellerKey) return data.sellerKey;
  return data.seller?.title === SELLERS.ooo.title ? "ooo" : "ip";
}

async function loadSellerSignatureSealFiles(data, options = {}) {
  if (!data.addSignatureSeal) return [];

  const config = SELLER_SIGNATURE_SEAL_ASSETS[sellerKeyFromData(data)];
  if (!config) throw new Error("Подпись и печать для выбранного исполнителя пока не добавлены.");

  const relPrefix = options.relPrefix || "rIdSellerSignature";
  const filePrefix = options.filePrefix || "seller-signature";
  const idOffset = options.idOffset || 100;
  const entries = [
    { key: "signature", path: config.signature, name: "Подпись исполнителя" },
    { key: "stamp", path: config.stamp, name: "Печать исполнителя" },
  ];
  const loaded = await Promise.all(
    entries.map(async (entry, index) => {
      try {
        const response = await fetch(entry.path, { cache: "no-store" });
        if (!response.ok) return null;
        const blob = await response.blob();
        const src = await blobToDataUrl(blob);
        const dimensions = await readImageDimensions(src);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mime = blob.type || "image/png";
        const ext = imageExtension(mime);
        return {
          type: entry.key,
          name: entry.name,
          relId: `${relPrefix}${index + 1}`,
          path: `word/media/${filePrefix}-${entry.key}.${ext}`,
          target: `media/${filePrefix}-${entry.key}.${ext}`,
          mime,
          bytes,
          width: dimensions.width || 1,
          height: dimensions.height || 1,
          documentIndex: idOffset + index,
        };
      } catch {
        return null;
      }
    }),
  );

  const files = loaded.filter(Boolean);
  if (files.length !== entries.length) {
    throw new Error("Файлы подписи и печати ИП Купоровой не найдены: assets/ip-signature.png и assets/ip-stamp.png.");
  }
  return files;
}

function floatingSignatureImageXml(image, layout, docIndex) {
  const imageName = image.name || "seller-signature";
  const cx = layout.cx;
  const cy = layout.cy;
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251660288" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${layout.x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${layout.y}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${docIndex + 1}" name="${escapeXml(imageName)}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docIndex + 1}" name="${escapeXml(imageName)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

function sellerSignatureSealRunsXml(signatureSealFiles, occurrence = 0) {
  const signature = signatureSealFiles.find((file) => file.type === "signature");
  const stamp = signatureSealFiles.find((file) => file.type === "stamp");
  if (!signature || !stamp) return "";

  const baseIndex = 120 + occurrence * 10;
  return [
    floatingSignatureImageXml(signature, {
      cx: Math.round(1.35 * EMU_PER_INCH),
      cy: Math.round(0.4 * EMU_PER_INCH),
      x: Math.round(0.08 * EMU_PER_INCH),
      y: Math.round(-0.05 * EMU_PER_INCH),
    }, baseIndex),
    floatingSignatureImageXml(stamp, {
      cx: Math.round(1.25 * EMU_PER_INCH),
      cy: Math.round(1.25 * EMU_PER_INCH),
      x: Math.round(0.72 * EMU_PER_INCH),
      y: Math.round(-0.34 * EMU_PER_INCH),
    }, baseIndex + 1),
  ].join("");
}

function addSellerSignatureSealToCell(cellXml, signatureSealFiles, occurrence = 0) {
  const runs = sellerSignatureSealRunsXml(signatureSealFiles, occurrence);
  if (!runs) return cellXml;
  return cellXml.replace(/(<w:p\b[^>]*>(?:<w:pPr[\s\S]*?<\/w:pPr>)?)/, `$1${runs}`);
}

function addSellerSignatureSealToTable(tableXml, rowIndex, cellIndex, signatureSealFiles, occurrence = 0) {
  if (!signatureSealFiles.length) return tableXml;
  return updateTableCellAt(tableXml, rowIndex, cellIndex, (cellXml) =>
    addSellerSignatureSealToCell(cellXml, signatureSealFiles, occurrence),
  );
}

function normalizeCellText(cell) {
  if (cell && typeof cell === "object" && !Array.isArray(cell)) return cell;
  return { text: cell };
}

function replaceCellText(cellXml, value) {
  const cell = normalizeCellText(value);
  const paragraphs = [...cellXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => ({
    xml: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const template = paragraphs[0]?.xml || "<w:p><w:r><w:rPr/><w:t></w:t></w:r></w:p>";
  const lines = String(cell.text ?? "").split("\n");
  const replacement = lines.map((line) => paragraphFromTemplate(template, line, { bold: cell.bold })).join("");

  if (!paragraphs.length) return cellXml.replace("</w:tc>", `${replacement}</w:tc>`);
  return cellXml.slice(0, paragraphs[0].start) + replacement + cellXml.slice(paragraphs.at(-1).end);
}

function replaceRowCells(rowXml, values) {
  let cellIndex = -1;
  return rowXml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cellXml) => {
    cellIndex += 1;
    return cellIndex < values.length ? replaceCellText(cellXml, values[cellIndex]) : cellXml;
  });
}

function replaceTableCellRows(tableXml, rowValues) {
  let rowIndex = -1;
  return tableXml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (rowXml) => {
    rowIndex += 1;
    return rowValues[rowIndex] ? replaceRowCells(rowXml, rowValues[rowIndex]) : rowXml;
  });
}

function updatePartiesTable(tableXml, data, signatureSealFiles = []) {
  const customerSign = customerSignatureName(data);
  const updatedTable = replaceTableCellRows(tableXml, [
    null,
    [
      { text: contractorDetails(data) },
      { text: customerDetails(data) },
    ],
    [
      { text: `_____________/ ${sellerShortName(data.seller)}/\nм.п.` },
      { text: `_____________/ ${customerSign}/\nм.п.` },
    ],
  ]);
  return addSellerSignatureSealToTable(updatedTable, 2, 0, signatureSealFiles, 0);
}

function updateSpecTable(tableXml, data) {
  const rows = tableRows(tableXml);
  if (rows.length < 3) return templateSpecTable(data);

  const itemTemplate = rows[1].xml;
  const totalTemplate = rows[rows.length - 1].xml;
  const itemRows = data.items.map((item) =>
    replaceRowCells(itemTemplate, [
      String(item.number),
      item.name,
      plainMoney(item.qty),
      plainMoney(item.price),
      plainMoney(item.sum),
    ]),
  );
  const totalRow = replaceRowCells(totalTemplate, [
    "",
    "",
    "",
    { text: "ИТОГО:", bold: true },
    { text: `${docMoney(data.totals.grandTotal)} в т.ч.\n${data.seller.vatLabel}`, bold: true },
  ]);
  const replacementRows = [rows[0].xml, ...itemRows, totalRow].join("");

  return tableXml.slice(0, rows[0].start) + replacementRows + tableXml.slice(rows.at(-1).end);
}

function updateSignaturesTable(tableXml, data, signatureSealFiles = []) {
  const customerSign = customerSignatureName(data);
  const updatedTable = replaceTableCellRows(tableXml, [
    [
      { text: `_____________/ ${sellerShortName(data.seller)}/\nм.п.` },
      { text: `_____________/ ${customerSign}/\nм.п.` },
    ],
  ]);
  return addSellerSignatureSealToTable(updatedTable, 0, 0, signatureSealFiles, 1);
}

function updateInvoiceBankTable(tableXml, data) {
  const seller = data.seller;
  return replaceTableCellRows(tableXml, [
    [`ИНН\n${seller.inn}`, `КПП\n${seller.kpp || ""}`, "Сч.№", `р/с: ${seller.checkingAccount}`],
    [`Получатель: ${seller.fullName}`, "", ""],
    [`Банк получателя: ${seller.bankName}`, "БИК", seller.bankBik],
    ["", "Сч.№", `к/с: ${seller.correspondentAccount}`],
  ]);
}

function updateInvoiceItemsTable(tableXml, data) {
  const rows = tableRows(tableXml);
  if (rows.length < 4) return tableXml;

  const itemTemplate = rows[1].xml;
  const totalTemplate = rows[rows.length - 2].xml;
  const wordsTemplate = rows[rows.length - 1].xml;
  const itemRows = data.items.map((item) =>
    replaceRowCells(itemTemplate, [
      `${item.number}.`,
      item.name,
      `${plainMoney(item.qty)} (шт)`,
      invoiceMoney(item.price),
      invoiceMoney(item.sum),
    ]),
  );
  const totalRow = replaceRowCells(totalTemplate, ["", `Итого с ${data.seller.vatLabel}`, invoiceMoney(data.totals.grandTotal)]);
  const wordsRow = replaceRowCells(wordsTemplate, ["", `Сумма прописью: ${rubleWords(data.totals.grandTotal)}`]);
  const replacementRows = [rows[0].xml, ...itemRows, totalRow, wordsRow].join("");

  return tableXml.slice(0, rows[0].start) + replacementRows + tableXml.slice(rows.at(-1).end);
}

function replaceSignatureCellName(cellXml, name) {
  const textNodes = [...cellXml.matchAll(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g)];
  const target = textNodes.findLast((match) => match[0].replace(/<[^>]+>/g, "").trim());
  if (!target) return replaceCellText(cellXml, name);

  const content = target[0].match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/)?.[1] || "";
  const prefix = content.match(/^([\s_]+)/)?.[1] || " ";
  const replacement = target[0].replace(/>([\s\S]*?)<\/w:t>$/, `>${prefix}${escapeXml(name)}</w:t>`);
  return cellXml.slice(0, target.index) + replacement + cellXml.slice(target.index + target[0].length);
}

function updateInvoiceSignatureRow(rowXml, data) {
  const names = [sellerShortName(data.seller), customerSignatureName(data)];
  let cellIndex = -1;
  return rowXml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cellXml) => {
    cellIndex += 1;
    return names[cellIndex] ? replaceSignatureCellName(cellXml, names[cellIndex]) : cellXml;
  });
}

function updateInvoiceSignatureTable(tableXml, data, signatureSealFiles = [], occurrence = 0) {
  const rows = tableRows(tableXml);
  if (rows.length < 2) return tableXml;
  const signatureRow = updateInvoiceSignatureRow(rows[1].xml, data);
  const updatedTable = tableXml.slice(0, rows[1].start) + signatureRow + tableXml.slice(rows[1].end);
  return addSellerSignatureSealToTable(updatedTable, 1, 0, signatureSealFiles, occurrence);
}

function blankParagraphs(count) {
  return Array.from({ length: count }, () => wParagraph("")).join("");
}

function getDocumentTechnicalBlocks(data) {
  if (Array.isArray(data.technicalBlocks) && data.technicalBlocks.length) {
    return data.technicalBlocks.map((block) => ({
      preset: block.preset || "",
      description: block.description || "",
      mockups: [...(block.mockups || block.images || [])],
    }));
  }

  const descriptions = data.technicalDescriptions?.length
    ? data.technicalDescriptions
    : data.technicalDescription
      ? [data.technicalDescription]
      : [];
  const legacyMockups = [...(data.mockups || [])];

  if (descriptions.length) {
    return descriptions.map((description, index) => ({
      preset: "",
      description,
      mockups: index === 0 ? legacyMockups : [],
    }));
  }

  if (legacyMockups.length) return [{ preset: "", description: "", mockups: legacyMockups }];
  return [{ preset: "", description: "Техническое описание не указано.", mockups: [] }];
}

function createImageFilesFromBlocks(data, options = {}) {
  const blocks = getDocumentTechnicalBlocks(data);
  const relPrefix = options.relPrefix || "rIdImage";
  const filePrefix = options.filePrefix || "mockup";
  const idOffset = options.idOffset || 0;
  let imageIndex = 0;

  return blocks.flatMap((block, blockIndex) =>
    (block.mockups || []).map((mockup) => {
      imageIndex += 1;
      const { mime, bytes } = base64ToBytes(mockup.src);
      const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
      return {
        name: mockup.name,
        relId: `${relPrefix}${imageIndex}`,
        path: `word/media/${filePrefix}-${imageIndex}.${ext}`,
        target: `media/${filePrefix}-${imageIndex}.${ext}`,
        mime,
        bytes,
        width: mockup.width,
        height: mockup.height,
        blockIndex,
        documentIndex: idOffset + imageIndex - 1,
      };
    }),
  );
}

function technicalBlockXml(data, imageRels) {
  const blocks = getDocumentTechnicalBlocks(data);
  return blocks
    .map((block, blockIndex) => {
      const blockImages = imageRels.filter((image) => image.blockIndex === blockIndex);
      const heading = block.preset || "";
      const prefixXml = heading ? wParagraph(heading, { bold: true }) : "";
      const imagesXml = blockImages.map((image) => `${blankParagraphs(1)}${wImage(image)}${blankParagraphs(1)}`).join("");
      const lines = (block.description || "Техническое описание не указано.").split(/\n+/).filter(Boolean);
      const descriptionXml = lines.map((line) => wParagraph(line)).join("");
      return prefixXml + imagesXml + descriptionXml;
    })
    .join("");
}

function addRelationshipXml(relsXml, relId, target) {
  const relationship = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`;
  return relsXml.replace("</Relationships>", `${relationship}</Relationships>`);
}

function ensureImageContentType(contentTypesXml, mime) {
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  if (contentTypesXml.includes(`Extension="${ext}"`)) return contentTypesXml;
  return contentTypesXml.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`);
}

function templateSpecTable(data) {
  return wTable(
    [
      ["№", "Наименование", "Кол-во, шт.", "Цена, руб.", "Сумма, руб."],
      ...data.items.map((item) => [String(item.number), item.name, plainMoney(item.qty), plainMoney(item.price), plainMoney(item.sum)]),
      ["", "", "", { text: "ИТОГО:", bold: true, align: "left" }, { text: `${docMoney(data.totals.grandTotal)} в т.ч.\n${data.seller.vatLabel}`, bold: true, align: "center" }],
    ],
    [650, 4200, 1100, 1450, 1960],
  );
}

function templatePartiesTable(data) {
  const customerSign = customerSignatureName(data);
  return wTable(
    [
      ["Подрядчик:", "Заказчик:"],
      [{ text: contractorDetails(data), align: "left" }, { text: customerDetails(data), align: "left" }],
      [{ text: `_____________/ ${sellerShortName(data.seller)}/\nм.п.`, align: "center" }, { text: `_____________/ ${customerSign}/\nм.п.`, align: "center" }],
    ],
    [4680, 4680],
  );
}

function templateSignaturesTable(data) {
  const customerSign = customerSignatureName(data);
  return `${blankParagraphs(3)}${wTable(
    [
      ["Подрядчик:", "Заказчик:"],
      [{ text: `_____________/ ${sellerShortName(data.seller)}/\nм.п.`, align: "center" }, { text: `_____________/ ${customerSign}/\nм.п.`, align: "center" }],
    ],
    [4680, 4680],
  )}`;
}

async function buildTemplateDocxBlob(data) {
  const response = await fetch("dogovor_final.docx");
  if (!response.ok) throw new Error("Template not found");
  const files = await unzipDocx(await response.arrayBuffer());
  const imageFiles = createImageFilesFromBlocks(data, {
    relPrefix: "rIdMockup",
    filePrefix: "generated-mockup",
    idOffset: 20,
  });
  const signatureSealFiles = await loadSellerSignatureSealFiles(data, {
    relPrefix: "rIdContractSignature",
    filePrefix: "contract-signature-seal",
    idOffset: 100,
  });

  let documentXml = fileText(files, "word/document.xml");
  const contractDate = formatDate(data.contractDate);
  const date = new Date(`${data.contractDate}T00:00:00`);
  const day = new Intl.DateTimeFormat("ru-RU", { day: "2-digit" }).format(date);
  const month = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(date);
  const year = date.getFullYear();
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("ДОГОВОР ПОДРЯДА №"), `ДОГОВОР ПОДРЯДА №${data.contractNumber}`);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.includes("г. Москва") && text.includes("года"), `г. Москва\t«${day}» ${month} ${year} года`);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.includes("именуем") && text.includes("Стороны") && text.includes("заключили настоящий Договор"), partyIntro(data));
  documentXml = replaceParagraphByPredicate(
    documentXml,
    (text) => text.startsWith("4.1.") || text.startsWith("Сроки выполнения работ устанавливаются"),
    `Срок выполнения работ составляет ${data.workDays} рабочих дней. Подрядчик вправе досрочно выполнить работы по согласованию с Заказчиком.`,
    { bold: true },
  );
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("5.1.1."), `5.1.1. За качество светодиодной продукции в течение ${data.warranty} со дня подписания Заказчиком Акта приемки-передачи выполненных работ.`);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("5.1.2."), `5.1.2. За качество конструктивных составляющих (металлокаркас, корпус) в течение ${data.warranty} со дня подписания Заказчиком Акта приемки-передачи выполненных работ.`);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("5.1.3."), `5.1.3. За качество блоков питания в течение ${data.warranty} со дня подписания Заказчиком Акта приемки-передачи выполненных работ.`);
  documentXml = replaceParagraphByPredicate(
    documentXml,
    (text) => text.includes("Подрядчик предоставляет гарантию на выполненные работы сроком"),
    `5.2. Подрядчик предоставляет гарантию на выполненные работы сроком ${data.warranty} со дня подписания Заказчиком Акта приемки-передачи выполненных работ.`,
    { bold: true },
  );
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("к Договору подряда №"), `к Договору подряда № ${data.contractNumber} от ${contractDate} года`);
  documentXml = replaceParagraphRunsByPredicate(documentXml, (text) => text.includes("Оплата настоящего Договора производится на следующих условиях"), buildPaymentTermsRuns(data));
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.includes("Адрес монтажа") || text.includes("Адрес доставки"), `1.1.3. Адрес монтажа (доставки) конструкции: ${data.workAddress || "не указан"}`);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.includes("Техническое задание на изготовление рекламной конструкции"), "1.1.4. Техническое задание на изготовление рекламной конструкции:");
  documentXml = replaceParagraphRangeWithXml(
    documentXml,
    (text) => text.includes("Техническое задание на изготовление рекламной конструкции"),
    (text) => text.includes("Срок производства") || text.includes("Срок производства (монтажа)"),
    technicalBlockXml(data, imageFiles),
  );
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.includes("Срок производства") || text.includes("Срок производства (монтажа)"), `1.1.5. Срок производства (монтажа) – до ${data.workDays} рабочих дней, ${paymentPhrase(data.paymentTerms)}.`);
  documentXml = updateTableAt(documentXml, 0, (table) => updatePartiesTable(table, data, signatureSealFiles));
  documentXml = updateTableAt(documentXml, 1, (table) => updateSpecTable(table, data));
  documentXml = updateTableAt(documentXml, 2, (table) => updateSignaturesTable(table, data, signatureSealFiles));

  let relsXml = fileText(files, "word/_rels/document.xml.rels");
  let contentTypesXml = fileText(files, "[Content_Types].xml");
  [...imageFiles, ...signatureSealFiles].forEach((image) => {
    relsXml = addRelationshipXml(relsXml, image.relId, image.target);
    contentTypesXml = ensureImageContentType(contentTypesXml, image.mime);
    replaceFile(files, image.path, image.bytes);
  });

  replaceFile(files, "word/document.xml", documentXml);
  replaceFile(files, "word/_rels/document.xml.rels", relsXml);
  replaceFile(files, "[Content_Types].xml", contentTypesXml);
  return makeZip(files);
}

async function buildInvoiceContractDocxBlob(data) {
  const response = await fetch("schet_dogovor_template.docx");
  if (!response.ok) throw new Error("Template not found");
  const files = await unzipDocx(await response.arrayBuffer());
  const imageFiles = createImageFilesFromBlocks(data, {
    relPrefix: "rIdInvoiceMockup",
    filePrefix: "invoice-mockup",
    idOffset: 40,
  });
  const signatureSealFiles = await loadSellerSignatureSealFiles(data, {
    relPrefix: "rIdInvoiceSignature",
    filePrefix: "invoice-signature-seal",
    idOffset: 140,
  });

  const longDate = longDateText(data.contractDate);
  const contractor = invoiceContractorLines(data);
  const customer = invoiceCustomerLines(data);
  let documentXml = fileText(files, "word/document.xml");

  documentXml = replaceParagraphByPredicate(
    documentXml,
    (text) => text.startsWith("Счет-договор на выполнение работ"),
    `Счет-договор на выполнение работ и/или услуг № ${data.contractNumber} от ${longDate} г.`,
  );
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("Исполнитель:"), invoiceSellerIntro(data.seller));
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.includes("Балашиха") && text.includes("Мирской"), "");
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.includes("ИП КУПОРОВА") && text.includes("ИНН"), contractor.name, { bold: true });
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("Адрес:"), contractor.address);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("Email:"), contractor.email);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("В ООО") || text.startsWith("В "), contractor.bank);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("К/С"), contractor.correspondent);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("БИК:") && text.includes("044525104"), contractor.bik);
  documentXml = replaceParagraphByPredicateWithLeadingBreaks(documentXml, (text) => text.includes('"ИНТЕКТЕХНО"'), customer.name);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("Юр. Адрес:"), customer.address);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("ИНН:") && text.includes("7718214883"), customer.inn);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("ОГРН:"), customer.ogrn);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("р/с:"), customer.account);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("БИК:") && text.includes("044525685"), customer.bik);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("к/с:"), customer.correspondent);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("Адрес доставки и установки:"), `Адрес доставки и установки: ${data.workAddress || "не указан"}`);
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("Оплата настоящего Счет-Договора производится"), invoicePaymentTermsText(data));
  documentXml = replaceParagraphByPredicate(
    documentXml,
    (text) => text.startsWith("Поставщик обязан доставить"),
    `Поставщик обязан доставить (отгрузить) оплаченный товар и передать его Заказчику в течение ${workDaysText(data.workDays)} рабочих дней с момента зачисления оплаты на расчетный счет Поставщика и согласования макета Сторонами.`,
  );
  documentXml = replaceParagraphByPredicate(documentXml, (text) => text.startsWith("Гарантия на поставляемый товар составляет"), `Гарантия на поставляемый товар составляет ${data.warranty} с даты поставки товара.`);
  documentXml = replaceParagraphByPredicate(
    documentXml,
    (text) => text.startsWith("Приложение №1 К Счет-договору"),
    `Приложение №1 К Счет-договору на поставку товара № ${data.contractNumber} от ${longDate} г.`,
  );
  documentXml = replaceAfterParagraphUntilNextTableWithXml(
    documentXml,
    (text) => text.includes("Описание конструкции:"),
    `${technicalBlockXml(data, imageFiles)}${blankParagraphs(3)}`,
  );
  documentXml = updateTableAt(documentXml, 0, (table) => updateInvoiceBankTable(table, data));
  documentXml = updateTableAt(documentXml, 1, (table) => updateInvoiceItemsTable(table, data));
  documentXml = updateTableAt(documentXml, 2, (table) => updateInvoiceSignatureTable(table, data, signatureSealFiles, 0));
  documentXml = updateTableAt(documentXml, 3, (table) => updateInvoiceSignatureTable(table, data, signatureSealFiles, 1));

  let relsXml = fileText(files, "word/_rels/document.xml.rels");
  let contentTypesXml = fileText(files, "[Content_Types].xml");
  [...imageFiles, ...signatureSealFiles].forEach((image) => {
    relsXml = addRelationshipXml(relsXml, image.relId, image.target);
    contentTypesXml = ensureImageContentType(contentTypesXml, image.mime);
    replaceFile(files, image.path, image.bytes);
  });

  replaceFile(files, "word/document.xml", documentXml);
  replaceFile(files, "word/_rels/document.xml.rels", relsXml);
  replaceFile(files, "[Content_Types].xml", contentTypesXml);
  return makeZip(files);
}

function contractDownloadName(data) {
  const number = data.contractNumber || "без номера";
  return data.documentTemplate === "invoiceContract"
    ? `Счет-договор №${number}.docx`
    : `Договор №${number} с приложением.docx`;
}

function buildSelectedDocxBlob(data) {
  return data.documentTemplate === "invoiceContract" ? buildInvoiceContractDocxBlob(data) : buildTemplateDocxBlob(data);
}

function saveDraft() {
  const data = collectData();
  localStorage.setItem("managerContractDraft", JSON.stringify(data));
  localStorage.setItem("dadataToken", getField("dadataToken").value);
  alert("Черновик сохранен.");
}

function loadDraft() {
  const token = localStorage.getItem("dadataToken");
  if (token) setField("dadataToken", token);

  const raw = localStorage.getItem("managerContractDraft");
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    setField("contractNumber", data.contractNumber);
    setField("contractDate", data.contractDate);
    setField("documentTemplate", data.documentTemplate || "invoiceContract");
    setRadioValue("seller", data.seller?.title === SELLERS.ooo.title ? "ooo" : "ip");
    setRadioValue("customerType", data.customerType || "legal");
    setField("customerInn", data.customer?.inn);
    setField("customerKpp", data.customer?.kpp);
    setField("customerName", data.customer?.name);
    setField("customerAddress", data.customer?.address);
    setField("customerOgrn", data.customer?.ogrn);
    setField("customerDirector", data.customer?.director);
    setField("personName", data.customerType === "person" ? data.customer?.name : "");
    setField("passport", data.customer?.passport);
    setField("personAddress", data.customerType === "person" ? data.customer?.address : "");
    setField("paymentTerms", normalizePaymentValue(data.paymentTerms));
    setField("finalPaymentTiming", data.finalPaymentTiming || "beforeShipment");
    setField("warranty", data.warranty);
    setField("addSignatureSeal", data.addSignatureSeal ? "yes" : "no");
    setField("workDays", data.workDays || "10");
    setField("workAddress", data.workAddress);
    techDescriptions.innerHTML = "";
    const blocks = data.technicalBlocks?.length
      ? data.technicalBlocks
      : (data.technicalDescriptions?.length ? data.technicalDescriptions : [data.technicalDescription || ""]).map((description, index) => ({
          description,
          mockups: index === 0 ? data.mockups || [] : [],
        }));
    blocks.forEach((block) => addTechDescription(block));
    getField("requestLibraryAdd").checked = Boolean(data.requestLibraryAdd);

    itemsBody.innerHTML = "";
    (data.items || []).forEach(addItem);
    toggleCustomerFields();
    toggleFinalPaymentTiming();
    recalculate();
  } catch {
    localStorage.removeItem("managerContractDraft");
  }
}

async function lookupInn() {
  const inn = getField("customerInn").value.trim();
  const token = getField("dadataToken").value.trim();

  if (!inn) {
    alert("Введите ИНН заказчика.");
    return;
  }

  if (!token) {
    alert("Для автоматического поиска нужен DaData API token. Пока можно заполнить реквизиты вручную.");
    return;
  }

  try {
    const response = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({ query: inn }),
    });

    if (!response.ok) throw new Error("DaData request failed");

    const result = await response.json();
    const company = result.suggestions?.[0];
    if (!company) {
      alert("Компания по этому ИНН не найдена.");
      return;
    }

    setField("customerName", company.value);
    setField("customerKpp", company.data.kpp);
    setField("customerAddress", company.data.address?.unrestricted_value);
    setField("customerOgrn", company.data.ogrn);
    setField("customerDirector", company.data.management?.name);
    localStorage.setItem("dadataToken", token);
  } catch {
    alert("Не удалось получить данные по ИНН. Проверьте токен или заполните реквизиты вручную.");
  }
}

document.querySelector("#addItemButton").addEventListener("click", () => addItem());
document.querySelector("#saveDraftButton").addEventListener("click", saveDraft);
document.querySelector("#lookupInnButton").addEventListener("click", lookupInn);
document.querySelector("#downloadContractButton").addEventListener("click", async () => {
  if (!validateBeforeDownload()) return;
  const data = collectData();
  try {
    const blob = await buildSelectedDocxBlob(data);
    downloadDocx(contractDownloadName(data), blob);
  } catch (error) {
    console.error(error);
    const message = error?.message || "";
    alert(
      message.includes("подпись") || message.includes("печать")
        ? message
        : "Не удалось прочитать шаблон договора. Откройте приложение через локальный сервер, а не напрямую из файла.",
    );
  }
});
document.querySelector("#addTechDescriptionButton").addEventListener("click", () => addTechDescription());
form.addEventListener("change", (event) => {
  if (event.target.name === "customerType") toggleCustomerFields();
  if (event.target.name === "paymentTerms") toggleFinalPaymentTiming();
  if (event.target.name === "seller") {
    renderSellerDetails();
    recalculate();
  }
});

async function initApp() {
  setField("contractDate", todayIso());
  await loadTechPresets();
  addItem();
  addTechDescription();
  renderSellerDetails();
  toggleFinalPaymentTiming();
  loadDraft();
}

initApp();
