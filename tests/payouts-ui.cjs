// Usage: node tests/payouts-ui.cjs <playwright module path> <browser executable>
// Runs in a separate temporary database and browser profile; never uses the live site.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require(process.argv[2]);

(async () => {
  const root=path.resolve(__dirname,'..');
  const dir=await fs.mkdtemp(path.join(root,'.data','payout-ui-'));
  const password='TestPassword2026';
  const users=[{id:1,login:'admin',role:'admin'},{id:2,login:'manager_test',role:'user'}].map(user=>{
    const salt=crypto.randomBytes(16).toString('hex');
    return {...user,passwordHash:`${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`};
  });
  await fs.writeFile(path.join(dir,'users.json'),JSON.stringify(users));
  await fs.writeFile(path.join(dir,'tech-presets.json'),'[]');
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
  await fs.writeFile(path.join(dir,'contracts-registry.json'),JSON.stringify([{number:'UI-001',ownerId:2,date:today,amount:10000,counterparty:'ООО Тест',
    bonusQualifiedAt:new Date().toISOString(),registryMeta:{title:'Вывеска',prepayment:10000,paymentStatus:'Да',closingDocs:'Отправлены',bonusType:'12%'}}]));
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'0',MANAGER_DATA_DIR:dir},windowsHide:true});
  let browser;
  try {
    const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Timeout')),10000);child.stdout.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.on('error',reject);});
    browser=await chromium.launch({executablePath:process.argv[3],headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    async function login(name) {
      await page.goto(`${base}/login.html?next=%2Fpayouts.html`);
      await page.getByRole('textbox',{name:'Логин',exact:true}).fill(name);
      await page.getByLabel('Пароль',{exact:true}).fill(password);
      await page.getByRole('button',{name:'Войти',exact:true}).click();
      await page.locator('#report').waitFor({state:'visible'});
    }
    await login('admin');
    await page.getByRole('button',{name:'Начислить бонус',exact:true}).click();
    await page.locator('#entryManager').selectOption('2');
    await page.locator('#entryAmount').fill('500');
    await page.locator('#entryReason').selectOption({label:'оклад'});
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.locator('#entryDialog').waitFor({state:'hidden'});
    await page.getByText('Операция сохранена.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Добавить выплату',exact:true}).click();
    assert.equal(await page.locator('#reasonLabel').isVisible(),false);
    await page.locator('#entryManager').selectOption('2');
    await page.locator('#entryAmount').fill('200');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.locator('#entryDialog').waitFor({state:'hidden'});
    await page.getByText('Операция сохранена.',{exact:false}).waitFor();
    assert.equal(await page.locator('#entryRows tr').count(),3);
    assert.deepEqual(await page.locator('#entryRows tr').filter({hasText:'UI-001'}).locator('td').allTextContents(), [today.split('-').reverse().join('.'),'UI-001','Вывеска','ООО Тест','10 000,00 ₽','1 200,00 ₽','0,00 ₽','Выплата по сделке','manager_test']);
    assert.equal(await page.locator('#entryRows tr').filter({hasText:'Выплата бонусов'}).locator('td[data-column="paid"]').innerText(),'200,00 ₽');
    assert.equal(await page.locator('#entryRows tr').filter({hasText:'Дополнительное начисление'}).locator('td[data-column="reason"]').innerText(),'оклад');
    assert.equal(await page.getByRole('columnheader',{name:'Договор / описание',exact:true}).count(),0);
    async function checkColumns() {
      const table=page.locator('#operationsTable');
      const titleHeader=table.locator('th[data-column="title"]');
      await titleHeader.scrollIntoViewIfNeeded();
      const before=await titleHeader.boundingBox();
      const edge=await table.locator('[data-resize="title"]').boundingBox();
      await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);
      await page.mouse.down();
      assert(Math.abs((await titleHeader.boundingBox()).width-before.width)<1,'Resize must not jump on mouse down');
      await page.mouse.move(edge.x+edge.width/2+45,edge.y+edge.height/2,{steps:5});
      await page.mouse.up();
      assert(Math.abs((await titleHeader.boundingBox()).width-before.width-45)<1,'Resize follows the cursor');
      await table.locator('[data-resize="title"]').dblclick();
      const fitted=(await titleHeader.boundingBox()).width;
      assert(fitted<before.width+45 && fitted>=64,'Double click fits content');
      assert(await page.locator('#entryRows td[data-column="title"]').evaluateAll(cells=>cells.every(cell=>cell.scrollWidth<=cell.clientWidth+1)),'Autofit must include all operation titles');
      await table.locator('[data-sort="accrued"]').click();
      assert.deepEqual(await page.locator('#entryRows td[data-column="accrued"]').allTextContents(),['0,00 ₽','500,00 ₽','1 200,00 ₽']);
      await table.locator('[data-sort="accrued"]').click();
      assert.deepEqual(await page.locator('#entryRows td[data-column="accrued"]').allTextContents(),['1 200,00 ₽','500,00 ₽','0,00 ₽']);
      await table.locator('[data-sort="title"]').click();
      const names=await page.locator('#entryRows td[data-column="title"]').allTextContents();
      assert.deepEqual(names,[...names].sort(new Intl.Collator('ru',{numeric:true,sensitivity:'base'}).compare));
      await table.locator('[data-drag="title"]').scrollIntoViewIfNeeded();
      await table.evaluate(element => { element.parentElement.scrollLeft = 0; });
      const source=await table.locator('[data-drag="title"]').boundingBox();
      const target=await table.locator('th[data-column="date"]').boundingBox();
      await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
      await page.mouse.down();
      await page.mouse.move(target.x+6,target.y+target.height/2,{steps:10});
      await page.mouse.up();
      assert.equal(await table.locator('th').first().getAttribute('data-column'),'title');
      assert.equal(await page.locator('#entryRows tr').first().locator('td').first().getAttribute('data-column'),'title');
      await page.reload();
      await page.locator('#report').waitFor({state:'visible'});
      assert.equal(await table.locator('th').first().getAttribute('data-column'),'title');
      assert(Math.abs((await titleHeader.boundingBox()).width-fitted)<1,'Width persists');
      assert.equal(await titleHeader.getAttribute('aria-sort'),'ascending');
    }
    await checkColumns();
    const balance=await page.locator('.payout-card.balance strong').innerText();
    assert.equal(balance.replace(/[^\d,]/g,''),'1500,00');
    await page.screenshot({path:path.join(dir,'admin.png'),fullPage:true});
    await page.locator('#month').fill('2025-01');
    await page.getByRole('button',{name:'Применить',exact:true}).click();
    await page.getByText('За выбранный период нет закрытых сделок с бонусом и операций.',{exact:true}).waitFor();
    assert.equal((await page.locator('.payout-card.balance strong').innerText()).replace(/[^\d,]/g,''),'1500,00');
    await page.getByRole('button',{name:'Весь период',exact:true}).click();
    await page.locator('#entryRows tr').filter({hasText:'UI-001'}).first().waitFor();
    await page.getByRole('button',{name:'Выйти',exact:true}).click();
    await page.waitForURL('**/login.html');
    await login('manager_test');
    assert.equal(await page.locator('#managerFilter').isVisible(),false);
    assert.equal(await page.locator('#managerSummary').isVisible(),false);
    assert.equal(await page.locator('#addPayment').isVisible(),false);
    assert.equal(await page.locator('#addAccrual').isVisible(),false);
    assert.equal(await page.locator('#entryRows tr').count(),3);
    assert.equal(await page.locator('#entryRows tr').filter({hasText:'UI-001'}).locator('td').count(),8);
    assert.equal(await page.locator('#entryRows tr').filter({hasText:'UI-001'}).locator('td').last().innerText(),'Выплата по сделке');
    assert.equal(await page.locator('#operationsTable th').first().getAttribute('data-column'),'date','Manager layout is separate from admin');
    assert.equal(await page.locator('#operationsTable [data-column="manager"]').count(),0);
    await checkColumns();
    assert.equal((await page.locator('.payout-card.balance strong').innerText()).replace(/[^\d,]/g,''),'1500,00');
    await page.screenshot({path:path.join(dir,'manager.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
    await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,artifacts:dir,balance:1500,operations:4}));
  } finally {
    if(browser) await browser.close();
    const exited=once(child,'exit');child.kill();await exited;
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
