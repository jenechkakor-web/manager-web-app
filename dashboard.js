const dateFromInput = document.querySelector("#dashboardDateFrom");
const dateToInput = document.querySelector("#dashboardDateTo");
const managerFilter = document.querySelector("#dashboardManagerFilter");
const sourceFilter = document.querySelector("#dashboardSourceFilter");
const applyPeriodButton = document.querySelector("#applyDashboardPeriodButton");
const currentMonthButton = document.querySelector("#dashboardCurrentMonthButton");
const allPeriodButton = document.querySelector("#dashboardAllPeriodButton");
const reloadButton = document.querySelector("#reloadDashboardButton");
const downloadCsvButton = document.querySelector("#downloadDashboardCsvButton");
const statusLine = document.querySelector("#dashboardStatus");
const kpiGrid = document.querySelector("#dashboardKpiGrid");
const sourceSummaryGrid = document.querySelector("#dashboardSourceSummaryGrid");
const tableWrap = document.querySelector("#dashboardTableWrap");
const tableTitle = document.querySelector("#dashboardTableTitle");
const tableSubtitle = document.querySelector("#dashboardTableSubtitle");
const viewButtons = [...document.querySelectorAll("[data-dashboard-view]")];

const EMPTY_SOURCE_FILTER = "__empty_source__";
const BUCKETS = [
  { id: "closed", label: "Закрытые", tone: "closed" },
  { id: "closedActive", label: "Закрытые + в работе", tone: "closed-active" },
  { id: "planned", label: "Планируемые", tone: "planned" },
];
const VIEW_META = {
  manager: {
    title: "Разбивка по менеджерам",
    subtitle: "Каждая строка показывает показатели одного менеджера по выбранной выборке.",
    primary: "Менеджер",
    secondary: "",
  },
  source: {
    title: "Разбивка по источникам",
    subtitle: "Каждая строка показывает показатели одного источника по выбранной выборке.",
    primary: "Источник",
    secondary: "",
  },
  managerSource: {
    title: "Разбивка по менеджерам и источникам",
    subtitle: "Каждая строка показывает связку менеджера и источника по выбранной выборке.",
    primary: "Менеджер",
    secondary: "Источник",
  },
};

let records = [];
let activeView = "manager";
let sortState = { field: "closedActive.sum", direction: "desc" };
const dashboardCollator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function numberForCsv(value) {
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  return String(Math.round((number + Number.EPSILON) * 100) / 100).replace(".", ",");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function currentMonthRange() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: localDateValue(firstDay), to: localDateValue(now) };
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU").format(date);
}

function periodLabel() {
  if (dateFromInput.value && dateToInput.value) return `${formatDate(dateFromInput.value)} — ${formatDate(dateToInput.value)}`;
  if (dateFromInput.value) return `с ${formatDate(dateFromInput.value)}`;
  if (dateToInput.value) return `по ${formatDate(dateToInput.value)}`;
  return "весь период";
}

function managerName(record) {
  return record.ownerLogin || "admin";
}

function sourceName(record) {
  return record.registryMeta?.source || "Не указано";
}

function sourceValue(record) {
  return record.registryMeta?.source || EMPTY_SOURCE_FILTER;
}

function remainder(record, prepayment = record.registryMeta?.prepayment) {
  const difference = (Number(record.amount) || 0) - (Number(prepayment) || 0);
  return Math.max(0, Math.round((difference + Number.EPSILON) * 100) / 100);
}

function hasPaymentRemainder(record, prepayment = record.registryMeta?.prepayment) {
  return remainder(record, prepayment) > 0;
}

function dealBucket(record) {
  const { paymentStatus, closingDocs } = record.registryMeta || {};
  const closingComplete = closingDocs === "Отправлены" || closingDocs === "Не нужно";
  if (paymentStatus === "Да" && !hasPaymentRemainder(record) && closingComplete) return "closed";
  if (paymentStatus === "Да" || paymentStatus === "Предоплата") return "active";
  return "planned";
}

function emptyStats() {
  return {
    closed: { count: 0, sum: 0 },
    closedActive: { count: 0, sum: 0 },
    planned: { count: 0, sum: 0 },
  };
}

