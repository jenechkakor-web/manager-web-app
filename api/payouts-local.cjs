const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const REASONS = ['оклад', 'выполнение плана', 'отзывы', 'бонус от руководителя', 'другое'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cents = value => Math.round((Number(value) + Number.EPSILON) * 100);
const rubles = value => value / 100;
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isEligible(record) {
  return Boolean(record && record.registryMeta.paymentStatus === 'Да' && record.registryMeta.closingDocs === 'Отправлены'
    && cents(record.registryMeta.prepayment) >= cents(record.amount));
}

function stampQualification(record, previous) {
  record.bonusQualifiedAt = isEligible(record)
    ? (isEligible(previous) ? previous.bonusQualifiedAt || '' : new Date().toISOString()) : '';
  return record;
}

function bonusCents(record) {
  const meta = record.registryMeta;
  if (meta.paymentStatus !== 'Да' || meta.closingDocs !== 'Отправлены'
      || cents(meta.prepayment) < cents(record.amount)) return 0;
  if (meta.bonusType === 'оклад') return 0;
  if (meta.bonusType === 'от прибыли') return cents(meta.bonusAmount);
  const percent = { '12%': 12, '10%': 10, '7%': 7, '5%': 5, '4%': 4, '3%': 3 }[meta.bonusType] || 0;
  return Math.round(cents(record.amount) * percent / 100);
}

function buildReport(records, users, ledger, user, query) {
  let from = query.get('from') || '';
  let to = query.get('to') || '';
  const month = query.get('month') || '';
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail('Некорректный месяц.');
    from = `${month}-01`;
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    to = date.toISOString().slice(0, 10);
  }
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    throw fail('Проверьте даты начала и окончания периода.');
  }
  const manager = query.get('manager') || '';
  if (manager && (!/^\d+$/.test(manager) || !Number.isSafeInteger(Number(manager)))) throw fail('Некорректный менеджер.');
  // The owner scope comes from the authenticated user, never from the request.
  const owner = user.role === 'admin' ? (manager ? Number(manager) : null) : user.id;
  const inScope = id => owner === null || id === owner;
  const visibleRecords = records.filter(record => inScope(record.ownerId));
  const visibleLedger = ledger.filter(entry => inScope(entry.managerId));
  const names = new Map(users.map(item => [item.id, item.login]));
  const entries = visibleRecords.flatMap(record => {
    const common = { managerId: record.ownerId, manager: names.get(record.ownerId) || 'Удалённый пользователь',
      number: record.number, title: record.registryMeta.title || record.counterparty || 'Без названия' };
    const sale = { ...common, id: `sale:${record.number}`, kind: 'sale', date: record.date,
      reason: 'Сумма сделки', revenue: cents(record.amount), accrued: 0, paid: 0 };
    if (!isEligible(record)) return [sale];
    const accruedDate = record.bonusQualifiedAt
      ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date(record.bonusQualifiedAt)) : '';
    return [sale, {
    id: `deal:${record.number}`, kind: 'deal', date: accruedDate, managerId: record.ownerId,
    manager: names.get(record.ownerId) || 'Удалённый пользователь', number: record.number,
    title: record.registryMeta.title || 'Без названия',
    counterparty: record.counterparty || '', dealAmount: record.amount,
    reason: record.registryMeta.bonusType, revenue: 0,
    accrued: bonusCents(record), paid: 0,
    eligible: record.registryMeta.paymentStatus === 'Да' && record.registryMeta.closingDocs === 'Отправлены'
      && cents(record.registryMeta.prepayment) >= cents(record.amount),
    paymentStatus: record.registryMeta.paymentStatus, closingDocs: record.registryMeta.closingDocs,
  }];
  }).concat(visibleLedger.map(entry => ({
    id: entry.id, kind: entry.kind, date: entry.date, managerId: entry.managerId,
    manager: names.get(entry.managerId) || entry.managerLogin,
    title: entry.kind === 'payment' ? 'Выплата бонусов' : 'Дополнительное начисление',
    reason: entry.reason, revenue: 0, accrued: entry.kind === 'accrual' ? entry.amountCents : 0,
    paid: entry.kind === 'payment' ? entry.amountCents : 0, createdBy: entry.createdByLogin,
  })));
  const sum = rows => rows.reduce((total, entry) => {
    total.revenue += entry.revenue;
    total.accrued += entry.accrued;
    total.paid += entry.paid;
    return total;
  }, { revenue: 0, accrued: 0, paid: 0 });
  const serialize = total => ({ revenue: rubles(total.revenue), accrued: rubles(total.accrued),
    paid: rubles(total.paid), balance: rubles(total.accrued - total.paid) });
  const selected = entries.filter(entry => (!(from || to) || entry.date) && (!from || entry.date >= from) && (!to || entry.date <= to));
  const opening = from ? sum(entries.filter(entry => entry.date && entry.date < from)) : sum([]);
  const period = sum(selected);
  const managerIds = [...new Set([...users.map(item => item.id), ...entries.map(item => item.managerId)])].filter(inScope);
  return {
    today: today(), reasons: REASONS, from, to,
    undatedAccrued: rubles(sum(entries.filter(entry => entry.kind === 'deal' && !entry.date)).accrued),
    managers: (user.role === 'admin' ? users : users.filter(item => item.id === user.id)).map(item => ({ id: item.id, login: item.login })),
    totals: serialize(period), allTime: serialize(sum(entries)),
    openingBalance: rubles(opening.accrued - opening.paid),
    closingBalance: rubles(opening.accrued - opening.paid + period.accrued - period.paid),
    managerTotals: managerIds.map(id => ({ id, login: names.get(id) || 'Удалённый пользователь',
      ...serialize(sum(selected.filter(entry => entry.managerId === id))),
      allTimeBalance: serialize(sum(entries.filter(entry => entry.managerId === id))).balance })),
    entries: selected.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).map(entry => ({
      ...entry, revenue: rubles(entry.revenue), accrued: rubles(entry.accrued), paid: rubles(entry.paid),
    })),
  };
}

