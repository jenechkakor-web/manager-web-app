const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const bitrix = require('../api/bitrix-local.cjs');
const {stampQualification, bonusCents, buildReport} = require('../api/payouts-local.cjs');
const fixture = require('./bitrix-fixture.json');
const {config,users,snapshot} = fixture;
const event = (dealId='17000') => ({event:'ONCRMDEALADD',auth:{domain:'portal.example',application_token:config.eventToken},data:{FIELDS:{ID:dealId}}});
const mapped = (patch={}, previous) => bitrix.mapSnapshot({...structuredClone(snapshot),...patch},config,users,previous).record;

test('Б24: все стадии, создатель, фактическая оплата и один бонус', () => {
  for(const [status,names] of Object.entries(bitrix.rules.stages)) for(const stageName of names) {
    const record=mapped({stageName});
    record.registryMeta.bonusType='12%';
    assert.equal(record.registryMeta.bitrix.dealStatus,status);
    assert.equal(record.registryMeta.paymentStatus,status==='Планируется'?'Планируется':'Предоплата');
    assert.equal(record.amount,100000);assert.equal(record.registryMeta.prepayment,50000);
    assert.equal(record.ownerId,2);assert.equal(record.number,'17000');assert.equal(record.date,'2026-09-10');
    assert.equal(record.registryMeta.source,'SEO (verkup.ru)');
    assert.equal(bonusCents(record),status==='Завершена'?1200000:0);
  }
  assert.equal(bitrix.stageStatus('  создать Счёт и Договор (М) '),'Планируется');
  for (const value of ['',null,false,'100000.00|RUB']) {
    const paid = mapped({stageName:'ЗАМЕР (пр)',deal:{...snapshot.deal,UF_PAID:value}});
    assert.equal(paid.registryMeta.paymentStatus,'Да');assert.equal(paid.registryMeta.prepayment,100000);
    assert.equal(bonusCents(paid),0);
    const planned = mapped({deal:{...snapshot.deal,UF_PAID:value}});
    assert.equal(planned.registryMeta.paymentStatus,'Планируется');
  }
  const full=mapped({stageName:'В ПРОИЗВОДСТВЕ (пр)',deal:{...snapshot.deal,UF_PAID:'100 000,00|RUB'}});
  full.registryMeta.bonusType='12%'; full.registryMeta.closingDocs='Отправлены';
  assert.equal(full.registryMeta.paymentStatus,'Да');assert.equal(bonusCents(full),0);
  const complete=stampQualification(mapped({stageName:bitrix.rules.stages['Завершена'][0]},full),full);
  const again=stampQualification(mapped({stageName:bitrix.rules.stages['Завершена'][0]},complete),complete);
  assert.equal(again.bonusQualifiedAt,complete.bonusQualifiedAt);
  assert.equal(buildReport([again],users,[],users[1],new URLSearchParams()).allTime.accrued,12000);
  const reopened=stampQualification(mapped({stageName:'ЗАМЕР (пр)'},again),again);
  assert.equal(reopened.bonusQualifiedAt,'');assert.equal(bonusCents(reopened),0);
  const unknown=mapped({stageName:'Неподдерживаемая стадия'},again);
  assert.equal(unknown.registryMeta.bitrix.unmappedStage,true);assert.equal(bonusCents(unknown),0);
});

test('Б24: только восемь имён и единственное существующее ФИО', () => {
  for(const name of bitrix.rules.managers) {
    const [NAME,LAST_NAME]=name.split(' '), user={id:9,login:'linked',fullName:name};
    assert.equal(bitrix.resolveManager({ID:'99',NAME,LAST_NAME},[user],{}).id,9);
  }
  assert.equal(bitrix.resolveManager(snapshot.creator,[],config),null);
  assert.equal(bitrix.resolveManager(snapshot.creator,[users[1],{...users[1],id:7}],config),null);
  assert.equal(bitrix.resolveManager({ID:'999',NAME:'Посторонний',LAST_NAME:'Сотрудник'},users,config),null);
  assert.equal(bitrix.resolveManager(snapshot.creator,users,{...config,managers:{'Антон Исаков':{login:'anton',bitrixId:'999'}}}),null);
});