function addRecordToStats(stats, record) {
  const amount = Number(record.amount) || 0;
  const bucket = dealBucket(record);
  if (bucket === "closed") {
    stats.closed.count += 1;
    stats.closed.sum += amount;
    stats.closedActive.count += 1;
    stats.closedActive.sum += amount;
    return;
  }
  if (bucket === "active") {
    stats.closedActive.count += 1;
    stats.closedActive.sum += amount;
    return;
  }
  stats.planned.count += 1;
  stats.planned.sum += amount;
}

function average(stats) {
  return stats.count > 0 ? stats.sum / stats.count : 0;
}

function sortLabel(field) {
  const metricMatch = /^([a-zA-Z]+)\.(count|average|sum)$/.exec(field);
  if (field === "primary") return VIEW_META[activeView].primary;
  if (field === "secondary") return VIEW_META[activeView].secondary || "Источник";
  if (!metricMatch) return "";
  const bucket = BUCKETS.find((item) => item.id === metricMatch[1]);
  const metricLabels = {
    count: "Сделки",
    average: "Средний чек",
    sum: "Сумма продаж",
  };
  return `${bucket?.label || ""}: ${metricLabels[metricMatch[2]] || ""}`;
}

function sortButton(field, label) {
  const active = sortState.field === field;
  const mark = active ? (sortState.direction === "asc" ? "↑" : "↓") : "↕";
  const directionLabel = sortState.direction === "asc" ? "по возрастанию" : "по убыванию";
  const title = active
    ? `Сейчас ${directionLabel}. Нажмите, чтобы изменить порядок`
    : `Сортировать по столбцу «${label}»`;
  return `
    <button class="dashboard-sort-button${active ? " is-active" : ""}" data-dashboard-sort="${escapeHtml(field)}" type="button" title="${escapeHtml(title)}">
      <span>${escapeHtml(label)}</span><span class="dashboard-sort-mark" aria-hidden="true">${mark}</span>
    </button>`;
}

function setStatus(message, type = "") {
  statusLine.textContent = message || "";
  statusLine.classList.toggle("status-error", type === "error");
  statusLine.classList.toggle("status-success", type === "success");
}

function validatePeriod() {
  if (dateFromInput.value && dateToInput.value && dateFromInput.value > dateToInput.value) {
    setStatus("Дата начала периода не может быть позже даты окончания.", "error");
    dateFromInput.focus();
    return false;
  }
  return true;
}

function filteredRecords() {
  return records.filter((record) => {
    const recordDate = String(record.date || "");
    const inDateRange =
      (!dateFromInput.value || (recordDate && recordDate >= dateFromInput.value)) &&
      (!dateToInput.value || (recordDate && recordDate <= dateToInput.value));
    return (
      inDateRange &&
      (!managerFilter.value || managerName(record) === managerFilter.value) &&
      (!sourceFilter.value || sourceValue(record) === sourceFilter.value)
    );
  });
}

function buildTotal(recordsToAggregate) {
  const stats = emptyStats();
  recordsToAggregate.forEach((record) => addRecordToStats(stats, record));
  return stats;
}

function groupRows(recordsToAggregate, view) {
  const groups = new Map();
  recordsToAggregate.forEach((record) => {
    const manager = managerName(record);
    const source = sourceName(record);
    const key = view === "manager"
      ? manager
      : view === "source"
        ? source
        : `${manager}\u0000${source}`;
    if (!groups.has(key)) {
      groups.set(key, {
        primary: view === "source" ? source : manager,
        secondary: view === "managerSource" ? source : "",
        stats: emptyStats(),
      });
    }
    addRecordToStats(groups.get(key).stats, record);
  });
  return [...groups.values()].sort((left, right) => {
    const amountDiff = right.stats.closedActive.sum - left.stats.closedActive.sum;
    if (amountDiff !== 0) return amountDiff;
    const primaryDiff = left.primary.localeCompare(right.primary, "ru", { numeric: true, sensitivity: "base" });
    return primaryDiff || left.secondary.localeCompare(right.secondary, "ru", { numeric: true, sensitivity: "base" });
  });
}

