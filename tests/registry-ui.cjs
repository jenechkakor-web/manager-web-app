// Isolated UI verification; never uses production records or credentials.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{chromium}=require(process.argv[2]);
(async()=>{
  const root=path.resolve(__dirname,'..'),dir=await fs.mkdtemp(path.join(root,'.data','registry-ui-'));
  const fixture=require('./bitrix-fixture.json'),password='RegistryIsolated2026',salt=crypto.randomBytes(16).toString('hex');
  const users=[{id:2,login:'anton',fullName:'Антон Исаков',role:'admin'},{id:3,login:'other',fullName:'Александр Стаценко',role:'user'}]
    .map(user=>({...user,passwordHash:salt+':'+crypto.scryptSync(password,salt,64).toString('hex')}));
  const meta={title:'Локальная сделка',source:'Директ',paymentStatus:'Предоплата',prepayment:100,prepaymentOverridden:true,closingDocs:'Не отправлены',bonusType:'12%',paymentType:'',bitrix:{dealId:'14000',domain:'portal.example',creatorId:'138',dealStatus:'Завершена'}};
  await fs.writeFile(path.join(dir,'users.json'),JSON.stringify(users));
  await fs.writeFile(path.join(dir,'tech-presets.json'),'[]');
  await fs.writeFile(path.join(dir,'contracts-registry.json'),JSON.stringify([{number:'14000',ownerId:2,date:'2026-09-01',amount:1000,status:'draft',data:{},registryMeta:meta},{number:'14001',ownerId:3,date:'2026-09-02',amount:2000,status:'draft',data:{},registryMeta:{...meta,bitrix:null}}]));
  await fs.writeFile(path.join(dir,'mock.json'),JSON.stringify(fixture.snapshot));
  await fs.writeFile(path.join(dir,'config.json'),JSON.stringify(fixture.config));
  const child=spawn(process.execPath,['--require',path.join(__dirname,'bitrix-mock.cjs'),'server.js'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0',MANAGER_DATA_DIR:dir,BITRIX_MOCK_FILE:path.join(dir,'mock.json'),BITRIX_CONFIG_FILE:path.join(dir,'config.json')}});
  let browser;
  try {
    const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout')),10000);child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127.0.0.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.on('error',reject);});
    browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
    const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/login.html?next=%2Fregistry.html');
    await page.getByLabel('Логин',{exact:true}).fill('anton');await page.getByLabel('Пароль',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await page.locator('#registryTableBody tr').first().waitFor();
    assert.equal(await page.locator('select#registryManagerFilter').count(),0);
    assert(await page.locator('.registry-summary').evaluate(el=>el.getBoundingClientRect().top)<await page.locator('.registry-toolbar').evaluate(el=>el.getBoundingClientRect().top));
    const managers=page.getByRole('group',{name:'Фильтр по менеджеру'});
    await managers.getByRole('button',{name:'Антон Исаков',exact:true}).click();
    assert.equal(await page.locator('#registryTableBody tr').count(),1);
    const row=page.locator('tr[data-number="14000"]');
    assert.equal(await row.locator('[data-column="dealStatus"]').innerText(),'В работе');
    assert.equal(await row.locator('[data-edit-field="number"]').count(),0);
    for(const [field,label,value] of [['title','Название','Изменено вручную'],['date','Дата','2026-08-31'],['counterparty','Контрагент','Клиент вручную'],['amount','Сумма','1500']]) {
      await row.locator('[data-edit-field="'+field+'"]').click();await row.getByLabel(label,{exact:true}).fill(value);
      await row.getByLabel(label,{exact:true}).press('Enter');
      await page.waitForFunction(()=>document.querySelector('#registryStatus').textContent.includes('сохранены'));
    }
    await row.locator('[data-edit-field="source"]').click();await row.getByLabel('Источник',{exact:true}).selectOption('Сарафан');await row.getByLabel('Источник',{exact:true}).press('Enter');
    await page.waitForFunction(()=>document.querySelector('#registryStatus').textContent.includes('сохранены'));
    // A viewing filter for another manager must not alter the refresh owner.
    await managers.getByRole('button',{name:'Александр Стаценко',exact:true}).click();
    const otherBefore=JSON.parse(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8')).find(r=>r.number==='14001');
    await page.getByRole('button',{name:'Обновить данные с Б24',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#bitrixRecentStatus').textContent.includes('Обновлено ваших сделок: 5 из 5'));
    const stored=JSON.parse(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8'));
    assert.deepEqual(stored.find(r=>r.number==='14001'),otherBefore);
    assert.equal(stored.filter(r=>Number(r.number)>=18016&&r.ownerId===2).length,5);
    assert.equal(await page.locator('#registryTableBody tr').count(),1);
    await managers.getByRole('button',{name:'Все менеджеры',exact:true}).click();
    assert.equal(await page.locator('#registryTableBody tr').count(),7);
    await fs.mkdir(path.join(root,'.tmp','registry-qa'),{recursive:true});
    await page.screenshot({path:path.join(root,'.tmp','registry-qa','desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert(await managers.getByRole('button').evaluateAll(buttons=>buttons.every(button=>button.getBoundingClientRect().right<=window.innerWidth)), 'Manager buttons must wrap within the viewport');
    await page.screenshot({path:path.join(root,'.tmp','registry-qa','mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Выйти',exact:true}).click();
    await page.getByLabel('Логин',{exact:true}).fill('other');await page.getByLabel('Пароль',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await page.waitForURL('**/index.html');
    await page.goto(base+'/registry.html');await page.locator('#registryTableBody tr').first().waitFor();
    assert.equal(await page.locator('#registryManagerFilter').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('Registry UI passed: manager buttons, summary, editable CRM rows, scoped five-deal refresh.');
  } finally { if(browser)await browser.close();child.kill(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