test('Б24: подпись, домен, ошибки данных и защита полей от подделки', async () => {
  assert.equal(bitrix.authenticate(event(),config),'17000');
  for(const body of [{...event(),auth:{}},{...event(),auth:{...event().auth,domain:'evil.example'}},{...event(),data:{FIELDS:{ID:'../bad'}}}]) assert.throws(()=>bitrix.authenticate(body,config));
  assert.throws(()=>bitrix.authenticate(event(),{...config,eventToken:''}));
  assert.throws(()=>bitrix.endpoint({...config,webhookUrl:'http://portal.example/rest/1/token/'}));
  assert.equal(bitrix.authenticate({...event(),event:'ONCRMDEALDELETE'},config),null);
  for(const patch of [{OPPORTUNITY:'invalid'},{OPPORTUNITY:'-1'},{UF_PAID:'-10'},{CURRENCY_ID:'USD'}]) assert.throws(()=>mapped({deal:{...snapshot.deal,...patch}}));
  assert.throws(()=>bitrix.mapSnapshot(snapshot,{...config,paidAmountField:'MISSING'},users));
  const plain={registryMeta:{bitrix:{dealStatus:'Завершена'}}};
  bitrix.preserveCrmFields(plain,null);assert.equal(plain.registryMeta.bitrix,undefined);
  const original=mapped();const changed=structuredClone(original);changed.amount=999;changed.registryMeta.bitrix.dealStatus='Завершена';
  bitrix.preserveCrmFields(changed,original);assert.equal(changed.amount,100000);assert.equal(changed.registryMeta.bitrix.dealStatus,'Планируется');
  const calls=[];
  const response=await bitrix.fetchSnapshot('17000',config,async (method,params)=>{
    calls.push({method,params});
    if(method==='crm.deal.get')return {...snapshot.deal,CATEGORY_ID:'7',STAGE_ID:'C7:NEW'};
    if(method==='user.get')return [snapshot.creator];
    return [{STATUS_ID:params.filter.STATUS_ID,NAME:params.filter.ENTITY_ID==='SOURCE'?snapshot.source:snapshot.stageName}];
  });
  assert.equal(response.stageName,snapshot.stageName);
  assert(calls.some(call=>call.params.filter?.ENTITY_ID==='DEAL_STAGE_7'));
  assert.deepEqual(calls.find(call=>call.method==='user.get').params,{ID:'138'});
});

