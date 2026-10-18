// Actual UI + exact manager; no JavaScript financial projection and no live latency claim.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-provider-historical-routing.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {fixture,platforms,prepared}=new Function('require','__dirname',prefix+';return {fixture,platforms,prepared};')(require,__dirname);
const ready=async()=>{const h=await fixture();h.setNow('2026-10-18T12:00:00Z');for(const [key,value]of Object.entries({from:'2026-10-11T00:00:00',to:'2026-10-17T23:59:59',successFrom:'2026-10-11T00:00:00',successTo:'2026-10-17T23:59:59'}))h.c.liveMetricTimeSet(key,value);return h;};
const count=h=>h.calls.filter(q=>q.action==='aggregatePrepared').length;
const provider=async(h,name)=>{h.c.liveProvider(name);await h.c.liveQuery();};
test('18-platform provider revisit after slow supplementary time reuses its exact main and previous-period results',async()=>{
 const h=await ready();await provider(h,'NewWinPay');const first=count(h),before=JSON.stringify(h.L.results.map(r=>r._preparedPublication));assert.equal(first,12);
 h.setNow('2026-10-18T12:00:40Z');await provider(h,'TukPay');assert.equal(count(h),first+12,'an unseen provider still uses the authoritative server projection');
 h.setNow('2026-10-18T12:01:20Z');await provider(h,'NewWinPay');assert.equal(count(h),first+12);assert.equal(JSON.stringify(h.L.results.map(r=>r._preparedPublication)),before);assert.equal(h.L.results.length,18);
});
test('narrowing native platforms after a minute reuses only their exact complete publications',async()=>{
 const h=await ready();await provider(h,'TukPay');const first=count(h);h.setNow('2026-10-18T12:01:00Z');h.c.liveSet('platform',platforms[0].id);await h.c.liveQuery();assert.equal(count(h),first);assert.equal(h.L.results.length,1);assert.equal(h.L.results[0].platform.id,platforms[0].id);
});
test('history reuse expires at the original five-minute receipt and refresh explicitly reads again',async()=>{
 const h=await ready();await provider(h,'TukPay');const first=count(h);h.setNow('2026-10-18T12:04:59Z');await h.c.liveQuery();assert.equal(count(h),first);
 h.setNow('2026-10-18T12:05:00Z');await h.c.liveQuery();assert.equal(count(h),first+12);await h.c.liveRefresh();assert.equal(count(h),first+24);assert(h.calls.some(q=>q.action==='aggregatePrepared'&&q.forceRefresh));
});
test('different success clock, native catalog and account permission cannot consume an earlier exact history result',async()=>{
 for(const kind of ['success','native','account']){const h=await ready();await provider(h,'TukPay');const first=count(h);h.setNow('2026-10-18T12:01:00Z');
  if(kind==='success')h.c.liveMetricTimeSet('successFrom','2026-10-10T00:00:00');
  if(kind==='native'){h.L.catalog=h.L.catalog.map(p=>p.id===platforms[0].id?{...p,capabilities:{revision:'changed'}}:p);h.c.liveSet('platform',platforms[0].id);}
  if(kind==='account')h.c.hensemDataScope={identity:'different-account',mode:'all'};
  await h.c.liveQuery();assert(count(h)>first,kind);
 }
});
test('intraday and unequal dual windows keep the original short retention',async()=>{
 for(const kind of ['intraday','unequal']){const h=await ready();if(kind==='intraday'){h.c.liveMetricTimeSet('to','2026-10-17T11:59:59');h.c.liveMetricTimeSet('successTo','2026-10-17T11:59:59');}else h.c.liveMetricTimeSet('successFrom','2026-10-10T00:00:00');await provider(h,'TukPay');const first=count(h);h.setNow('2026-10-18T12:00:31Z');await h.c.liveQuery();assert(count(h)>first,kind);}
});

