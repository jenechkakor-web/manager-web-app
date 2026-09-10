// Loaded only by the isolated test subprocess, never by server.js in production.
const fs = require('node:fs/promises');
global.fetch = async (url, options) => {
  if (url.hostname !== 'portal.example') throw new Error('Unexpected test host');
  const fixture = JSON.parse(await fs.readFile(process.env.BITRIX_MOCK_FILE, 'utf8'));
  if (fixture.error) return new Response(JSON.stringify({error:'unavailable',error_description:'private-token'}),{status:503});
  const params = JSON.parse(options.body);
  let result;
  if (url.pathname.endsWith('/crm.deal.get.json')) result = {...fixture.deal, ID: String(params.id)};
  else if (url.pathname.endsWith('/user.get.json')) result = [fixture.creator];
  else if (url.pathname.endsWith('/crm.status.list.json')) result = [{STATUS_ID:params.filter.STATUS_ID,NAME:params.filter.ENTITY_ID === 'SOURCE' ? fixture.source : fixture.stageName}];
  else throw new Error('Unexpected test method');
  return new Response(JSON.stringify({result}),{status:200,headers:{'Content-Type':'application/json'}});
};