test('Б24 HTTP: ФИО, создание/изменение, повторные события, изоляция и сбои API', async () => {
  const root=path.resolve(__dirname,'..');
  await fs.mkdir(path.join(root,'.data'),{recursive:true});
  const dir=await fs.mkdtemp(path.join(root,'.data','bitrix-test-'));
  const mock=path.join(dir,'mock.json'), conf=path.join(dir,'bitrix.json');
  await fs.writeFile(mock,JSON.stringify(snapshot));await fs.writeFile(conf,JSON.stringify(config));
  const child=spawn(process.execPath,['--require',path.join(__dirname,'bitrix-mock.cjs'),path.join(root,'server.js')],{
    cwd:root,env:{...process.env,PORT:'0',MANAGER_DATA_DIR:dir,BITRIX_CONFIG_FILE:conf,BITRIX_MOCK_FILE:mock,ADMIN_PASSWORD:'TestPassword2026'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr.on('data',data=>logs+=data);
  try {
    const [output]=await once(child.stdout,'data');
    const base=output.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const request=(route,body,cookie='',method='POST')=>fetch(`${base}/api/${route}`,{method,headers:{'Content-Type':'application/json',cookie},body:body===undefined?undefined:JSON.stringify(body)});
    const login=async name=>{const r=await request('auth/login',{login:name,password:'TestPassword2026'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
    const admin=await login('admin');
    for(const user of users.slice(1)) assert.equal((await request('users',{login:user.login,fullName:user.fullName,password:'TestPassword2026'},admin)).status,201);
    const anton=await login('anton'),other=await login('other');
    assert.equal((await request('users',{action:'profile',id:2,fullName:'Антон Исаков'},other,'PUT')).status,403);
    assert.equal((await request('users',{action:'profile',id:2,fullName:'  Антон  Исаков '},admin,'PUT')).status,200);
    const accounts=await (await request('users',undefined,admin,'GET')).json();assert.equal(accounts.find(u=>u.id===2).fullName,'Антон Исаков');
    assert.equal((await request('bitrix/status',undefined,other,'GET')).status,403);
    assert.equal((await request('bitrix/config',config,other)).status,403);
    const save=await request('bitrix/config',{webhookUrl:'',eventToken:'',paidAmountField:'UF_PAID'},admin);
    assert.equal(save.status,200);
    const publicSettings=await save.text();assert(!publicSettings.includes('test-token'));assert(!publicSettings.includes('test-event-token'));
    assert.equal(JSON.parse(await fs.readFile(conf,'utf8')).eventToken,config.eventToken);
    const foreign=await fetch(`${base}/api/bitrix/config`,{method:'POST',headers:{cookie:admin,'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify(config)});
    assert.equal(foreign.status,403);
    assert.equal((await request('bitrix/config',{paidAmountField:'bad field'},admin)).status,400);
    assert.equal((await request('bitrix/events',undefined,'','GET')).status,405);
    assert.equal((await request('bitrix/events',{...event(),auth:{}})).status,403);
    const posted=await Promise.all(Array.from({length:6},()=>request('bitrix/events',event())));assert(posted.every(r=>r.status===200));
    const get=async (cookie=admin)=> (await request('contracts-registry',undefined,cookie,'GET')).json();
    let rows=await get();assert.equal(rows.filter(r=>r.number==='17000').length,1);
    assert.equal((await get(anton)).length,1);assert.equal((await get(other)).length,0);
    const update=async patch=>{await fs.writeFile(mock,JSON.stringify({...snapshot,...patch}));const r=await request('bitrix/events',{...event(),event:'ONCRMDEALUPDATE'});assert.equal(r.status,200,await r.text());};
    await update({stageName:'В ПРОИЗВОДСТВЕ (пр)'});
    let own=(await get(anton))[0];assert.equal(own.registryMeta.bitrix.dealStatus,'В работе');assert.equal(own.registryMeta.paymentStatus,'Предоплата');
    await update({stageName:bitrix.rules.stages['Завершена'][0]});
    const payout=async()=> (await request('payouts',undefined,anton,'GET')).json();
    const first=await payout();assert.equal(first.allTime.accrued,12000);
    const before=JSON.parse(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8'))[0].bonusQualifiedAt;
    const form=new URLSearchParams({'event':'ONCRMDEALUPDATE','auth[domain]':'portal.example','auth[application_token]':config.eventToken,'data[FIELDS][ID]':'17000'});
    assert.equal((await fetch(`${base}/api/bitrix/events`,{method:'POST',body:form})).status,200);
    assert.equal((await payout()).allTime.accrued,12000);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8'))[0].bonusQualifiedAt,before);
    await request('contracts-registry',{action:'update-meta',number:'17000',fields:{bitrix:{dealStatus:'Планируется'},source:'hacked',prepayment:1}},anton);
    own=(await get(anton))[0];assert.equal(own.registryMeta.source,snapshot.source);assert.equal(own.registryMeta.bitrix.dealStatus,'Завершена');
    const failedBefore=await get();await fs.writeFile(mock,JSON.stringify({error:true}));
    const failed=await request('bitrix/events',event());assert.equal(failed.status,502);assert(!(await failed.text()).includes('private-token'));assert.deepEqual(await get(),failedBefore);
    await update({stageName:'ЗАМЕР (пр)'});assert.equal((await payout()).allTime.accrued,0);
    await update({creator:{...snapshot.creator,NAME:'Посторонний',LAST_NAME:'Сотрудник'}});
    assert.equal((await get(anton)).length,1);
    await fs.writeFile(mock,JSON.stringify(snapshot));
    assert.equal((await request('contracts-registry',{record:{number:'17001',amount:100,registryMeta:{bitrix:{dealStatus:'Завершена'}}}},admin)).status,200);
    assert.equal((await request('bitrix/events',event('17001'))).status,409);
    assert.equal((await get()).find(r=>r.number==='17001').registryMeta.bitrix,null);
    const newest=await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8');
    await fs.writeFile(mock,JSON.stringify({...snapshot,deal:{...snapshot.deal,DATE_MODIFY:'2026-09-09T00:00:00Z'}}));
    assert.equal((await (await request('bitrix/events',event())).json()).skipped,'stale_snapshot');
    assert.equal(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8'),newest);
    await request('contracts-registry',{action:'delete',number:'17000'},admin);
    assert.equal((await (await request('bitrix/events',event())).json()).skipped,'record_deleted');
  } finally {child.kill();await once(child,'exit');}
});