function packed(payload){const response=prepared(payload);for(const item of response.items){const native=item.result.platform,scope={...item.request};delete scope.providers;const newwin={...item.result.groups.provider[0],provider:'NewWinPay'},tuk={...newwin,provider:'TukPay',all_amount:'9007199254740993.0000000000009',success_amount:null};const base={...item.result};delete base.groups;delete base.summary;delete base.total;item.publication.kind='daily_provider_rollup';item.providerReuse={version:1,scope,base,providers:[newwin,tuk],names:[['NewWinPay',0],['NewWinPay2INR-PaytmQR',0],['TukPay',1]],entries:[{indices:[0],result:{summary:[{...newwin,provider:null}],total:newwin.all_count}},{indices:[1],result:{summary:[{...tuk,provider:null}],total:tuk.all_count}},{indices:[0,1],result:{summary:item.result.summary,total:item.result.total}}],all:2};}return response;}
test('actual 18-platform UI changes to a first-unseen single provider with zero new prepared HTTPs',async()=>{
 const h=await ready();h.override(q=>q.action==='aggregatePrepared'?packed(q):undefined);await provider(h,'NewWinPay');const first=count(h);assert.equal(first,12);const clocks=JSON.stringify(h.L.results.map(r=>r._preparedPublication));h.setNow('2026-10-18T12:00:45Z');await provider(h,'TukPay');assert.equal(count(h),first);assert.equal(h.L.results.length,18);assert(h.L.results.every(r=>r.groups.provider[0].provider==='TukPay'));assert(h.L.results.every(r=>r.groups.provider[0].success_amount===null));assert.equal(JSON.stringify(h.L.results.map(r=>r._preparedPublication)),clocks);
 h.c.liveSet('platform',platforms[0].id);await h.c.liveQuery();assert.equal(count(h),first);assert.equal(h.L.results.length,1);await h.c.liveRefresh();assert(count(h)>first);
});

test('already loaded visible zero-order options reach each native only as bounded top-level metadata',async()=>{
 const h=await ready();h.L.providerOptions=['NewWinPay','TukPay'];h.L.providerOptionsKey=JSON.stringify([platforms.map(p=>p.id).sort(),'charge']);h.override(q=>{if(q.action!=='aggregatePrepared')return;const r=packed(q);for(const item of r.items){item.providerReuse.providers=item.providerReuse.providers.slice(0,1);item.providerReuse.entries[1]={indices:[],result:{summary:[],total:0}};item.providerReuse.names=item.providerReuse.names.filter(([name])=>name!=='TukPay');if(q.providerReuseNames?.includes('TukPay'))item.providerReuse.names.push(['TukPay',1]);}return r;});
 await provider(h,'NewWinPay');const first=count(h);const transport=h.calls.filter(q=>q.action==='aggregatePrepared');assert(transport.every(q=>q.providerReuseNames.includes('TukPay')));assert(transport.every(q=>q.requests.every(r=>r.providerReuseNames===undefined)));await provider(h,'TukPay');assert.equal(count(h),first);assert.equal(h.L.results.length,18);assert(h.L.results.every(r=>r.groups.provider.length===0&&r.total===0));
});

test('successful native-provider configuration invalidates prepared packets before catalog refresh, even if refresh fails',async()=>{
 for(const refreshFails of [false,true]){const h=await ready();h.L.providerOptions=['NewWinPay','TukPay'];h.override(q=>q.action==='aggregatePrepared'?packed(q):undefined);await provider(h,'NewWinPay');const first=count(h);h.c.setPage('provider_config');h.L.providerConfig={canManage:true,rows:[{country:'印度',platform:platforms[0].name,rawProvider:'RawPay',canonicalProvider:'ConfirmedPay',version:3}],options:{canonicalProviders:['ConfirmedPay']}};
 h.override(q=>q.action==='aggregatePrepared'?packed(q):q.action==='configurationWrite'?{ok:true}:q.action==='providerConfig'?h.L.providerConfig:q.action==='catalog'?refreshFails?(()=>{throw Error('Synthetic directory refresh failed')})():{platforms}:undefined);
 h.c.configEditProvider(0);const host=h.nodes.get('liveConfigDialog'),query=host.querySelector.bind(host),values={canonicalProvider:'ConfirmedPay'};host.querySelector=key=>key==='form'?{reportValidity:()=>true}:key.startsWith('#config-')?{value:values[key.slice(8)]||''}:query(key);await h.c.configSave();h.c.setPage('providers');await h.c.liveQuery();assert(count(h)>first);assert.equal(h.calls.filter(q=>q.action==='configurationWrite').length,1);
 }
});
