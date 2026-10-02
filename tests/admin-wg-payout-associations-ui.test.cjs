// Synthetic authorized DTOs only; no private merchant IDs or native account data.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-payout-config.js'),'utf8');
async function render(merchants,{country='BR',members=[{site_code:'278',name:'26BET'},{site_code:'12588',name:'POPMIU'}],settings={0:{exemptSwitch:1}}}={}){
 const t={country_code:country,country_name:country==='BR'?'巴西':'越南',platform:country==='BR'?'26BET':'98VV',timezone:'UTC',members};
 const calls=[],ctx={window:{}};vm.runInNewContext(source,ctx);const api=ctx.window.HensemLivePayoutConfig;
 api.configure({request:async q=>{calls.push(JSON.parse(JSON.stringify(q)));return q.operation==='index'?{version:1,system:'WG',readOnly:true,targets:[t],summaries:[]}:{version:1,system:'WG',readOnly:true,target:t,snapshot:{observed_local_date:'2026-10-01',configuration:{settings,dictionaries:merchants===undefined?{}:{merchants},completeness:{}}}};}});
 await api.loadIndex('WG');return {api,calls,html:api.render()};
}
test('read-only association shows approved display label, native ID/name and authorized platforms without changing saved rules',async()=>{
 const saved={0:{exemptSwitch:1,exemptMemberLevelAmount:[{merchList:['N-3'],currency:'BRL',amount:10}]}};
 const merchant={id:'N-3',value:'NaNaPay(BRL)3',canonicalProvider:'NanaPay',displayLabel:'NanaPay',memberPlatforms:[{site_code:'12588',name:'POPMIU'}]};
 const before=JSON.stringify({saved,merchant}),{html,calls}=await render([merchant],{settings:saved});
 assert.match(html,/配置三方关联/);assert.match(html,/>NanaPay<\/span>/);assert.match(html,/NaNaPay\(BRL\)3/);assert.match(html,/ID：N-3/);assert.match(html,/>POPMIU<\/span>/);assert.match(html,/&quot;merchList&quot;/);assert.equal(JSON.stringify({saved,merchant}),before);
 assert.equal(calls.length,2);assert(calls.every(q=>q.action==='payoutConfig'&&['index','snapshot'].includes(q.operation)));assert.doesNotMatch(html,/编辑关联|保存关联|解除关联/);
});
test('Tron display omits currency suffix while preserving canonical fee key and actual native merchant identity',async()=>{
 const {html}=await render([{id:'T-1',value:'TronPay(USDT)',canonicalProvider:'TronPayUSDT',displayLabel:'TronPay',memberPlatforms:[{site_code:'3605',name:'XX98'}]}],{country:'VN',members:[{site_code:'3605',name:'XX98'}]});
 assert.match(html,/title="统一标识：TronPayUSDT">TronPay<\/span>/);assert.match(html,/TronPay\(USDT\)/);assert.match(html,/ID：T-1/);
});
test('unknown or out-of-scope association metadata never infers a provider or exposes foreign member names',async()=>{
 const {html}=await render([{id:0,value:'Unknown(BRL)3'},{id:'X',value:'TronPay(USDT)',canonicalProvider:'TronPayUSDT',displayLabel:'TronPay',memberPlatforms:[{site_code:'3913',name:'KK98'}]}]);
 assert.match(html,/ID：0/);assert.match(html,/未关联/);assert.doesNotMatch(html,/KK98|统一标识：TronPayUSDT/);
 const absent=await render(undefined);assert.match(absent.html,/商户字典未提供/);const invalid=await render(null);assert.match(invalid.html,/商户字典暂不可用/);
});
test('all association labels and native fields are escaped and local brand selection sends no writes',async()=>{
 const item={id:'"><img src=x>',value:'<script>source</script>',canonicalProvider:'<svg onload=alert(1)>',displayLabel:'<b>label</b>',memberPlatforms:[{site_code:'278',name:'26BET'}]};
 const {api,calls,html}=await render([item],{settings:{0:{exemptSwitch:0},278:{exemptSwitch:1}}});
 assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;b&gt;label/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script|<svg|<img|<b>label/);api.selectBrand(1);assert.equal(calls.length,2);assert.match(api.render(),/配置三方关联/);
});