function metricSortValue(row, field) {
  if (field === "primary") return row.primary;
  if (field === "secondary") return row.secondary;
  const match = /^([a-zA-Z]+)\.(count|average|sum)$/.exec(field);
  if (!match) return "";
  const stats = row.stats[match[1]];
  if (!stats) return 0;
  if (match[2] === "count") return stats.count;
  if (match[2] === "average") return average(stats);
  return stats.sum;
}

function sortRows(rows) {
  const direction = sortState.direction === "asc" ? 1 : -1;
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = metricSortValue(left.row, sortState.field);
      const rightValue = metricSortValue(right.row, sortState.field);
      let comparison;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        comparison = leftValue - rightValue;
      } else {
        comparison = dashboardCollator.compare(String(leftValue), String(rightValue));
      }
      if (comparison === 0) {
        const primaryComparison = dashboardCollator.compare(left.row.primary, right.row.primary);
        if (primaryComparison !== 0) return primaryComparison;
        const secondaryComparison = dashboardCollator.compare(left.row.secondary, right.row.secondary);
        return secondaryComparison !== 0 ? secondaryComparison : left.index - right.index;
      }
      return comparison * direction;
    })
    .map(({ row }) => row);
}

function renderFilterOptions() {
  const selectedManager = managerFilter.value;
  const selectedSource = sourceFilter.value;
  const managers = [...new Set(records.map(managerName))].sort((a, b) => a.localeCompare(b, "ru"));
  const sourceOptions = [
    ...(records.some((record) => !record.registryMeta?.source) ? [EMPTY_SOURCE_FILTER] : []),
    ...window.ContractRegistry.SOURCE_OPTIONS,
  ];
  managerFilter.innerHTML = [
    '<option value="">Все менеджеры</option>',
    ...managers.map((manager) => `<option value="${escapeHtml(manager)}">${escapeHtml(manager)}</option>`),
  ].join("");
  sourceFilter.innerHTML = [
    '<option value="">Все источники</option>',
    ...sourceOptions.map((source) => {
      const label = source === EMPTY_SOURCE_FILTER ? "Не указано" : source;
      return `<option value="${escapeHtml(source)}">${escapeHtml(label)}</option>`;
    }),
  ].join("");
  if (managers.includes(selectedManager)) managerFilter.value = selectedManager;
  if (sourceOptions.includes(selectedSource)) sourceFilter.value = selectedSource;
}

function renderKpis(totalStats) {
  kpiGrid.innerHTML = BUCKETS.map((bucket) => {
    const stats = totalStats[bucket.id];
    return `
      <article class="dashboard-kpi-card dashboard-kpi-${bucket.tone}">
        <span>${escapeHtml(bucket.label)}</span>
        <strong>${escapeHtml(money(stats.sum))}</strong>
        <small>${stats.count} сделок · средний чек ${escapeHtml(money(average(stats)))}</small>
      </article>`;
  }).join("");
}

function renderSourceSummary(sourceRows) {
  if (!sourceRows.length) {
    sourceSummaryGrid.innerHTML = '<div class="dashboard-empty">В выбранной выборке нет источников.</div>';
    return;
  }

  sourceSummaryGrid.innerHTML = sourceRows
    .map((row) => {
      const totalCount = row.stats.closedActive.count;
      const totalSum = row.stats.closedActive.sum;
      const bucketRows = BUCKETS.map((bucket) => {
        const stats = row.stats[bucket.id];
        return `
          <span class="dashboard-source-stat dashboard-source-stat-${bucket.tone}">
            <span>${escapeHtml(bucket.label)}</span>
            <strong>${stats.count} · ${escapeHtml(money(stats.sum))}</strong>
          </span>`;
      }).join("");
      return `
        <article class="dashboard-source-card">
          <span class="dashboard-source-name">${escapeHtml(row.primary)}</span>
          <strong>${escapeHtml(money(totalSum))}</strong>
          <small>Закрытые + в работе: ${totalCount} сделок · средний чек ${escapeHtml(money(totalCount ? totalSum / totalCount : 0))}</small>
          <div class="dashboard-source-stats">${bucketRows}</div>
        </article>`;
    })
    .join("");
}

