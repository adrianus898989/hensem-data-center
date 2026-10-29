// Pure browser and TypeScript regressions; no database or network.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),pairs=[['MoneyPay-QR','MoneyPay'],['RAPay2INR','RAPay']];
const names=require('./load-typescript.cjs').loadTs(path.join(root,'src/lib/thirdPartyNameMap.ts')),browser={};browser.window=browser;vm.runInNewContext(fs.readFileSync(path.join(root,'admin-preview/live-provider-aliases.js'),'utf8'),browser);
test('confirmed aliases and canonical spellings agree and are idempotent in TypeScript and browser',()=>{
 for(const country of ['印度','IN','India','香港','红膏蟹'])for(const [raw,expected]of pairs)for(const value of [raw,raw.toLowerCase(),raw.replace('-',' — '),raw+' (唤醒)',expected,expected.toLowerCase()]){
  assert.equal(names.canonicalThirdPartyName(value,country),expected);
  assert.equal(browser.HensemProviderNames.canonical(value,country),expected);
  assert.equal(names.canonicalThirdPartyName(names.canonicalThirdPartyName(value,country),country),expected);
 }
 assert.notEqual(names.canonicalThirdPartyName('EyPay','印度'),'MoneyPay');
 for(const raw of ['MoneyPay_QR','MoneyPay-QR2','MoneyPay-QR-extra','RAPay3INR','RAPay2INR-extra'])assert.equal(names.confirmedIndiaThirdPartyAlias(raw,'印度'),'');
 for(const country of ['印尼','巴西','PK','IN-other',''])for(const [raw]of pairs){
  assert.equal(names.confirmedIndiaThirdPartyAlias(raw,country),'');
  assert.equal(browser.HensemProviderNames.canonical(raw,country),raw);
 }
 assert.notEqual(browser.HensemProviderNames.canonical('AiPay','印度'),browser.HensemProviderNames.canonical('AIV3Pay','印度'));
 assert.notEqual(browser.HensemProviderNames.canonical('999PAY','印度'),'99Pay');
});
test('exact raw query expansion preserves the older RAPay alias without enumerating unrelated providers',()=>{
 for(const fn of [names.confirmedThirdPartyQueryNames,browser.HensemProviderNames.queryNames]){
  assert.deepEqual([...fn(['MoneyPay'],'印度')],['MoneyPay','MoneyPay-QR']);
  assert.deepEqual([...fn(['RAPay'],'印度')],['RAPay','RAPay2INR','RAPayINR-QR']);
  assert.deepEqual([...fn(['MoneyPay-QR','MoneyPay'],'印度',['MONEYPAY-QR','EyPay','RAPay2INR'])],['MONEYPAY-QR','MoneyPay','MoneyPay-QR']);
  assert.deepEqual([...fn(['MoneyPay'],'印尼',()=>{throw Error('foreign scope must not enumerate')})],['MoneyPay']);
  assert.deepEqual([...fn([],'印度',()=>{throw Error('all providers must not enumerate')})],[]);
 }
});
