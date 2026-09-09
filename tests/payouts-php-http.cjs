// Isolated CI MySQL database + temporary PHP document root. No production credentials.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const crypto = require('node:crypto');
(async () => {
  assert.equal(process.env.PAYOUT_TEST_MYSQL,'1');
  const root=path.resolve(__dirname,'..');
  await fs.mkdir(path.join(root,'.data'),{recursive:true});
  const dir=await fs.mkdtemp(path.join(root,'.data','payout-php-test-'));
  await fs.cp(path.join(root,'api'),path.join(dir,'api'),{recursive:true});
  await fs.writeFile(path.join(dir,'api','config.local.php'), `<?php return ['db_host'=>'127.0.0.1','db_name'=>'manager_payout_test','db_user'=>'root','db_password'=>'isolated-test-only','admin_login'=>'admin','admin_password'=>'TestPassword2026'];`);
  const child=spawn('php',['-S','127.0.0.1:4199',path.join(__dirname,'payouts-php-router.php')],{cwd:dir,stdio:['ignore','pipe','pipe']});
  const base='http://127.0.0.1:4199';
  let logs='';child.stderr.on('data',chunk=>{logs+=chunk;});
  try {
    for(let attempt=0;attempt<50;attempt++) {try {if((await fetch(`${base}/api/health`)).ok) break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    async function login(login) {const r=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password:'TestPassword2026'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
    const admin=await login('admin'), manager=await login('manager');
    const post=(route,body,cookie=admin,headers={})=>fetch(`${base}/api/${route}`,{method:'POST',headers:{cookie,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    const get=(route,cookie=admin)=>fetch(`${base}/api/${route}`,{headers:{cookie}});
    const initial=await (await get('contracts-registry')).json();
    const entry={requestId:crypto.randomUUID(),kind:'accrual',managerId:2,amount:'100.10',reason:'оклад',date:'1999-01-01'};
    assert.equal((await fetch(`${base}/api/payouts`)).status,401);
    assert.equal((await post('payouts',entry,manager)).status,403);
    assert.equal((await post('payouts',entry,admin,{Origin:'https://example.com'})).status,403);
    for(const patch of [{amount:-1},{amount:0},{amount:'1.001'},{managerId:999},{reason:'invalid'}]) assert.equal((await post('payouts',{...entry,...patch})).status,400);
    const duplicate=await Promise.all([post('payouts',entry),post('payouts',entry)]);
    assert(duplicate.every(r=>r.status===200));
    assert.equal((await post('payouts',{...entry,amount:'200'})).status,409);
    const payments=await Promise.all(Array.from({length:6},()=>post('payouts',{requestId:crypto.randomUUID(),kind:'payment',managerId:2,amount:'10.01'})));
    assert(payments.every(r=>r.status===200));
    const own=await (await get('payouts?manager=1',manager)).json();
    assert.equal(own.entries.length,7);
    assert(own.entries.every(row=>row.managerId===2));
    assert.equal(own.allTime.balance,40.04);
    assert(own.entries.every(row=>row.date!==entry.date));
    assert.deepEqual(await (await get('contracts-registry')).json(),initial,'Payments must not change existing contracts');
    const fields={closingDocs:'Не отправлены'};
    assert.equal((await post('contracts-registry',{action:'update-meta',number:'EXISTING',fields},manager)).status,403);
    assert.equal((await post('contracts-registry',{action:'update-meta',number:'EXISTING',fields})).status,200);
    fields.closingDocs='Отправлены';
    assert.equal((await post('contracts-registry',{action:'update-meta',number:'EXISTING',fields})).status,200);
    const qualified=await (await get('payouts')).json();
    const deal=qualified.entries.find(row=>row.kind==='deal');
    assert.equal(deal.date,qualified.today);
    assert.equal(deal.accrued,1200);
    assert.equal(deal.dealAmount,10000);
    const record=await (await get('contracts-registry?number=EXISTING')).json();
    record.counterparty='Updated in isolated test';
    assert.equal((await post('contracts-registry',{record})).status,200);
    assert.equal((await (await get('payouts')).json()).entries.find(row=>row.kind==='deal').date,deal.date);
    assert.equal((await get('payouts?from=2026-02-30')).status,400);
    assert.equal((await fetch(`${base}/api/payouts`,{method:'DELETE',headers:{cookie:admin}})).status,405);
    console.log('PHP HTTP: authentication, ownership, ledger idempotence, dates, preservation passed');
  } catch(error) { console.error(logs); throw error; }
  finally {const exited=once(child,'exit');child.kill();await exited;}
})().catch(error=>{console.error(error);process.exitCode=1;});
