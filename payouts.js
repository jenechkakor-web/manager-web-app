(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = value => new Intl.NumberFormat('ru-RU', { style:'currency', currency:'RUB' }).format(value);
  const date = value => value ? value.split('-').reverse().join('.') : 'Дата не зафиксирована';
  const currentMonth = () => new Intl.DateTimeFormat('sv-SE', { timeZone:'Europe/Moscow' }).format(new Date()).slice(0, 7);
  let report, requestNumber = 0, operationKind, requestId, saving = false, operationsTable;
  let appliedQuery = '';
  async function api(query = '', options = {}) {
    const response = await fetch(`/api/payouts${query}`, { cache:'no-store', ...options });
    if (response.status === 401) { window.location.href = 'login.html?next=%2Fpayouts.html'; throw new Error('Требуется вход.'); }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(result?.error || 'Не удалось загрузить реестр выплат.');
    return result;
  }
  function render(data) {
    const admin = window.ManagerAuth.isAdmin;
    const visibleEntries = data.entries.filter(entry => (entry.kind === 'deal' && entry.eligible && entry.accrued > 0) || entry.kind === 'accrual' || entry.kind === 'payment');
    $('periodTitle').textContent = data.from || data.to ? `Период: ${data.from ? date(data.from) : 'с начала'} — ${data.to ? date(data.to) : 'по сегодня'}` : 'За весь период';
    $('entryCount').textContent = `Сделок с бонусом: ${visibleEntries.filter(entry => entry.kind === 'deal').length} · Операций: ${visibleEntries.filter(entry => entry.kind !== 'deal').length}`;
    const cards = [
      ['Выручка за период',data.totals.revenue,'','Сделки в работе и завершённые по дате договора'],
      ['Планируемые за период',data.totals.planned,'','Сумма планируемых сделок по дате договора'],
      ['Начислено за период',data.totals.accrued,'accrued','По сделкам и дополнительные бонусы'],
      ['Выплачено за период',data.totals.paid,'paid','По дате выплаты'],
      ['Осталось к выплате · всё время',data.allTime.balance,'balance',data.allTime.balance < 0 ? 'Отрицательный остаток — выплачено авансом' : 'Все начисления минус все выплаты'],
    ];
    $('cards').innerHTML = cards.map(([label,value,tone,note]) => `<article class="payout-card ${tone}"><span>${label}</span><strong>${money(value)}</strong><small>${note}</small></article>`).join('');
    $('balances').innerHTML = `<span>Остаток на начало периода: <b>${money(data.openingBalance)}</b></span><span>Начислено − выплачено за период: <b>${money(data.totals.balance)}</b></span><span>Остаток на конец периода: <b>${money(data.closingBalance)}</b></span>`;
    $('undatedNote').hidden = data.undatedAccrued === 0;
    $('undatedNote').textContent = `Бонусы старых сделок на ${money(data.undatedAccrued)} не имеют даты выполнения условий. Они включены в остаток за всё время, но не распределены по месяцам и не входят в остатки выбранного периода.`;
    $('managerRows').innerHTML = admin ? data.managerTotals.map(row => `<tr><td>${escape(row.login)}</td><td class="amount">${money(row.revenue)}</td><td class="amount">${money(row.planned)}</td><td class="amount credit">${money(row.accrued)}</td><td class="amount debit">${money(row.paid)}</td><td class="amount">${money(row.allTimeBalance)}</td></tr>`).join('') : '';
    operationsTable ||= window.createPayoutTable($('operationsTable'), window.ManagerAuth);
    operationsTable.render(visibleEntries);
    const selected = $('managerFilter').value;
    const options = data.managers.map(user => `<option value="${user.id}">${escape(user.login)}</option>`).join('');
    $('managerFilter').innerHTML = `<option value="">Все менеджеры</option>${options}`;
    $('managerFilter').value = selected;
    $('report').hidden = false;
  }
  async function load(query = appliedQuery) {
    const current = ++requestNumber;
    $('status').textContent = 'Загружаю реестр…';
    try {
      const data = await api(query);
      if (current !== requestNumber) return;
      report = data;
      appliedQuery = query;
      render(data);
      $('status').textContent = 'Реестр обновлён.';
      return true;
    } catch (error) {
      if (current !== requestNumber) return;
      $('report').hidden = true;
      $('status').textContent = error.message;
      return false;
    }
  }
  $('month').addEventListener('input', () => { $('dateFrom').value = ''; $('dateTo').value = ''; });
  for (const id of ['dateFrom','dateTo']) $(id).addEventListener('input', () => { $('month').value = ''; });
  $('filters').addEventListener('submit', event => {
    event.preventDefault();
    if ($('dateFrom').value && $('dateTo').value && $('dateFrom').value > $('dateTo').value) { $('status').textContent = 'Дата начала не может быть позже даты окончания.'; return; }
    const query = new URLSearchParams();
    for (const [id,key] of [['month','month'],['dateFrom','from'],['dateTo','to'],['managerFilter','manager']]) if ($(id).value) query.set(key,$(id).value);
    void load(`?${query}`);
  });
  $('resetFilters').addEventListener('click', () => { $('filters').reset(); void load(''); });
  $('refresh').addEventListener('click', () => void load());
  function open(kind) {
    if (!window.ManagerAuth.isAdmin || !report) return;
    operationKind = kind;
    requestId = crypto.randomUUID();
    $('entryForm').reset();
    $('entryManager').innerHTML = '<option value="">Выберите менеджера</option>' + report.managers.map(user => `<option value="${user.id}">${escape(user.login)}</option>`).join('');
    $('entryManager').value = $('managerFilter').value;
    $('entryReason').innerHTML = '<option value="">Выберите причину</option>' + report.reasons.map(reason => `<option>${escape(reason)}</option>`).join('');
    $('reasonLabel').hidden = kind !== 'accrual';
    $('entryReason').required = kind === 'accrual';
    $('entryReason').disabled = kind !== 'accrual';
    $('dialogTitle').textContent = kind === 'payment' ? 'Добавить выплату' : 'Начислить бонус';
    $('operationDate').textContent = `Дата при сохранении — текущий день по Москве (сейчас ${date(new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Moscow'}).format(new Date()))}).`;
    $('paymentHint').textContent = kind === 'payment' ? 'Выплата уменьшит общий остаток менеджера. Если выплачено больше начисленного, остаток станет отрицательным — это аванс.' : 'Начисление прибавится к бонусам менеджера.';
    $('formError').textContent = '';
    $('entryDialog').showModal();
  }
  $('addPayment').addEventListener('click', () => open('payment'));
  $('addAccrual').addEventListener('click', () => open('accrual'));
  for (const id of ['closeDialog','cancelEntry']) $(id).addEventListener('click', () => { if (!saving) $('entryDialog').close(); });
  $('entryDialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  $('entryForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !$('entryForm').reportValidity()) return;
    saving = true;
    $('formError').textContent = '';
    const body = { requestId, kind:operationKind, managerId:Number($('entryManager').value), amount:$('entryAmount').value, reason:$('entryReason').value };
    const controls = [...$('entryForm').querySelectorAll('button,input,select')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
      await api('', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      $('entryDialog').close();
      const loaded = await load();
      $('status').textContent = loaded
        ? 'Операция сохранена. Для просмотра сегодняшних операций выберите текущий месяц или весь период.'
        : 'Операция сохранена, но обновить свод не удалось. Нажмите «Обновить».';
    } catch(error) { $('formError').textContent = error.message; }
    finally { saving = false; controls.forEach((control,index) => { control.disabled = disabled[index]; }); }
  });
  window.ManagerAuth.ready.then(() => {
    const month = currentMonth();
    $('month').value = month;
    return load(`?month=${encodeURIComponent(month)}`);
  });
})();
