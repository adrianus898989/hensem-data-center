const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,P,aggregate}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,P,aggregate};')(require,__dirname);
const available=h=>[...h.L.providerOptions,...h.L.providerObservedOptions];
const p2={...P,id:'22222222-2222-4222-8222-222222222222',name:'Other',sourceName:'Other'};
function result(p=P,name='RAPayINR-QR'){const r=aggregate(p,5);r.groups.provider[0].provider=name;r.groups.daily[0].provider=name;return r;}
function dataHandler(options={}){return q=>{if(q.action==='catalog')return {platforms:options.platforms||[P]};if(q.action==='providerOptions')return options.options?options.options(q):{providers:['ATPay']};if(q.action==='rates')return {rows:[],total:0};if(q.action==='workorders')return {rows:[],byProvider:[],total:0,summary:{},byDirection:{}};return options.result?options.result(q):result((options.platforms||[P]).find(p=>p.id===q.platformId)||P);};}
async function setup(options={}){const h=harness({page:'overview',ancillaryHandler:true,platforms:options.platforms,handler:dataHandler(options)});await settle();Object.assign(h.L,{from:'2026-09-22T00:00:00',to:'2026-09-22T05:59:59',country:'印度',direction:'charge',dirty:true});return h;}
async function queried(options={}){const h=await setup(options);await h.c.liveQuery();await settle();return h;}
test('late directory cannot remove a provider already returned by this query',async()=>{
 const wait=deferred(),h=await setup({options:()=>wait.promise});await h.c.liveQuery();await settle();assert(available(h).includes('RAPay'));
 wait.resolve({providers:['3TPay','3cPay','99Pay','ATPay','ArbPay']});await settle();assert(available(h).includes('RAPay'));
 assert.equal(h.calls.filter(q=>q.action==='providerOptions').length,1);assert.equal(h.L.results[0].groups.provider[0].provider,'RAPayINR-QR');assert.match(h.nodes.get('liveFilters').innerHTML,/name="live-choice-provider" value="RAPay"/);
});
test('filtering one provider does not narrow the selectable directory or previous observed names',async()=>{
 const h=await queried({options:()=>({providers:['ATPay','ArbPay']})});h.c.liveProvider('ATPay');h.setHandler(dataHandler({result:()=>result(P,'ATPay')}));await h.c.liveQuery();await settle();assert(available(h).includes('RAPay'));assert(available(h).includes('ArbPay'));
});
test('date-only edits keep date-independent options without metadata or business reload',async()=>{
 const h=await queried(),before=h.calls.length;h.c.liveSet('from','2026-09-21T00:00:00');h.c.render();assert(available(h).includes('RAPay'));assert.equal(h.calls.length,before);
});
test('platform change cannot carry observed names from a different platform',async()=>{
 const h=await setup({platforms:[P,p2]});h.c.liveSet('platform',P.id);await settle();await h.c.liveQuery();await settle();assert(available(h).includes('RAPay'));h.c.liveSet('platform',p2.id);await settle();assert(!available(h).includes('RAPay'));
});
test('late metadata response cannot repopulate a replaced native scope',async()=>{
 const old=deferred(),h=await setup({platforms:[P,p2],options:q=>q.platformIds.length>1?old.promise:{providers:['OtherPay']}});h.c.liveSet('platform',p2.id);await settle();old.resolve({providers:['RAPay']});await settle();assert(!available(h).includes('RAPay'));assert(available(h).includes('OtherPay'));
});
test('same-id native source replacement clears observed providers',async()=>{const h=await queried();assert(available(h).includes('RAPay'));h.L.catalog[0]={...h.L.catalog[0],sourceName:'replacement-native'};h.c.render();assert(!available(h).includes('RAPay'));});
test('authority changes invalidate directory and observed providers',async()=>{const h=await queried();assert(available(h).includes('RAPay'));h.c.hensemDataScope={mode:'selected',identity:'changed-account-scope'};h.c.render();assert(!available(h).includes('RAPay'));});
test('Reset clears observation evidence without changing aliases',async()=>{const h=await queried();assert(available(h).includes('RAPay'));h.c.liveReset();await settle();assert(!h.L.providerObservedOptions.includes('RAPay'));assert.equal(h.c.HensemProviderNames.canonical('RAPayINR-QR','印度'),'RAPay');assert.equal(h.c.HensemProviderNames.canonical('RAPay2INR','印度'),'RAPay');assert.equal(h.c.HensemProviderNames.canonical('MoneyPay-QR','印度'),'MoneyPay');});
test('restoring the same authorized tab keeps its known options without refetching data',async()=>{const h=await queried();const before=h.calls.length;h.c.setPage('time');h.c.setPage('overview');await settle();assert(available(h).includes('RAPay'));assert.equal(h.calls.length,before);});
const publishedPrefix=fs.readFileSync(path.join(__dirname,'admin-provider-published-navigation.test.cjs'),'utf8').split(/\ntest\(/)[0];
const published=new Function('require','__dirname',publishedPrefix+';return {setup,settle,envelope};')(require,__dirname);
test('validated unprojected publication supplies options and a local provider filter cannot narrow them',async()=>{const h=await published.setup({handler:q=>{if(q.action==='providerOptions')return {providers:['ATPay']};if(q.action==='providerSnapshot'){const b=published.envelope(q);b.platforms[0].current.orders.groups.provider[0].provider='RAPayINR-QR';b.platforms[0].previous.orders.groups.provider[0].provider='RAPayINR-QR';return b;}}});await h.c.liveQuery();await settle();assert.equal(h.L.providerReadMode,'published');assert(h.L.providerObservedOptions.includes('RAPay'));h.c.document.querySelectorAll=()=>[];h.c.liveMultiToggle({isConnected:true,dataset:{multi:'provider'},open:true});await settle();assert(h.L.providerOptions.includes('ATPay'));h.c.liveProvider('ATPay');await h.c.liveQuery();await settle();assert(h.L.providerObservedOptions.includes('RAPay'));assert.equal(h.calls.filter(q=>q.action==='providerSnapshot').length,1);});
test('directory denial clears known names while an ordinary outage preserves observed evidence',async()=>{for(const code of ['ADMIN_LIVE_PERMISSION_DENIED','42501','offline network']){const wait=deferred(),h=await setup({options:()=>wait.promise});await h.c.liveQuery();await settle();assert(h.L.providerObservedOptions.includes('RAPay'));wait.reject(Object.assign(Error('safe directory failed'),{code}));await settle();assert.equal(h.L.providerObservedOptions.includes('RAPay'),code==='offline network');assert.equal(h.L.providerOptionsBusy,false);assert(h.L.providerOptionsError);assert.equal(h.calls.filter(q=>q.action==='providerOptions').length,1);}});
