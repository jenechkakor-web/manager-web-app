// Isolated admin-to-manager workflow; never reads production data or credentials.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const {spawn} = require('node:child_process'), {chromium} = require(process.argv[2]);
function documentXml(zip) {
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    if (name === 'word/document.xml') {
      assert.equal(zip.readUInt16LE(offset + 8), 0);
      return zip.subarray(start, start + size).toString();
    }
    offset = start + size;
  }
  throw new Error('Document XML missing from export');
}
(async () => {
  const root = path.resolve(__dirname, '..'), dir = await fs.mkdtemp(path.join(root, '.data', 'users-ui-'));
  const password = 'IsolatedContacts2026', salt = crypto.randomBytes(16).toString('hex');
  const users = [{id:1, login:'admin', role:'admin'}, {id:2, login:'manager', role:'user'}]
    .map(user => ({...user, passwordHash:salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex')}));
  await fs.writeFile(path.join(dir, 'users.json'), JSON.stringify(users));
  for (const file of ['tech-presets.json','contracts-registry.json']) await fs.writeFile(path.join(dir, file), '[]');
  const child = spawn(process.execPath, ['server.js'], {cwd:root, windowsHide:true, env:{...process.env, PORT:'0', MANAGER_DATA_DIR:dir}});
  let browser;
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server timeout')), 10000);
      child.stdout.on('data', chunk => {const match = String(chunk).match(/http:\/\/127.0.0.1:\d+/); if (match) {clearTimeout(timer); resolve(match[0]);}});
      child.on('error', reject);
    });
    browser = await chromium.launch({headless:true, executablePath:process.argv[3]});
    const page = await browser.newPage({viewport:{width:1440,height:1050}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const login = async (name, next) => {
      await page.goto(base + '/login.html?next=' + encodeURIComponent('/' + next));
      await page.getByLabel('Логин',{exact:true}).fill(name);
      await page.getByLabel('Пароль',{exact:true}).fill(password);
      await page.getByRole('button',{name:'Войти',exact:true}).click();
      await page.waitForURL('**/' + next);
    };
    await login('admin', 'users.html');
    const profile = page.locator('[data-user-id="2"]');
    await profile.getByLabel('ФИО',{exact:true}).fill('Антон Исаков');
    await profile.getByLabel('Телефон',{exact:true}).fill('+7 (999) 123-45-67');
    await profile.getByLabel('Почта',{exact:true}).fill('manager@example.test');
    await profile.getByRole('button',{name:'Сохранить данные'}).click();
    await page.waitForFunction(() => document.querySelector('#usersStatus').textContent === 'ФИО и контакты сохранены.');
    await page.reload();
    await profile.getByLabel('Почта',{exact:true}).waitFor();
    assert.equal(await profile.getByLabel('Почта',{exact:true}).inputValue(), 'manager@example.test');
    assert.equal(await profile.getByLabel('Телефон',{exact:true}).inputValue(), '+7 (999) 123-45-67');
    const create = page.locator('#createUserForm');
    for (const [label,value] of [['Логин','newmanager'],['Пароль',password],['ФИО','Иван Дмитриев'],['Телефон','+7 999 765-43-21'],['Почта','new@example.test']]) await create.getByLabel(label,{exact:true}).fill(value);
    await create.getByRole('button',{name:'Создать',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#usersStatus').textContent.includes('Пользователь создан'));
    assert.equal(await page.locator('[data-user-id="3"]').getByLabel('Почта',{exact:true}).inputValue(), 'new@example.test');
    const qa = path.join(root, '.tmp', 'users-qa'); await fs.mkdir(qa, {recursive:true});
    await page.screenshot({path:path.join(qa,'desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert(await page.locator('#usersList input').evaluateAll(inputs => inputs.every(input => input.getBoundingClientRect().right <= window.innerWidth)));
    await page.screenshot({path:path.join(qa,'mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Выйти',exact:true}).click();
    await page.waitForURL('**/login.html');
    await login('manager', 'proposal.html');
    await page.waitForFunction(() => document.querySelector('[name="managerEmail"]').value === 'manager@example.test');
    assert.equal(await page.getByLabel('Имя Фамилия',{exact:true}).inputValue(), 'Антон Исаков');
    assert.equal(await page.getByLabel('Телефон',{exact:true}).inputValue(), '+7 (999) 123-45-67');
    await page.getByLabel('Почта',{exact:true}).fill('proposal-only@example.test');
    await page.locator('.item-name').fill('Тестовая вывеска');
    await page.locator('.item-price').fill('1000');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button',{name:'Выгрузить КП',exact:true}).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.docx$/);
    const target = path.join(qa,'contacts.docx'); await download.saveAs(target);
    const xml = documentXml(await fs.readFile(target));
    for (const contact of ['Антон Исаков','+7 (999) 123-45-67','proposal-only@example.test']) assert(xml.includes(contact), contact);
    assert(!xml.includes('new@example.test'));
    const savedUsers = JSON.parse(await fs.readFile(path.join(dir,'users.json'),'utf8'));
    assert.equal(savedUsers.find(user => user.id === 2).email,'manager@example.test');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'contracts-registry.json'),'utf8')), []);
    assert.deepEqual(errors, []);
    console.log('Users UI passed: create/edit contacts, persistence, manager autofill, editable DOCX export, profile isolation.');
  } finally {if (browser) await browser.close(); child.kill();}
})().catch(error => {console.error(error); process.exitCode = 1;});
