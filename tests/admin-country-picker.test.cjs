/* Real shared pages and native identities; synthetic transport only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle,deferred,P}=new Function('require','__dirname',prefix+';return {harness,settle,deferred,P};')(require,__dirname);
const platforms=[{...P,id:'sa',country:'南美',scopeGroup:'SA',name:'LEGACY-SOURCE',team:'M8'},...['印度','哥伦比亚','墨西哥','智利'].map((country,i)=>({...P,id:'country-'+i,country,name:'SOURCE-'+i,team:'M8',scopeGroup:['IN','CO','MX','CL'][i]}))];
const plain=v=>JSON.parse(JSON.stringify(v));
async function setup(page='auto_withdraw'){let api;const h=harness({page,platforms,reports:true,beforeLive(c){const create=c.HensemLiveWithdrawPages.create;c.HensemLiveWithdrawPages.create=config=>api=create(config)}});await settle();return {...h,api};}
function choices(html,pattern){const match=html.match(pattern);assert(match,'country picker exists');return match[1];}
function assertCountries(html){assert.doesNotMatch(html,/>南美<|value="南美"|value="SA"/);for(const c of ['印度','哥伦比亚','墨西哥','智利'])assert.match(html,new RegExp('>'+c+'</option>'));}
test('country choices remove only the regional bucket without mutating native country or scope identity',async()=>{
 const h=await setup(),api=h.c.HensemLiveReportData;
 assertCountries(choices(h.api.render(),/<select[^>]*onchange="withdrawCountry\(this.value\)"[^>]*>([\s\S]*?)<\/select>/));
 assert.deepEqual(plain(h.L.catalog),platforms);assert.equal(api.normalizeIdentity(platforms[0]).identityCountry,'南美');assert.equal(api.normalizeIdentity(platforms[0]).scopeGroup,'SA');
});
test('all shared reporting filters retain the individual countries and hide the regional choice',async()=>{
 const h=await setup('overview');
 for(const page of ['overview','providers','provider_payout','collection','payout','time','amount','matrix','provider_daily','risk','orders','teamops','merchants']){
  h.c.setPage(page);h.c.render();assertCountries(choices(h.nodes.get('liveFilters').innerHTML,/<select[^>]*id="live-country"[^>]*>([\s\S]*?)<\/select>/));
 }
});
test('withdrawal and operator filters reject a retained regional choice without loading a different country',async()=>{
 for(const page of ['auto_withdraw','withdraw_operators']){
  const h=await setup(page);h.L.country='南美';h.c.render();const options=choices(h.api.render(),/<select[^>]*onchange="withdrawCountry\(this.value\)"[^>]*>([\s\S]*?)<\/select>/);
  assertCountries(options);assert.match(options,/<option value="" selected disabled>请选择国家/);
  const before=h.calls.length;await h.c.liveQuery();assert.equal(h.calls.length,before);assert.equal(h.api.state.loading,false);assert.match(h.api.state.error,/请选择具体国家/);assert.equal(h.L.country,'南美');
  h.c.withdrawTeam('M8');assert.equal(h.L.country,'');assert.equal(h.calls.length,before);await h.c.liveQuery();assert.equal(h.calls.length,before);assert.equal(h.L.country,'','cleared retired selection must not silently choose another country');
  h.c.withdrawCountry('哥伦比亚');assert.equal(h.L.country,'哥伦比亚');h.c.withdrawCountry('SA');assert.equal(h.L.country,'哥伦比亚');
 }
});
test('old shared filter snapshots cannot make regional requests or display another country as selected',async()=>{
 const h=await setup('providers');h.L.country='SA';h.c.render();const options=choices(h.nodes.get('liveFilters').innerHTML,/<select[^>]*id="live-country"[^>]*>([\s\S]*?)<\/select>/);
 assert.match(options,/value=""[^>]*>请选择国家/);assertCountries(options);const before=h.calls.length;await h.c.liveQuery();assert.equal(h.calls.length,before);assert.equal(h.L.loading,false);assert.match(h.L.error,/请选择具体国家/);assert.equal(h.L.country,'SA');
 h.c.liveReset();assert.equal(h.L.country,'印度');h.c.liveSet('country','南美');assert.equal(h.L.country,'印度');h.c.liveSet('country','智利');assert.equal(h.L.country,'智利');
});
test('retired country clears a pending provider directory and ignores its late response',async()=>{
 const h=await setup('time'),pending=deferred(),cancelled=[],request=h.c.hensemLiveRequest;
 h.c.hensemLiveRequest=q=>q.action==='providerOptions'?pending.promise:request(q);h.c.hensemLiveCancelRequests=actions=>cancelled.push(...actions);
 h.L.providerOptions=['Previously selected country'];h.c.liveSet('direction','withdraw');assert.equal(h.L.providerOptionsBusy,true);
 const serial=h.L.providerOptionsSerial;h.L.country='SA';h.c.liveSet('direction','charge');
 assert(h.L.providerOptionsSerial>serial);assert.equal(h.L.providerOptionsBusy,false);assert.equal(h.L.providerOptionsKey,'');assert.deepEqual(plain(h.L.providerOptions),[]);assert(cancelled.includes('providerOptions'));
 const writes=h.writes.length;pending.resolve({providers:['Late provider from the previous country']});await settle();
 assert.equal(h.writes.length,writes);assert.equal(h.L.providerOptionsBusy,false);assert.deepEqual(plain(h.L.providerOptions),[]);assert.equal(h.L.country,'SA');
});
test('country selection keeps the native query target and does not merge neighboring countries',async()=>{
 const h=await setup();h.c.withdrawCountry('墨西哥');const before=h.calls.length;await h.c.liveQuery();const query=h.calls.slice(before).find(q=>q.action==='autoWithdraw');assert(query);assert.equal(query.country,'墨西哥');assert.equal(query.scopeTargets,undefined);assert.equal(h.L.catalog.find(p=>p.id==='sa').country,'南美');
});
test('workorder and deposit filters omit the bucket and old values cannot issue record reads',async()=>{
 for(const page of ['workorders','deposit_tracking']){
  const h=await setup(page);h.L.pageQueried=true;h.c.render();
  if(page==='workorders'){
   assertCountries(choices(h.html(),/<select[^>]*aria-label="国家 \/ 地区"[^>]*>([\s\S]*?)<\/select>/));
   h.c.workorderOperationsSet('country','南美');const before=h.calls.length;await h.c.workorderOperationsLoad(true);assert.equal(h.calls.length,before);assert.match(h.html(),/请选择具体国家/);
  }else{
   assertCountries(choices(h.html(),/<select[^>]*onchange="depositIssuesSet\('country',this.value\)"[^>]*>([\s\S]*?)<\/select>/));
   h.L.country='南美';const before=h.calls.length;await h.c.liveQuery();assert.equal(h.calls.length,before);assert.match(h.L.depositIssuesError,/请选择具体国家/);
  }
 }
});
test('configuration searches reject old regional filters while retaining native records for administration',async()=>{
 for(const [page,key,load]of [['provider_config','providerConfigCountry','providerConfigLoad'],['teams','teamPlatformCountry','platformAssignmentsLoad']]){
  const h=await setup(page);h.L[key]='南美';const before=h.calls.length;await h.c[load](true);assert.equal(h.calls.length,before);assert.match(h.L[page==='teams'?'platformAssignmentsError':'providerConfigError'],/请选择具体国家/);assert.equal(h.L.catalog[0].scopeGroup,'SA');
 }
});
