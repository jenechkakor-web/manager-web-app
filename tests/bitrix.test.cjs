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

test('Б24: только четыре поля, внутренняя оплата и бонусы', () => {
  for(const names of Object.values(bitrix.rules.stages)) for(const stageName of [...names,'Неизвестная стадия']) {
    const record=mapped({stageName,deal:{...snapshot.deal,UF_PAID:'bad',DATE_CREATE:'bad'}});
    assert.equal(record.registryMeta.paymentStatus,'Планируется');
    assert.equal(record.registryMeta.prepayment,0);
    assert.equal(record.registryMeta.bitrix.dealStatus,undefined);
    assert.equal(record.amount,100000); assert.equal(record.ownerId,2); assert.equal(record.number,'17000');
    assert.equal(record.registryMeta.source,snapshot.source); assert.equal(bonusCents(record),0);
  }
  const previous=mapped(); previous.date='2025-02-03'; previous.counterparty='Ручной клиент';
  Object.assign(previous.registryMeta,{paymentStatus:'Да',prepayment:100000,closingDocs:'Отправлены',bonusType:'12%',paymentType:'Наличка'});
  const complete=stampQualification(previous,null);
  const again=stampQualification(mapped({stageName:'ЗАМЕР (пр)'},complete),complete);
  assert.equal(again.date,'2025-02-03');assert.equal(again.counterparty,'Ручной клиент');
  assert.equal(again.registryMeta.paymentType,'Наличка');assert.equal(again.bonusQualifiedAt,complete.bonusQualifiedAt);
  assert.equal(buildReport([again],users,[],users[1],new URLSearchParams()).allTime.accrued,12000);
  assert.throws(()=>mapped({deal:{...snapshot.deal,OPPORTUNITY:'90000'}},again));
  assert.throws(()=>mapped({deal:{...snapshot.deal,OPPORTUNITY:'110000'}},again));
  again.registryMeta.paymentStatus='Предоплата';again.registryMeta.prepayment=50000;
  assert.equal(bonusCents(mapped({stageName:'Сделка завершена. Документы подписаны.'},again)),0);
  const legacy={...again,registryMeta:{...again.registryMeta,bitrix:{dealStatus:'Завершена'}}};
  assert.equal(bonusCents(legacy),0,'Legacy CRM state cannot award a bonus');
});

test('Б24: последние пять по создателю, а не ответственному', async()=>{
  const calls=[];
  const call=async(method,params)=>{calls.push({method,params});return method==='user.get'?[snapshot.creator]:Array.from({length:8},(_,i)=>({ID:String(18020-i),CREATED_BY_ID:snapshot.creator.ID}));};
  assert.deepEqual(await bitrix.recentIds(config,users,users[1],call),['18020','18019','18018','18017','18016']);
  assert.deepEqual(calls[1].params.filter,{CREATED_BY_ID:snapshot.creator.ID});
  assert.deepEqual(calls[1].params.order,{DATE_CREATE:'DESC',ID:'DESC'});
  await assert.rejects(()=>bitrix.recentIds(config,users,users[0],call));
  await assert.rejects(()=>bitrix.recentIds(config,users,users[1],async method=>method==='user.get'?[snapshot.creator]:[{ID:'1',CREATED_BY_ID:'99'}]));
});

test('Б24: только разрешённые имена и единственное существующее ФИО', () => {
  for(const name of bitrix.rules.managers) {
    const [NAME,LAST_NAME]=name.split(' '), user={id:9,login:'linked',fullName:name};
    assert.equal(bitrix.resolveManager({ID:'99',NAME,LAST_NAME},[user],{}).id,9);
  }
  assert.equal(bitrix.resolveManager(snapshot.creator,[],config),null);
  assert.equal(bitrix.resolveManager(snapshot.creator,[users[1],{...users[1],id:7}],config),null);
  assert.equal(bitrix.resolveManager({ID:'999',NAME:'Посторонний',LAST_NAME:'Сотрудник'},users,config),null);
  assert.equal(bitrix.resolveManager(snapshot.creator,users,{...config,managers:{'Антон Исаков':{login:'anton',bitrixId:'999'}}}),null);
  const alexey = {ID:'1',NAME:'Алексей',LAST_NAME:'Купоров'};
  const admin = {...users[0], fullName:'Алексей Купоров'};
  assert.equal(bitrix.resolveManager(alexey,[admin],config).id,1);
  assert.equal(bitrix.resolveManager(alexey,users,config),null);
  assert.equal(bitrix.resolveManager({ID:'24',NAME:'Алексей',LAST_NAME:'Болдов'},[admin],config),null);
});

