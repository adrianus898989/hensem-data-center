// Real host + manager + generated approved names; synthetic server projections.
// These tests count actual transport calls, never infer production latency.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let prefix=fs.readFileSync(path.join(__dirname,'admin-provider-historical-routing.test.cjs'),'utf8').split(/\ntest\(/)[0];
prefix=prefix.replace("extraModules:['live-statistic-windows.js'","extraModules:['live-provider-aliases.js','live-statistic-windows.js'");
const {fixture,platforms,prepared}=new Function('require','__dirname',prefix+';return{fixture,platforms,prepared};')(require,__dirname);
const copy=x=>JSON.parse(JSON.stringify(x)),count=h=>h.calls.filter(q=>q.action==='aggregatePrepared').length;
function server(q){const out=prepared(q);for(const item of out.items){
 const current=item.result,scope={...item.request};delete scope.providers;
 const newwin={...current.groups.provider[0],provider:'NewWinPay'},tuk={...newwin,provider:'TukPay',all_amount:'9007199254740993.0000000000001',success_amount:null};
 const present=item.request.platformId===platforms[0].id,rows=present?[newwin,tuk]:[newwin],base={...current};delete base.groups;delete base.summary;delete base.total;
 const zero={summary:[],total:0},tukFacts=present?{summary:[{...tuk,provider:null}],total:14}:zero;
 const all={summary:current.summary,total:current.total},first={summary:[{...newwin,provider:null}],total:14};
 const entries=[{indices:[0],result:first},{indices:present?[1]:[],result:tukFacts},{indices:rows.map((_,i)=>i),result:all}],names=[['NewWinPay',0],...(present||q.providerReuseNames?.includes('TukPay')?[['TukPay',1]]:[])];
 item.publication.kind='daily_provider_rollup';item.providerReuse={version:1,scope,base,providers:rows,names,entries,all:2};
 const selected=item.request.providers?.includes('TukPay')?1:2;
 item.result={...copy(base),...copy(entries[selected].result),groups:{provider:entries[selected].indices.map(i=>copy(rows[i]))}};
 }return out;}
async function ready(options={}){const h=await fixture(options);h.setNow('2026-10-18T12:00:00Z');for(const[k,v]of Object.entries({from:'2026-10-11T00:00:00',to:'2026-10-17T23:59:59',successFrom:'2026-10-11T00:00:00',successTo:'2026-10-17T23:59:59'}))h.c.liveMetricTimeSet(k,v);return h;}

test('cold unresolved options do not block ALL and first Tuk uses the admitted server projections with zero new prepared HTTPs',async()=>{
 let release;const held=new Promise(r=>release=r);const h=await ready({handler:q=>q.action==='providerOptions'?held:q.action==='aggregatePrepared'?server(q):undefined});
 assert.equal(h.L.providerOptions.length,0);h.c.liveProvider('');await h.c.liveQuery();assert.equal(h.L.providerOptionsBusy,true);const before=count(h);assert.equal(before,12);
 const packets=h.calls.filter(q=>q.action==='aggregatePrepared');assert(packets.every(q=>q.providerReuseNames.includes('TukPay')));assert(packets.every(q=>!q.providerReuseNames.includes('三方名称')));assert(packets.every(q=>q.requests.every(r=>r.providerReuseNames===undefined)));
 const clocks=JSON.stringify(h.L.results.map(r=>r._preparedPublication));h.c.liveProvider('TukPay');await h.c.liveQuery();assert.equal(count(h),before);assert.equal(h.L.results.length,18);assert.equal(h.L.comparisonResults.length,18);
 assert.equal(h.L.results[0].groups.provider[0].all_amount,'9007199254740993.0000000000001');assert.equal(h.L.results[0].groups.provider[0].success_amount,null);assert(h.L.results.slice(1).every(r=>r.groups.provider.length===0&&r.total===0));assert.equal(JSON.stringify(h.L.results.map(r=>r._preparedPublication)),clocks);
 release({providers:['NewWinPay','TukPay']});await new Promise(r=>setTimeout(r,0));assert.equal(count(h),before);
});
test('an unapproved unknown name still calls the authoritative server rather than inventing a zero',async()=>{
 const h=await ready({handler:q=>q.action==='providerOptions'?{providers:[]}:q.action==='aggregatePrepared'?server(q):undefined});h.c.liveProvider('');await h.c.liveQuery();const before=count(h);
 h.c.liveProvider('UnconfirmedSyntheticPay');await h.c.liveQuery();assert.equal(count(h),before+12);assert(h.calls.filter(q=>q.action==='aggregatePrepared').slice(-12).every(q=>q.requests.every(r=>r.providers.includes('UnconfirmedSyntheticPay'))));
});
test('existing name-count and UTF8 limits omit optional hints without changing or failing financial requests',async()=>{
 for(const options of[Array.from({length:201},(_,i)=>'SYNTHETIC-'+i),Array.from({length:100},(_,i)=>'界'.repeat(90)+i)]){
  const h=await ready({handler:q=>q.action==='providerOptions'?{providers:options}:q.action==='aggregatePrepared'?server(q):undefined});h.L.providerOptions=options.slice();h.L.providerOptionsKey=JSON.stringify([platforms.map(p=>p.id).sort(),'charge']);h.c.liveProvider('');await h.c.liveQuery();
  const calls=h.calls.filter(q=>q.action==='aggregatePrepared');assert.equal(calls.length,12);assert(calls.every(q=>q.providerReuseNames===undefined));assert(calls.every(q=>q.requests.every(r=>r.providerReuseNames===undefined&&r.providers===undefined)));assert.equal(h.L.results.length,18);assert.equal(h.L.queryFailures.length,0);
 }
});
test('generated canonical hints enumerate fresh country-only approved values and never alter canonical interpretation',()=>{
 const c={};c.window=c;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-provider-aliases.js'),'utf8'),c);const api=c.HensemProviderNames;
 const india=[...api.canonicalNames('印度')];assert(india.includes('TukPay'));assert(!india.includes('三方名称'));assert.deepEqual([...api.canonicalNames('IN')],india);assert.deepEqual([...api.canonicalNames('香港')],india);assert.deepEqual([...api.canonicalNames('UnconfirmedCountry')],[]);assert(!api.canonicalNames('印尼').includes('TukPay'));
 const next=api.canonicalNames('印度');next.length=0;assert(api.canonicalNames('印度').includes('TukPay'));assert.equal(api.canonical('UnconfirmedSyntheticPay','印度'),'UnconfirmedSyntheticPay');assert.equal(api.canonical('NewWinPay2INR-PaytmQR','印度'),'NewWinPay');assert.equal(api.canonical('T3Pay','印度'),'T3Pay');
});
