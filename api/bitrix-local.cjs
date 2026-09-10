const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const rules = require('./bitrix-rules.json');
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const label = value => String(value || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru').replaceAll('ё', 'е');
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const id = value => /^[1-9]\d{0,17}$/.test(text(value)) ? text(value) : '';
const money = value => {
  const raw = text(value).split('|')[0].replace(/[\s\u00a0]/gu, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw fail('Б24: некорректная денежная сумма.');
  const result = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(result) || result > 9999999999999.99) throw fail('Б24: сумма вне допустимого диапазона.');
  return result;
};

function stageStatus(name) {
  return Object.entries(rules.stages).find(([, names]) => names.some(item => label(item) === label(name)))?.[0] || '';
}

function resolveManager(creator, users, config) {
  const fullName = label(`${text(creator.NAME)} ${text(creator.LAST_NAME)}`);
  const allowedName = rules.managers.find(name => label(name) === fullName);
  if (!allowedName) return null;
  const binding = config.managers?.[allowedName];
  const login = typeof binding === 'string' ? binding : binding?.login;
  if (binding?.bitrixId && text(binding.bitrixId) !== id(creator.ID)) return null;
  const matches = users.filter(user => login ? label(user.login) === label(login) : label(user.fullName) === fullName);
  return matches.length === 1 ? matches[0] : null;
}

function endpoint(config) {
  let url;
  try { url = new URL(config.webhookUrl); } catch { throw fail('Подключение Б24 не настроено.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !/\/rest\/[1-9]\d*\/[A-Za-z0-9_-]+\/$/.test(url.pathname)) {
    throw fail('Б24: требуется HTTPS-адрес входящего вебхука /rest/ID/TOKEN/.', 503);
  }
  return url;
}

function authenticate(body, config) {
  const url = endpoint(config);
  const expected = text(config.eventToken);
  if (!expected) throw fail('Токен исходящего вебхука Б24 не настроен.', 503);
  const actual = text(body.auth?.application_token);
  const equal = crypto.timingSafeEqual(crypto.createHash('sha256').update(actual).digest(), crypto.createHash('sha256').update(expected).digest());
  if (!equal || label(body.auth?.domain) !== url.hostname.toLowerCase()
      || (config.memberId && text(body.auth?.member_id) !== text(config.memberId))) throw fail('Недействительная подпись события Б24.', 403);
  if (!['ONCRMDEALADD', 'ONCRMDEALUPDATE'].includes(body.event)) return null;
  const dealId = id(body.data?.FIELDS?.ID);
  if (!dealId) throw fail('Б24: некорректный ID сделки.', 400);
  return dealId;
}

async function readEvent(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw fail('Слишком большое событие Б24.', 413);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type === 'application/json') {
    try {
      const body = JSON.parse(raw);
      if (body && typeof body === 'object' && !Array.isArray(body)) return body;
    } catch {}
    throw fail('Некорректный JSON события Б24.', 400);
  }
  if (type !== 'application/x-www-form-urlencoded') throw fail('Неподдерживаемый формат события Б24.', 415);
  const form = new URLSearchParams(raw);
  return { event: form.get('event'), data: { FIELDS: { ID: form.get('data[FIELDS][ID]') } },
    auth: { application_token: form.get('auth[application_token]'), domain: form.get('auth[domain]'), member_id: form.get('auth[member_id]') } };
}

function createClient(config, fetcher = fetch) {
  const base = endpoint(config);
  return async (method, params) => {
    let response, result;
    try {
      response = await fetcher(new URL(`${method}.json`, base), { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(12000) });
      result = await response.json();
    } catch { throw fail('Б24 временно недоступен. Повторите синхронизацию.'); }
    if (!response.ok || !result || result.error || !Object.hasOwn(result, 'result')) {
      // Never return or log remote error descriptions, URLs or credentials.
      throw fail(`Б24: не удалось выполнить ${method}. Проверьте права вебхука.`);
    }
    return result.result;
  };
}

async function fetchSnapshot(dealId, config, call) {
  const deal = await call('crm.deal.get', { id: dealId });
  if (id(deal?.ID) !== dealId || !id(deal.CREATED_BY_ID)) throw fail('Б24: неполная карточка сделки.');
  const creators = await call('user.get', { ID: deal.CREATED_BY_ID });
  const creator = Array.isArray(creators) ? creators.find(user => id(user.ID) === id(deal.CREATED_BY_ID)) : null;
  if (!creator) throw fail('Б24: создатель сделки недоступен.');
  const category = text(deal.CATEGORY_ID || '0');
  if (!/^\d+$/.test(category)) throw fail('Б24: некорректная воронка.');
  const stages = await call('crm.status.list', { filter: { ENTITY_ID: category === '0' ? 'DEAL_STAGE' : `DEAL_STAGE_${category}`, STATUS_ID: deal.STAGE_ID } });
  const stage = Array.isArray(stages) ? stages.find(item => item.STATUS_ID === deal.STAGE_ID) : null;
  if (!stage) throw fail('Б24: стадия сделки недоступна.');
  let source = '';
  if (text(deal.SOURCE_ID)) {
    const sources = await call('crm.status.list', { filter: { ENTITY_ID: 'SOURCE', STATUS_ID: deal.SOURCE_ID } });
    const entry = Array.isArray(sources) ? sources.find(item => item.STATUS_ID === deal.SOURCE_ID) : null;
    if (!entry) throw fail('Б24: источник сделки недоступен.');
    source = text(entry.NAME);
  }
  return { deal, creator, stageName: text(stage.NAME), source };
}

function mapSnapshot(snapshot, config, users, previous = null) {
  const { deal, creator, stageName, source } = snapshot;
  const manager = resolveManager(creator, users, config);
  if (!manager) return { skipped: 'manager_not_allowed_or_unmapped' };
  const status = stageStatus(stageName);
  // Unknown stages remain visible but never complete/accrue a bonus.
  const dealStatus = status || 'Планируется';
  const currency = text(deal.CURRENCY_ID);
  if (currency !== 'RUB' && currency !== 'RUR') throw fail('Б24: реестр поддерживает только суммы в рублях.', 409);
  const amount = money(deal.OPPORTUNITY);
  const date = text(deal.DATE_CREATE).slice(0, 10);
  const modifiedAt = text(deal.DATE_MODIFY);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(modifiedAt))) throw fail('Б24: некорректная дата сделки.');
  let paid = 0;
  if (config.paidAmountField) {
    if (!Object.hasOwn(deal, config.paidAmountField)) throw fail('Б24: поле фактической оплаты отсутствует.');
    const value = deal[config.paidAmountField];
    paid = value === '' || value === null ? 0 : money(value);
  }
  if (config.fullPaymentField) {
    if (!Object.hasOwn(deal, config.fullPaymentField)) throw fail('Б24: поле полной оплаты отсутствует.');
    const values = config.fullPaymentValues || ['Y', '1', 'Да'];
    if (values.some(value => text(value) === text(deal[config.fullPaymentField]))) paid = amount;
  }
  paid = Math.min(amount, paid);
  const number = text(config.numberField ? deal[config.numberField] : deal.ID);
  if (!number || number.length > 191) throw fail('Б24: номер сделки отсутствует или слишком длинный.');
  const registryMeta = { ...(previous?.registryMeta || {}), title: text(deal.TITLE),
    source: text(config.sourceMap?.[deal.SOURCE_ID] || source),
    paymentStatus: dealStatus === 'Планируется' ? 'Планируется' : (amount > 0 && paid >= amount ? 'Да' : paid > 0 ? 'Предоплата' : 'Планируется'),
    prepayment: paid, prepaymentOverridden: true,
    bitrix: { dealId: id(deal.ID), domain: endpoint(config).hostname, creatorId: id(deal.CREATED_BY_ID),
      stageId: text(deal.STAGE_ID), stageName, dealStatus, unmappedStage: !status, modifiedAt, number,
      paymentConfigured: Boolean(config.paidAmountField || config.fullPaymentField) } };
  return { record: { ...(previous || {}), number: previous?.number || number, ownerId: manager.id, date, amount, registryMeta,
    data: previous?.data || {}, updatedAt: new Date().toISOString() } };
}

