const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {inflateRawSync} = require('node:zlib');
const root = path.join(__dirname, '..');

function app(proposal = true) {
  const handlers = {};
  const element = {addEventListener() {}};
  const fields = {};
  const form = {...element, elements:fields};
  const context = vm.createContext({console, Blob, Response, TextEncoder, TextDecoder,
    atob, Uint8Array, Uint32Array, Intl,
    window:{fflate:{inflateSync:inflateRawSync}},
    document:{body:{dataset:{documentPage:proposal ? 'proposal' : ''}}, querySelector(selector) {
      if (selector === '#contractForm') return form;
      return {addEventListener(event, handler) {handlers[`${selector}:${event}`] = handler;}};
    }},
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/initApp\(\);\s*$/, ''), context);
  context.fetchRepositoryAsset = async (name) => new Response(fs.readFileSync(path.join(root, name)));
  context.sellerFixture = (key) => vm.runInContext(`SELLERS.${key}`, context);
  return {context, handlers, fields};
}

function fixture(context, sellerKey = 'ooo', count = 3) {
  const seller = context.sellerFixture(sellerKey);
  const items = Array.from({length:count}, (_, i) => ({number:i+1,
    name:['Световая вывеска «Веркуп»', 'Монтаж рекламной конструкции', 'Доставка'][i % 3], qty:1, price:12200+i*100, sum:12200+i*100}));
  const grandTotal = items.reduce((s, i) => s+i.sum, 0);
  const vat = grandTotal*seller.vatRate/(1+seller.vatRate);
  return {contractNumber:'КП-2026/01', contractDate:'2026-09-10', sellerKey, seller,
    customer:{name:'ООО «Пример & Партнёры»'}, managerContact:{name:'Иван Дмитриев', email:'manager@example.test', phone:'+7 (999) 123-45-67'},
    items, totals:{grandTotal,vat,totalWithoutVat:grandTotal-vat}, paymentTerms:'70', finalPaymentTiming:'beforeShipment',
    workDays:'10', workAddress:'Москва, Ярославский проезд, 7А', warranty:'20 месяцев',
    technicalBlocks:[{preset:'Световая вывеска', description:'Объёмные буквы с лицевой подсветкой.\nМонтаж на подготовленное основание.', mockups:[]}],
  };
}

test('DOCX proposal retains Verkup letterhead and includes form totals and manager contacts', async () => {
  const {context:c} = app();
  const reference = await c.unzipDocx(new Uint8Array(fs.readFileSync(path.join(root, 'schet_dogovor_template.docx'))).buffer);
  for (const key of ['ip','ooo']) {
    const data = fixture(c,key);
    const blob = await c.buildProposalDocxBlob(data);
    const files = await c.unzipDocx(await blob.arrayBuffer());
    const xml = c.fileText(files, 'word/document.xml');
    assert.match(xml,/Коммерческое предложение/);
    assert.match(xml,/Пример &amp; Партнёры/);
    assert.match(xml,/Иван Дмитриев/);
    assert.match(xml,/manager@example.test/);
    assert.ok(xml.includes(c.docMoney(data.totals.grandTotal)));
    assert.ok(xml.includes(c.docMoney(data.totals.vat)));
    assert.ok(xml.includes(data.seller.vatLabel));
    assert.match(xml,/предоплата 70%/);
    assert.doesNotMatch(xml,/ИНТЕКТЕХНО|16530|Паспорт|Счет-договор|Р\/С|<w:br w:type="page"/);
    assert.equal((xml.match(/<w:sectPr\b/g)||[]).length,1);
    for (const part of reference) {
      if (['word/document.xml','word/styles.xml'].includes(part.name)) continue;
      assert.deepEqual(Buffer.from(files.find(f=>f.name===part.name).content),Buffer.from(part.content),part.name);
    }
    if (process.env.PROPOSAL_QA_DIR) {
      fs.mkdirSync(process.env.PROPOSAL_QA_DIR,{recursive:true});
      fs.writeFileSync(path.join(process.env.PROPOSAL_QA_DIR,`proposal-${key}.docx`), Buffer.from(await blob.arrayBuffer()));
    }
  }
});

test('long proposal has repeated table heading and embedded mockups with unique relationships', async () => {
  const {context:c} = app();
  const data = fixture(c,'ooo',30);
  const logo = await c.unzipDocx(new Uint8Array(fs.readFileSync(path.join(root,'schet_dogovor_template.docx'))).buffer);
  const bytes = Buffer.from(logo.find(f=>f.name==='word/media/image1.png').content);
  data.technicalBlocks[0].mockups = [{name:'Пример макета',width:1190,height:423,src:`data:image/png;base64,${bytes.toString('base64')}`}];
  const blob = await c.buildProposalDocxBlob(data);
  const files = await c.unzipDocx(await blob.arrayBuffer());
  const xml = c.fileText(files,'word/document.xml');
  assert.match(xml,/<w:tblHeader\/>/);
  assert.equal((xml.match(/<w:tr>/g)||[]).length,31);
  assert.match(xml,/rIdProposalMockup1/);
  assert.match(c.fileText(files,'word/_rels/document.xml.rels'),/Target="media\/proposal-mockup-1.png"/);
  assert.deepEqual(Buffer.from(files.find(f=>f.name==='word/media/proposal-mockup-1.png').content),bytes);
  if (process.env.PROPOSAL_QA_DIR) fs.writeFileSync(path.join(process.env.PROPOSAL_QA_DIR,'proposal-long.docx'),Buffer.from(await blob.arrayBuffer()));
});

test('proposal page excludes requisites and export does not change the deal registry', async () => {
  const html = fs.readFileSync(path.join(root,'proposal.html'),'utf8');
  assert.doesNotMatch(html,/name="(?:customerInn|customerKpp|customerAddress|customerOgrn|passport|personAddress|addSignatureSeal)"/);
  for (const name of ['managerName','managerEmail','managerPhone']) assert.ok(html.includes(`name="${name}"`));
  assert.doesNotMatch(fs.readFileSync(path.join(root,'index.html'),'utf8'),/id="downloadProposalButton"/);
  const {context:c, handlers} = app();
  let downloads=0;
  c.validateBeforeProposal=()=>true;
  c.collectData=()=>fixture(c);
  c.buildProposalDocxBlob=async()=>new Blob(['fixture']);
  c.downloadDocx=(name)=>{assert.match(name,/КП_Веркуп/);downloads++;};
  c.saveContractRegistryEntry=()=>{throw new Error('Proposal changed registry');};
  const button={};
  await handlers['#downloadProposalButton:click']({currentTarget:button});
  assert.equal(downloads,1);
  assert.equal(button.disabled,false);
});
