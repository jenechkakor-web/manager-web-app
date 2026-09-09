const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { buildReport, bonusCents, stampQualification, today } = require('../api/payouts-local.cjs');
const admin = { id:1, login:'admin', role:'admin' };
const manager = { id:2, login:'manager', role:'user' };
const other = { id:3, login:'other', role:'user' };
const users = [admin, manager, other];
const record = (patch = {}) => ({ number:'A1', ownerId:2, date:'2026-06-15', amount:10000,
  registryMeta:{ title:'Тест', paymentStatus:'Да', prepayment:10000, closingDocs:'Отправлены', bonusType:'12%', bonusAmount:250 },
  bonusQualifiedAt:'2026-07-10T10:00:00Z', ...patch });

test('начисляется только полная оплата с отправленными закрывашками', () => {
  assert.equal(bonusCents(record()),120000);
  for (const patch of [{ closingDocs:'Не нужно' },{closingDocs:'Не отправлены'}, {paymentStatus:'Предоплата'}, {prepayment:9999.99}]) {
    assert.equal(bonusCents(record({registryMeta:{...record().registryMeta,...patch}})),0);
  }
  assert.equal(bonusCents(record({registryMeta:{...record().registryMeta,bonusType:'оклад'}})),0);
  assert.equal(bonusCents(record({registryMeta:{...record().registryMeta,bonusType:'от прибыли'}})),25000);
});

test('фильтры, даты начисления, перенос остатка и изоляция по владельцу', () => {
  const rows = [record(), record({number:'B',ownerId:3,amount:999999}),record({number:'OLD',bonusQualifiedAt:''})];
  const ledger = [{id:'p',kind:'payment',date:'2026-08-02',managerId:2,amountCents:40000},
    {id:'a',kind:'accrual',date:'2026-08-01',managerId:2,amountCents:10000}];
  const august = buildReport(rows,users,ledger,manager,new URLSearchParams('month=2026-08&manager=3'));
  assert.equal(august.totals.revenue,0);
  assert.equal(august.totals.accrued,100);
  assert.equal(august.totals.paid,400);
  assert.equal(august.openingBalance,1200);
  assert.equal(august.closingBalance,900);
  assert.equal(august.allTime.balance,2100);
  assert.equal(august.undatedAccrued,1200);
  assert(august.entries.every(row=>row.managerId===2));
  assert.deepEqual(august.managers,[{id:2,login:'manager'}]);
  const june = buildReport(rows,users,ledger,manager,new URLSearchParams('month=2026-06'));
  assert.equal(june.totals.revenue,20000);
  assert.equal(june.totals.accrued,0);
  const july = buildReport(rows,users,ledger,manager,new URLSearchParams('from=2026-07-10&to=2026-07-10'));
  assert.equal(july.totals.accrued,1200);
  assert.throws(()=>buildReport(rows,users,ledger,admin,new URLSearchParams('from=2026-02-30')));
  assert.throws(()=>buildReport(rows,users,ledger,admin,new URLSearchParams('from=2026-09-09&to=2026-08-01')));
});

test('планируемые отдельно от выручки, с датами и владельцами', () => {
  const planned = record({number:'PLAN',registryMeta:{...record().registryMeta,paymentStatus:'Планируется'}});
  const active = record({number:'ACTIVE',registryMeta:{...record().registryMeta,paymentStatus:'Предоплата',prepayment:100}});
  const rows = [record(),planned,active,record({number:'OTHER',ownerId:3})];
  const report = buildReport(rows,users,[],manager,new URLSearchParams('month=2026-06&manager=3'));
  assert.equal(report.totals.revenue,20000);
  assert.equal(report.totals.planned,10000);
  assert.equal(report.managerTotals[0].planned,10000);
  assert.equal(report.entries.find(e=>e.id==='sale:PLAN').planned,10000);
  assert.equal(report.allTime.accrued,1200);
  assert.equal(buildReport(rows,users,[],admin,new URLSearchParams('manager=3')).totals.planned,0);
  assert.equal(buildReport(rows,users,[],manager,new URLSearchParams('from=2026-07-01')).totals.planned,0);
});

test('дата условий сохраняется и меняется только при новом выполнении условий', () => {
  const pending = record({registryMeta:{...record().registryMeta,closingDocs:'Не отправлены'}});
  const qualified = stampQualification(record(),pending);
  assert.equal(qualified.bonusQualifiedAt.slice(0,10),new Date().toISOString().slice(0,10));
  const later = stampQualification(record(),qualified);
  assert.equal(later.bonusQualifiedAt,qualified.bonusQualifiedAt);
  assert.equal(stampQualification(pending,qualified).bonusQualifiedAt,'');
  assert.equal(stampQualification(record(),record({bonusQualifiedAt:''})).bonusQualifiedAt,'');
});