function preserveCrmFields(incoming, previous) {
  delete incoming.registryMeta.bitrix;
  if (!previous?.registryMeta?.bitrix) return incoming;
  for (const key of ['number', 'date', 'amount', 'ownerId']) incoming[key] = previous[key];
  for (const key of ['title', 'source', 'paymentStatus', 'prepayment', 'prepaymentOverridden', 'bitrix']) incoming.registryMeta[key] = previous.registryMeta[key];
  return incoming;
}

async function loadConfig() {
  if (!process.env.BITRIX_CONFIG_FILE) return {};
  try { return JSON.parse(await fs.readFile(process.env.BITRIX_CONFIG_FILE, 'utf8')); }
  catch { throw fail('Не удалось прочитать закрытую конфигурацию Б24.', 503); }
}

function configurationStatus(config, users) {
  let configured = false;
  try { endpoint(config); configured = Boolean(text(config.eventToken)); } catch {}
  return { configured, paymentConfigured: Boolean(config.paidAmountField || config.fullPaymentField),
    managers: rules.managers.map(name => {
      const binding = config.managers?.[name];
      const configuredLogin = typeof binding === 'string' ? binding : binding?.login;
      const matches = users.filter(user => configuredLogin ? label(user.login) === label(configuredLogin) : label(user.fullName) === label(name));
      return { name, login: matches.length === 1 ? matches[0].login : '', linked: matches.length === 1 };
    }) };
}

module.exports = { rules, stageStatus, resolveManager, authenticate, readEvent, createClient, fetchSnapshot,
  mapSnapshot, preserveCrmFields, loadConfig, configurationStatus, endpoint, id };