test('Б24: подпись, домен, ошибки данных и защита полей от подделки', async () => {
  assert.equal(bitrix.authenticate(event(),config),'17000');
  for(const body of [{...event(),auth:{}},{...event(),auth:{...event().auth,domain:'evil.example'}},{...event(),data:{FIELDS:{ID:'../bad'}}}]) assert.throws(()=>bitrix.authenticate(body,config));
  assert.throws(()=>bitrix.authenticate(event(),{...config,eventToken:''}));
  assert.throws(()=>bitrix.endpoint({...config,webhookUrl:'http://portal.example/rest/1/token/'}));
  assert.equal(bitrix.authenticate({...event(),event:'ONCRMDEALDELETE'},config),null);
  for(const patch of [{OPPORTUNITY:'invalid'},{OPPORTUNITY:'-1'},{CURRENCY_ID:'USD'}]) assert.throws(()=>mapped({deal:{...snapshot.deal,...patch}}));
  assert.doesNotThrow(()=>bitrix.mapSnapshot(snapshot,{...config,paidAmountField:'MISSING'},users));
  const plain={registryMeta:{bitrix:{dealStatus:'Завершена'}}};
  bitrix.preserveCrmFields(plain,null);assert.equal(plain.registryMeta.bitrix,undefined);
  const original=mapped();const changed=structuredClone(original);changed.amount=999;changed.registryMeta.bitrix.dealStatus='Завершена';
  bitrix.preserveCrmFields(changed,original);assert.equal(changed.amount,999);assert.equal(changed.registryMeta.bitrix.dealStatus,undefined);
  const calls=[];
  const response=await bitrix.fetchSnapshot('17000',config,async (method,params)=>{
    calls.push({method,params});
    if(method==='crm.deal.get')return {...snapshot.deal,CATEGORY_ID:'7',STAGE_ID:'C7:NEW'};
    if(method==='user.get')return [snapshot.creator];
    return [{STATUS_ID:params.filter.STATUS_ID,NAME:params.filter.ENTITY_ID==='SOURCE'?snapshot.source:snapshot.stageName}];
  });
  assert.equal(response.source,snapshot.source);
  assert(!calls.some(call=>call.params.filter?.ENTITY_ID==='DEAL_STAGE_7'));
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
    let own=(await get(anton))[0];assert.equal(own.registryMeta.bitrix.dealStatus,undefined);assert.equal(own.registryMeta.paymentStatus,'Планируется');
    await update({stageName:bitrix.rules.stages['Завершена'][0]});
    const payout=async()=> (await request('payouts',undefined,anton,'GET')).json();
    const first=await payout();assert.equal(first.allTime.accrued,0);
    assert.equal((await request('contracts-registry',{action:'update-meta',number:'17000',fields:{paymentStatus:'Предоплата',prepayment:50000}},anton)).status,200);
    assert.equal((await request('contracts-registry',{action:'update-meta',number:'17000',fields:{paymentStatus:'Да',closingDocs:'Отправлены'}},anton)).status,200);
    assert.equal((await payout()).allTime.accrued,12000);
    const before=JSON.parse(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8'))[0].bonusQualifiedAt;
    const form=new URLSearchParams({'event':'ONCRMDEALUPDATE','auth[domain]':'portal.example','auth[application_token]':config.eventToken,'data[FIELDS][ID]':'17000'});
    assert.equal((await fetch(`${base}/api/bitrix/events`,{method:'POST',body:form})).status,200);
    assert.equal((await payout()).allTime.accrued,12000);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8'))[0].bonusQualifiedAt,before);
    await request('contracts-registry',{action:'update-meta',number:'17000',fields:{bitrix:{dealStatus:'Планируется'},source:'Ручной источник',paymentStatus:'Предоплата',prepayment:1}},anton);
    own=(await get(anton))[0];assert.equal(own.registryMeta.source,'Ручной источник');assert.equal(own.registryMeta.bitrix.dealStatus,undefined);
    const failedBefore=await get();await fs.writeFile(mock,JSON.stringify({error:true}));
    const failed=await request('bitrix/events',event());assert.equal(failed.status,502);assert(!(await failed.text()).includes('private-token'));assert.deepEqual(await get(),failedBefore);
    await update({stageName:'ЗАМЕР (пр)'});assert.equal((await payout()).allTime.accrued,0);
    await update({creator:{...snapshot.creator,NAME:'Посторонний',LAST_NAME:'Сотрудник'}});
    assert.equal((await get(anton)).length,1);
    await fs.writeFile(mock,JSON.stringify(snapshot));
    assert.equal((await request('contracts-registry',{record:{number:'17001',amount:100,registryMeta:{bitrix:{dealStatus:'Завершена'}}}},admin)).status,200);
    assert.equal((await request('bitrix/events',event('17001'))).status,409);
    assert.equal((await get()).find(r=>r.number==='17001').registryMeta.bitrix,null);
    const runId='12345678-1234-4234-8234-123456789abc';
    const refresh=async(number,cookie=admin)=>(await request('bitrix/refresh',{number,runId},cookie));
    assert.equal((await request('bitrix/refresh',undefined,anton,'GET')).status,403);
    assert.equal((await refresh('17001',anton)).status,403);
    assert.equal((await (await refresh('17001')).json()).skipped,'creator_mismatch');
    assert.equal((await (await refresh('99999')).json()).skipped,'record_deleted');
    const manual={number:'17002',amount:20000,data:{customer:{name:'Сохранить реквизиты'}},registryMeta:{title:'Ручная запись',source:'Директ',bonusType:'5%',closingDocs:'Отправлены'}};
    assert.equal((await request('contracts-registry',{record:manual},anton)).status,200);
    assert.equal((await request('contracts-registry',{record:{...manual,number:'17002_2'}},anton)).status,200);
    assert.equal((await (await refresh('17002_2')).json()).skipped,'needs_deal_id');
    const refreshed=await refresh('17002');assert.equal(refreshed.status,200);
    assert.equal((await refreshed.json()).synced,true);
    const adopted=(await get()).find(r=>r.number==='17002');
    assert.equal(adopted.amount,100000);assert.equal(adopted.registryMeta.bitrix.dealId,'17002');
    assert.equal(adopted.registryMeta.bonusType,'5%');assert.equal(adopted.registryMeta.closingDocs,'Отправлены');
    const disk=JSON.parse(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8'));
    assert.deepEqual(disk.find(r=>r.number==='17002').data,manual.data);
    const audit=JSON.parse(await fs.readFile(path.join(dir,'bitrix-refresh-history.json'),'utf8'));
    assert.equal(audit.length,1);assert.equal(audit[0].previous.amount,20000);
    await fs.writeFile(mock,JSON.stringify({...snapshot,deal:{...snapshot.deal,OPPORTUNITY:'200000'}}));
    assert.equal((await (await refresh('17002')).json()).amount,100000);
    assert.equal((await get()).find(r=>r.number==='17002').amount,100000);
    assert.equal((await request('bitrix/events',event('17002'))).status,200);
    assert.equal((await get()).find(r=>r.number==='17002').amount,200000);
    // Five IDs are selected on the server and bound to the initiating session.
    await fs.writeFile(mock,JSON.stringify(snapshot));
    const planResponse=await request('bitrix/recent',{action:'prepare'},anton);assert.equal(planResponse.status,200);
    const plan=await planResponse.json();assert.equal(plan.dealIds.length,5);
    assert.equal((await request('bitrix/recent',{runId:plan.runId,dealId:'18015'},anton)).status,403);
    assert.equal((await request('bitrix/recent',{runId:plan.runId,dealId:plan.dealIds[0]},other)).status,403);
    for(const dealId of plan.dealIds) assert.equal((await request('bitrix/recent',{runId:plan.runId,dealId},anton)).status,200);
    assert.equal((await get(anton)).filter(r=>plan.dealIds.includes(r.number)).length,5);
    assert.equal((await get(anton)).filter(r=>r.number==='18015').length,0);
    const editOwn=fields=>request('contracts-registry',{action:'update-meta',number:'18020',fields},anton);
    assert.equal((await editOwn({title:'Своё название',source:'Сарафан',date:'2026-01-02',counterparty:'Клиент',amount:123456})).status,200);
    assert.equal((await editOwn({number:'another'})).status,400);
    assert.equal((await editOwn({manager:'other'})).status,403);
    assert.equal((await editOwn({recordStatus:'exported'})).status,403);
    assert.equal((await editOwn({paymentStatus:'Да'})).status,409);
    assert.equal((await editOwn({bonusAmount:123})).status,409);
    assert.equal((await editOwn({paymentStatus:'Предоплата',prepayment:5000})).status,200);
    assert.equal((await editOwn({amount:4999})).status,409);
    const manualOwn=(await get(anton)).find(r=>r.number==='18020');assert.equal(manualOwn.date,'2026-01-02');assert.equal(manualOwn.amount,123456);
    await fs.writeFile(mock,JSON.stringify({...snapshot,deal:{...snapshot.deal,CREATED_BY_ID:'1'},creator:{ID:'1',NAME:'Алексей',LAST_NAME:'Купоров'}}));
    assert.equal((await request('bitrix/recent',{runId:plan.runId,dealId:'18020'},anton)).status,403);
    await fs.writeFile(mock,JSON.stringify(snapshot));
    for(const sellerKey of ['ip','ooo']) {
      const invoice={number:'INVOICE-'+sellerKey,amount:100,status:'exported',data:{sellerKey}};
      assert.equal((await request('contracts-registry',{record:invoice},anton)).status,200);
      assert.equal((await get(anton)).find(r=>r.number===invoice.number).registryMeta.paymentType,sellerKey==='ip'?'ИП':'ООО');
      await request('contracts-registry',{action:'update-meta',number:invoice.number,fields:{paymentType:'Наличка'}},anton);
      await request('contracts-registry',{record:invoice},anton);
      assert.equal((await get(anton)).find(r=>r.number===invoice.number).registryMeta.paymentType,'Наличка');
    }
    const newest=await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8');
    await fs.writeFile(mock,JSON.stringify({...snapshot,deal:{...snapshot.deal,DATE_MODIFY:'2026-09-09T00:00:00Z'}}));
    assert.equal((await (await request('bitrix/events',event())).json()).skipped,'stale_snapshot');
    assert.equal(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8'),newest);
    await request('contracts-registry',{action:'delete',number:'17000'},admin);
    assert.equal((await (await request('bitrix/events',event())).json()).skipped,'record_deleted');
  } finally {child.kill();await once(child,'exit');}
});