function createPayoutStore(dataDir) {
  const file = path.join(dataDir, 'bonus-ledger.json');
  let queue = Promise.resolve();
  async function read() {
    try {
      const entries = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(entries)) throw new Error('Некорректный файл реестра выплат.');
      return entries;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  function append(body, users, admin) {
    const operation = queue.then(async () => {
      if (admin.role !== 'admin') throw fail('Недостаточно прав.', 403);
      if (!['payment', 'accrual'].includes(body.kind)) throw fail('Выберите тип операции.');
      const manager = users.find(item => item.id === Number(body.managerId));
      if (!manager) throw fail('Выберите существующего менеджера.');
      if (!/^[0-9a-f-]{36}$/i.test(body.requestId || '')) throw fail('Некорректный идентификатор операции.');
      const rawAmount = String(body.amount ?? '');
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(rawAmount) || cents(rawAmount) <= 0) throw fail('Укажите положительную сумму с точностью до копеек.');
      if (body.kind === 'accrual' && !REASONS.includes(body.reason)) throw fail('Выберите причину начисления.');
      const entries = await read();
      const existing = entries.find(entry => entry.id === body.requestId);
      const reason = body.kind === 'accrual' ? body.reason : '';
      if (existing) {
        if (existing.kind !== body.kind || existing.managerId !== manager.id || existing.amountCents !== cents(rawAmount) || existing.reason !== reason) {
          throw fail('Эта операция уже сохранена с другими данными. Обновите реестр.', 409);
        }
        return existing;
      }
      const entry = { id: body.requestId, kind: body.kind, managerId: manager.id, managerLogin: manager.login,
        amountCents: cents(rawAmount), reason, date: today(), createdAt: new Date().toISOString(),
        createdBy: admin.id, createdByLogin: admin.login };
      await fs.mkdir(dataDir, { recursive: true });
      const backupDir = path.join(dataDir, 'payout-backups');
      await fs.mkdir(backupDir, { recursive: true });
      const suffix = `${Date.now()}-${crypto.randomUUID()}`;
      // Fail closed if the previous state cannot be backed up.
      await fs.writeFile(path.join(backupDir, `${suffix}.json`), JSON.stringify(entries), { flag: 'wx' });
      const temporary = `${file}.${suffix}.tmp`;
      await fs.writeFile(temporary, JSON.stringify([...entries, entry], null, 2), { flag: 'wx' });
      await fs.rename(temporary, file);
      return entry;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return { read, append };
}

module.exports = { createPayoutStore, buildReport, bonusCents, today, stampQualification, isEligible };