test('HTTP: права, валидация, идемпотентность, параллельные выплаты и сохранность договоров', async t => {
  const root = path.resolve(__dirname,'..');
  await fs.mkdir(path.join(root,'.data'),{recursive:true});
  const directory = await fs.mkdtemp(path.join(root,'.data','payout-test-'));
  const password = 'TestPassword2026';
  const localUsers = users.map(user=>{const salt=crypto.randomBytes(16).toString('hex');return {...user,passwordHash:`${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`};});
  await fs.writeFile(path.join(directory,'users.json'),JSON.stringify(localUsers));
  await fs.writeFile(path.join(directory,'tech-presets.json'),'[]');
  const contracts = [record(),record({number:'B',ownerId:3})];
  const contractsFile = path.join(directory,'contracts-registry.json');
  await fs.writeFile(contractsFile,JSON.stringify(contracts));
  const initial = await fs.readFile(contractsFile,'utf8');
  const child = spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'0',MANAGER_DATA_DIR:directory},windowsHide:true});
  t.after(async()=>{const exited=once(child,'exit');child.kill();await exited;});
  const base = await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server start timeout')),10000);
    child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127.0.0.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
    child.on('error',reject);
  });
  async function login(login) { const r=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]; }
  const adminCookie=await login('admin');
  const managerCookie=await login('manager');
  async function post(body,cookie=adminCookie,extraHeaders={}) { return fetch(`${base}/api/payouts`,{method:'POST',headers:{cookie,'Content-Type':'application/json',...extraHeaders},body:JSON.stringify(body)}); }
  const entry = {requestId:crypto.randomUUID(),kind:'accrual',managerId:2,amount:'100.10',reason:'оклад',date:'1999-01-01'};
  assert.equal((await fetch(`${base}/api/payouts`)).status,401);
  assert.equal((await post(entry,managerCookie)).status,403);
  assert.equal((await post(entry,adminCookie,{Origin:'https://example.com'})).status,403);
  for(const patch of [{amount:-1},{amount:0},{amount:'1.001'},{amount:'NaN'},{managerId:99},{reason:'invalid'}]) {
    assert.equal((await post({...entry,...patch})).status,400);
  }
  const repetitions=await Promise.all([post(entry),post(entry)]);
  assert(repetitions.every(r=>r.status===200));
  assert.equal((await post({...entry,amount:'200'})).status,409);
  const payments=await Promise.all(Array.from({length:6},()=>post({requestId:crypto.randomUUID(),kind:'payment',managerId:2,amount:'10.01'})));
  assert(payments.every(r=>r.status===200));
  const ledger=JSON.parse(await fs.readFile(path.join(directory,'bonus-ledger.json'),'utf8'));
  assert.equal(ledger.length,7);
  assert(ledger.every(e=>e.date===today() && e.createdBy===1));
  assert.equal((await fs.readdir(path.join(directory,'payout-backups'))).length,7);
  assert.equal(await fs.readFile(contractsFile,'utf8'),initial);
  const r=await fetch(`${base}/api/payouts?manager=3`,{headers:{cookie:managerCookie}});
  const report=await r.json();
  assert(report.entries.every(e=>e.managerId===2));
  assert.equal(report.totals.accrued,1300.10);
  assert.equal(report.totals.paid,60.06);
  assert.equal(report.allTime.balance,1240.04);
  assert.equal((await fetch(`${base}/.data/bonus-ledger.json`)).status,403);
  const unchanged=record({number:'PENDING',registryMeta:{...record().registryMeta,closingDocs:'Не отправлены'},bonusQualifiedAt:''});
  await fs.writeFile(contractsFile,JSON.stringify([unchanged]));
  const update=await fetch(`${base}/api/contracts-registry`,{method:'POST',headers:{cookie:managerCookie,'Content-Type':'application/json'},body:JSON.stringify({action:'update-meta',number:'PENDING',fields:{closingDocs:'Отправлены'}})});
  assert.equal(update.status,200);
  const saved=JSON.parse(await fs.readFile(contractsFile,'utf8'))[0];
  assert(saved.bonusQualifiedAt);
  assert.equal(bonusCents(saved),120000);
});