function metricHeaders() {
  return `
    <tr>
      <th rowspan="2" scope="col">${sortButton("primary", VIEW_META[activeView].primary)}</th>
      ${VIEW_META[activeView].secondary ? `<th rowspan="2" scope="col">${sortButton("secondary", VIEW_META[activeView].secondary)}</th>` : ""}
      ${BUCKETS.map((bucket) => `<th class="dashboard-group-heading dashboard-cell-${bucket.tone}" colspan="3" scope="colgroup">${escapeHtml(bucket.label)}</th>`).join("")}
    </tr>
    <tr>
      ${BUCKETS.map((bucket) => `
        <th class="dashboard-cell-${bucket.tone} dashboard-group-start dashboard-count-cell" scope="col">${sortButton(`${bucket.id}.count`, "Сделки")}</th>
        <th class="dashboard-cell-${bucket.tone}" scope="col">${sortButton(`${bucket.id}.average`, "Средний чек")}</th>
        <th class="dashboard-cell-${bucket.tone}" scope="col">${sortButton(`${bucket.id}.sum`, "Сумма продаж")}</th>`).join("")}
    </tr>`;
}

function tableColumns(meta) {
  return [
    { width: 150 },
    ...(meta.secondary ? [{ width: 150 }] : []),
    ...BUCKETS.flatMap(() => [
      { width: 74, className: "dashboard-count-col" },
      { width: 150 },
      { width: 160 },
    ]),
  ];
}

function tableColgroup(meta) {
  return `<colgroup>${tableColumns(meta)
    .map((column) => `<col${column.className ? ` class="${column.className}"` : ""} style="width: ${column.width}px" />`)
    .join("")}</colgroup>`;
}

function tableMinWidth(meta) {
  return tableColumns(meta).reduce((total, column) => total + column.width, 0);
}

function statsCells(stats) {
  return BUCKETS.map((bucket) => {
    const value = stats[bucket.id];
    return `
      <td class="dashboard-cell-${bucket.tone} dashboard-group-start dashboard-count-cell">${value.count}</td>
      <td class="dashboard-cell-${bucket.tone} dashboard-money">${escapeHtml(money(average(value)))}</td>
      <td class="dashboard-cell-${bucket.tone} dashboard-money">${escapeHtml(money(value.sum))}</td>`;
  }).join("");
}

function renderTable(rows, totalStats) {
  const meta = VIEW_META[activeView];
  tableTitle.textContent = meta.title;
  tableSubtitle.textContent = `${meta.subtitle} Сортировка: ${sortLabel(sortState.field)} ${sortState.direction === "asc" ? "по возрастанию" : "по убыванию"}.`;
  viewButtons.forEach((button) => {
    const active = button.dataset.dashboardView === activeView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (!rows.length) {
    tableWrap.innerHTML = '<div class="dashboard-empty">В выбранной выборке нет сделок.</div>';
    return;
  }

  const rowMarkup = sortRows(rows)
    .map(
      (row) => `
        <tr>
          <th scope="row">${escapeHtml(row.primary)}</th>
          ${meta.secondary ? `<td>${escapeHtml(row.secondary)}</td>` : ""}
          ${statsCells(row.stats)}
        </tr>`,
    )
    .join("");
  tableWrap.innerHTML = `
    <table class="dashboard-table" style="min-width: ${tableMinWidth(meta)}px">
      ${tableColgroup(meta)}
      <thead>${metricHeaders()}</thead>
      <tbody>${rowMarkup}</tbody>
      <tfoot>
        <tr>
          <th scope="row">Итого</th>
          ${meta.secondary ? "<td>Все источники</td>" : ""}
          ${statsCells(totalStats)}
        </tr>
      </tfoot>
    </table>`;
}

function render() {
  if (!validatePeriod()) {
    const empty = emptyStats();
    renderKpis(empty);
    renderSourceSummary([]);
    renderTable([], empty);
    return;
  }
  const visibleRecords = filteredRecords();
  const totalStats = buildTotal(visibleRecords);
  const rows = groupRows(visibleRecords, activeView);
  const sourceRows = groupRows(visibleRecords, "source");
  renderKpis(totalStats);
  renderSourceSummary(sourceRows);
  renderTable(rows, totalStats);
  setStatus(`В выборке: ${visibleRecords.length}. Период: ${periodLabel()}.`);
}

function setCurrentMonth() {
  const range = currentMonthRange();
  dateFromInput.value = range.from;
  dateToInput.value = range.to;
  render();
}

function setAllPeriod() {
  dateFromInput.value = "";
  dateToInput.value = "";
  render();
}

async function loadRecords(successMessage = "") {
  setStatus("Загружаю статистику...");
  reloadButton.disabled = true;
  downloadCsvButton.disabled = true;
  try {
    records = await window.ContractRegistry.loadRegistry({ cache: false });
    renderFilterOptions();
    render();
    if (successMessage) setStatus(successMessage, "success");
  } catch (error) {
    records = [];
    renderFilterOptions();
    render();
    setStatus(error.message || "Не удалось загрузить статистику.", "error");
  } finally {
    reloadButton.disabled = false;
    downloadCsvButton.disabled = false;
  }
}

function rowsForExport() {
  const visibleRecords = filteredRecords();
  const rows = sortRows(groupRows(visibleRecords, activeView));
  const total = { primary: "Итого", secondary: activeView === "managerSource" ? "Все источники" : "", stats: buildTotal(visibleRecords) };
  return [...rows, total];
}

function downloadCsv() {
  if (!validatePeriod()) return;
  const headers = [
    "Разрез",
    "Менеджер",
    "Источник",
    "Закрытые сделки",
    "Закрытые средний чек",
    "Закрытые сумма продаж",
    "Закрытые + в работе сделки",
    "Закрытые + в работе средний чек",
    "Закрытые + в работе сумма продаж",
    "Планируемые сделки",
    "Планируемые средний чек",
    "Планируемые сумма продаж",
  ];
  const lines = [headers.map(csvCell).join(";")];
  rowsForExport().forEach((row) => {
    const manager = activeView === "source" ? "" : row.primary;
    const source = activeView === "source" ? row.primary : row.secondary;
    const values = [
      VIEW_META[activeView].title,
      manager,
      source,
      row.stats.closed.count,
      numberForCsv(average(row.stats.closed)),
      numberForCsv(row.stats.closed.sum),
      row.stats.closedActive.count,
      numberForCsv(average(row.stats.closedActive)),
      numberForCsv(row.stats.closedActive.sum),
      row.stats.planned.count,
      numberForCsv(average(row.stats.planned)),
      numberForCsv(row.stats.planned.sum),
    ];
    lines.push(values.map(csvCell).join(";"));
  });
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dashboard-${activeView}-${dateFromInput.value || "all"}-${dateToInput.value || "all"}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

applyPeriodButton.addEventListener("click", render);
currentMonthButton.addEventListener("click", setCurrentMonth);
allPeriodButton.addEventListener("click", setAllPeriod);
reloadButton.addEventListener("click", () => loadRecords("Статистика обновлена."));
downloadCsvButton.addEventListener("click", downloadCsv);
managerFilter.addEventListener("change", render);
sourceFilter.addEventListener("change", render);
tableWrap.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dashboard-sort]");
  if (!button) return;
  const field = button.dataset.dashboardSort;
  if (sortState.field === field) {
    sortState = { field, direction: sortState.direction === "asc" ? "desc" : "asc" };
  } else {
    sortState = { field, direction: field === "primary" || field === "secondary" ? "asc" : "desc" };
  }
  render();
});
viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeView = button.dataset.dashboardView;
    if (!VIEW_META[activeView].secondary && sortState.field === "secondary") {
      sortState = { field: "closedActive.sum", direction: "desc" };
    }
    render();
  });
});

async function initDashboard() {
  await window.ManagerAuth.ready;
  if (!window.ManagerAuth.isAdmin) {
    window.location.replace("index.html");
    return;
  }
  setCurrentMonth();
  await loadRecords();
}

initDashboard();
