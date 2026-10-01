const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-payout-config.js'),'utf8');
const target=(platform='P1',country='IN')=>({platform,country_code:country,country_name:'印度',display_group:country,display_name:'印度',timezone:'Asia/Kolkata',members:[{site_code:'11',name:'品牌一'}]});
const index=(system,targets=[target()])=>({version:1,system,targets,summaries:targets.map(t=>({...t,observed_local_date:'2026-09-22'})),readOnly:true});
const snap=(system,t,configuration,dictionary=null)=>({version:1,system,target:t,snapshot:{country_code:t.country_code,platform:t.platform,timezone:t.timezone,observed_local_date:'2026-09-22',observed_at:'2026-09-22T06:00:00Z',configuration,dictionary},readOnly:true});
function harness(request){const context={window:{}};vm.runInNewContext(source,context);const api=context.window.HensemLivePayoutConfig;let changes=0;api.configure({request,onChange:()=>changes++});return {api,changes:()=>changes};}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const normalize=x=>JSON.parse(JSON.stringify(x));
test('WG exact config navigation uses source keys while other systems keep their platform names',async()=>{
 for(const rawField of ['sourceName','source_name']){
  const calls=[],t={...target('98VV','VN'),country_name:'越南',display_group:'VN',display_name:'越南'};
  const {api}=harness(async q=>{calls.push(normalize(q));return q.operation==='index'?index(q.system,[t]):snap(q.system,t,{})});
  api.openTarget({system:'WG',country:'VN',platform:'98VV.COM',[rawField]:'98VV'});await api.loadIndex();assert.equal(calls.length,2);assert.equal(calls[1].platform,'98VV');assert.equal(calls[1].country,'VN');
 }
 const calls=[],t=target('DISPLAY');const {api}=harness(async q=>{calls.push(normalize(q));return q.operation==='index'?index(q.system,[t]):snap(q.system,t,{fields:[],groups:[]})});api.openTarget({system:'AR',country:'IN',platform:'DISPLAY',sourceName:'RAW'});await api.loadIndex();assert.equal(calls[1].platform,'DISPLAY');
});
test('only host request API, no fetch/storage/auth/write controls or embedded source values',()=>{assert.doesNotMatch(source,/\bfetch\s*\(|localStorage|sessionStorage|access_token|supabaseUrl|\.rpc\(/);assert.doesNotMatch(source,/action:'(save|update|delete)'/);assert(source.includes("action:'payoutConfig'"));});
test('a targeted load preserves exact selection; default pagination 20 and readonly AR values preserve zero, false and unknown',async()=>{const calls=[];const targets=Array.from({length:25},(_,i)=>target('P'+i));const {api}=harness(async r=>{calls.push(normalize(r));return r.operation==='index'?index(r.system,targets):snap(r.system,targets.find(t=>t.platform===r.platform),{fields:[{key:'autoWithdraw',kind:'boolean',value:false,available:true},{key:'withdrawAmount',kind:'number',value:0,available:true},{key:'totalLoss',value:null,available:false}],groups:[]})});await api.loadIndex();assert.deepEqual(calls,[{action:'payoutConfig',operation:'index',system:'AR'},{action:'payoutConfig',operation:'snapshot',system:'AR',country:'IN',platform:'P0'}]);let html=api.render();assert(html.includes('观测日期 2026-09-22'));assert(html.includes('采集时配置快照'));assert(html.includes('1–20'));assert(!html.includes('<strong>P24</strong>'));assert(html.includes('>0</span>'));assert(html.includes('否（只读）'));assert(html.includes('页面未提供'));api.setPage(2);html=api.render();assert(html.includes('21–25'));assert(html.includes('<strong>P24</strong>'));assert.equal(calls.length,2);});
test('escaped platform/field strings cannot create elements or attribute callbacks',async()=>{const t=target('<img src=x onerror=alert(1)>');const {api}=harness(async r=>r.operation==='index'?index(r.system,[t]):snap(r.system,t,{fields:[{key:'autoWithdraw',kind:'boolean',available:true,value:true},{key:'withdrawAmount',available:true,value:'</script><svg onload=alert(1)>'}],groups:[]}));await api.loadIndex();const h=api.render();assert(h.includes('&lt;img'));assert(h.includes('&lt;/script&gt;'));assert(!h.includes('<svg'));assert(!h.includes('<img'));assert(!/onclick="[^"]*alert/.test(h));});
test('Panda amount unit conversion only verified fields; channel dictionary requires same target and withdrawal type',async()=>{const t=target();const c={values:{autoWithdrawalSwitch:false,autoWithdrawalAmountMix:12345,autoWithdrawDailyLimit:12345.9,autoWithdrawalLimitType:'validBet',autoWithdrawalLimitAmount:3,successRateType:'Number',autoWithdrawalChannel:[{withdrawalChannelId:1,tenantWithdrawTypeId:2,tenantWithdrawTypeName:'BANK',pullOffType:'Manual'}]},unavailable_fields:[]};let dictionary={country_code:'IN',platform:'OTHER',channels:[{id:1,withdraw_type_id:2,name:'WRONG'}]};const {api}=harness(async r=>r.operation==='index'?index(r.system,[t]):snap(r.system,t,c,dictionary));await api.loadIndex('PANDA');let h=api.render();assert(h.includes('123.45'));assert(h.includes('>3</span>'));assert(h.includes('按接单量成功率'));assert(!h.includes('WRONG'));assert(h.includes('通道 ID：1'));dictionary={country_code:'IN',platform:'P1',channels:[{id:1,withdraw_type_id:3,name:'WRONG-TYPE'},{id:1,withdraw_type_id:2,name:'Correct'}]};await api.loadIndex();h=api.render();assert(h.includes('Correct'));assert(!h.includes('WRONG-TYPE'));});
test('NewAR displays safe channels and rule groups without source URL column',async()=>{const t=target();const {api}=harness(async r=>r.operation==='index'?index(r.system,[t]):snap(r.system,t,{fields:[{key:'autoWithdraw',kind:'boolean',available:true,value:true}],channels:[{id:1,channelName:'Channel',channelType:'BANK'}],channelRules:[{id:2,name:'Rule'}],settingGroups:[{id:3,configName:'Group',maxWithdrawAmount:100}]}));await api.loadIndex('NEW_AR');const h=api.render();assert(h.includes('渠道列表'));assert(h.includes('Group'));assert(h.includes('提现金额'));assert(!h.includes('渠道地址'));});
test('WG brand switching is local; values do not inherit; unverified codes not labeled on/off',async()=>{let calls=0;const t=target();const {api}=harness(async r=>{calls++;return r.operation==='index'?index(r.system,[t]):snap(r.system,t,{settings:{0:{exemptSwitch:0,unavoidableCauseRemarkSwitch:1,registerTime:2},11:{exemptSwitch:1,levelIds:[1]}},dictionaries:{levels:[{level_id:1,name:'LV1'}],tags:[]},completeness:{unavailable:['games']}})});await api.loadIndex('WG');let h=api.render();assert(h.includes('开关映射未核实'));assert(h.includes('时间选项原码未核实'));assert(h.includes('关闭（只读）'));api.selectBrand(1);h=api.render();assert(h.includes('开启（只读）'));assert(h.includes('LV1'));assert(h.includes('接口未提供'));assert.equal(calls,2);});
test('Game66 safe table renders rule flags and values with no payload/remarks columns',async()=>{const t=target('HK1','GAME66_HK');const {api}=harness(async r=>r.operation==='index'?index(r.system,[t]):snap(r.system,t,{rules:[{rule_id:1,title:'Threshold',operator:'>=',value:0,effective_type_text:'所有',enabled:false}]}));await api.loadIndex('GAME66_HK');const h=api.render();assert(h.includes('自动出款审核规则'));assert(h.includes('Threshold'));assert(h.includes('关闭（只读）'));assert(!h.includes('raw_payload'));});

const systems=['AR','NEW_AR','PANDA','WG','GAME66_HK','GAME66_RED_CRAB'];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const config=value=>({fields:[{key:'withdrawAmount',available:true,value}],groups:[]});
function allFixture(extra={}){
 const calls=[],targets={AR:[target('A1'),target('A2'),target('BR1','BR')],NEW_AR:[target('N1')],PANDA:[],WG:[],GAME66_HK:[],GAME66_RED_CRAB:[],...extra};
 const request=async q=>{calls.push(normalize(q));return q.operation==='index'?index(q.system,targets[q.system]):snap(q.system,targets[q.system].find(t=>t.country_code===q.country&&t.platform===q.platform),config(q.platform));};
 return {calls,targets,request};
}
test('one explicit query loads every authorized system/country/platform with bounded concurrency',async()=>{
 const f=allFixture(),pending=deferred();let active=0,max=0;const {api}=harness(async q=>{active++;max=Math.max(max,active);await pending.promise;try{return await f.request(q)}finally{active--}});
 const run=api.refresh();assert.equal(api.refresh(),run,'double clicks share the same in-flight query');pending.resolve();await run;
 assert.equal(max,3);assert.deepEqual(f.calls.filter(q=>q.operation==='index').map(q=>q.system).sort(),systems.slice().sort());
 assert.deepEqual(f.calls.filter(q=>q.operation==='snapshot').map(q=>q.system+'/'+q.country+'/'+q.platform).sort(),['AR/BR/BR1','AR/IN/A1','AR/IN/A2','NEW_AR/IN/N1']);assert.equal(api.state().completed,4);assert.equal(api.state().failed,0);
});
test('system, country, platform and search changes reuse loaded data and preserve each system selection',async()=>{
 const f=allFixture(),{api}=harness(f.request);await api.refresh();const before=f.calls.length;
 api.selectPlatform(1);assert.equal(api.state().platform,'A2');assert.match(api.render(),/>A2<\/span>/);api.selectCountry(1);assert.equal(api.state().platform,'BR1');assert.match(api.render(),/>BR1<\/span>/);
 api.selectSystem(1);assert.equal(api.state().platform,'N1');assert.equal(api.state().snapshotStatus,'ready');api.selectSystem(0);assert.equal(api.state().country,'BR');assert.equal(api.state().platform,'BR1');
 api.selectCountry(0);api.setSearch('A2');await api.query();assert.equal(api.state().platform,'A2');assert.equal(api.state().snapshotStatus,'ready');assert.equal(f.calls.length,before);
});
test('leaving the page while fetching keeps results and the background query finishes for return',async()=>{
 const f=allFixture(),pending=deferred(),{api}=harness(async q=>{if(q.operation==='snapshot')await pending.promise;return f.request(q)});const run=api.refresh();await tick();api.pause();api.selectSystem(1);pending.resolve();await run;assert.equal(api.state().platform,'N1');assert.equal(api.state().snapshotStatus,'ready');api.selectSystem(0);assert.equal(api.state().platform,'A1');assert.match(api.render(),/>A1<\/span>/);
});
test('refresh preserves selected platform and updates cached values; transient failure preserves last success',async()=>{
 const f=allFixture();let revision=1,broken=false;const {api}=harness(async q=>{const r=await f.request(q);if(q.operation==='snapshot'){if(broken&&q.platform==='A2')throw Error('timeout');r.snapshot.configuration=config('VERSION '+revision);}return r;});
 await api.refresh();api.selectPlatform(1);revision=2;await api.refresh();assert.equal(api.state().platform,'A2');assert.match(api.render(),/VERSION 2/);broken=true;revision=3;await api.refresh();assert.equal(api.state().snapshotStatus,'ready');assert.match(api.render(),/VERSION 2/);assert.match(api.render(),/显示上次查询结果/);assert.equal(api.state().failed,1);api.selectPlatform(0);assert.match(api.render(),/VERSION 3/);
});
test('index network failure retains that authorized directory while successful index removes revoked platforms',async()=>{
 const f=allFixture();let broken=false;const {api}=harness(async q=>{if(broken&&q.operation==='index'&&q.system==='AR')throw Error('timeout');return f.request(q)});await api.refresh();api.selectPlatform(1);broken=true;await api.refresh();assert.equal(api.state().platform,'A2');assert.match(api.render(),/>A2<\/span>/);assert.match(api.render(),/显示上次查询结果/);broken=false;f.targets.AR=[target('A1')];await api.refresh();assert.equal(api.state().platform,'A1');assert.doesNotMatch(api.render(),/<strong>A2/);
});
test('permission loss clears all cached sources and invalidates outstanding replies',async()=>{
 const f=allFixture(),late=deferred();let denied=false;const {api}=harness(async q=>{if(denied&&q.operation==='index'){if(q.system==='AR')throw Error('403 permission denied');await late.promise;}return f.request(q)});await api.refresh();denied=true;const run=api.refresh();await tick();assert.equal(api.state().indexStatus,'error');assert.match(api.render(),/授权已失效/);assert.doesNotMatch(api.render(),/<strong>A1|>A1<\/span>/);late.resolve();await run;api.selectSystem(1);assert.equal(api.state().indexStatus,'idle');assert.doesNotMatch(api.render(),/<strong>N1/);
});
test('actual host role, scope and expired-session errors clear cached results from index and snapshot reads',async()=>{
 const messages=['当前角色没有此页面或操作权限，请联系管理员','当前角色没有查看明细权限','当前账号没有此范围的归类权限','当前登录账号已改变','登录账号或会话已改变，请使用当前会话','登录已退出，请重新登录','登录状态不完整，请重新登录','正式数据读取未获授权，或会话已失效','角色权限验证未通过，请重新登录或联系管理员。'];
 for(const operation of ['index','snapshot'])for(const message of messages){const f=allFixture();let denied=false;const {api}=harness(async q=>{if(denied&&q.operation===operation)throw Error(message);return f.request(q)});await api.refresh();assert.match(api.render(),/>A1<\/span>/);denied=true;await api.refresh();assert.equal(api.state().indexStatus,'error',message);assert.match(api.render(),/授权已失效/);assert.doesNotMatch(api.render(),/>A1<\/span>|显示上次查询结果/);api.selectSystem(1);assert.equal(api.state().indexStatus,'idle');assert.doesNotMatch(api.render(),/>N1<\/span>/);}
});
test('structured iframe denials revoke cache while temporary auth-network failures retain labeled cached results',async()=>{
 for(const code of ['ROLE_DENIED','refresh_invalid','session_changed','session_logged_out','profile_denied']){const f=allFixture();let denied=false;const {api}=harness(async q=>{if(denied)throw Object.assign(Error('安全错误'),{code});return f.request(q)});await api.refresh();denied=true;await api.refresh();assert.equal(api.state().indexStatus,'error',code);assert.doesNotMatch(api.render(),/>A1<\/span>/);}
 const f=allFixture();let failed=false;const {api}=harness(async q=>{if(failed)throw Object.assign(Error('登录续期暂时失败，请检查网络后重试'),{code:'refresh_network_error'});return f.request(q)});await api.refresh();failed=true;await api.refresh();assert.equal(api.state().snapshotStatus,'ready');assert.match(api.render(),/>A1<\/span>/);assert.match(api.render(),/显示上次查询结果/);
});
test('clear and account request replacement invalidate cached results and late responses',async()=>{
 const f=allFixture(),late=deferred(),{api}=harness(async q=>{await late.promise;return f.request(q)});const run=api.refresh();api.clear();late.resolve();await run;assert.equal(api.state().indexStatus,'idle');api.configure({request:f.request});await api.refresh();assert.equal(api.state().snapshotStatus,'ready');api.configure({request:async q=>index(q.system,[])});assert.equal(api.state().indexStatus,'idle');assert.doesNotMatch(api.render(),/观测日期/);
});
test('null snapshot is visibly uncollected and invalid responses cannot replace an existing snapshot',async()=>{
 const f=allFixture();let invalid=false;const {api}=harness(async q=>{const r=await f.request(q);if(q.operation==='snapshot'&&q.platform==='A1')return invalid?{...r,system:'WRONG'}:{...r,snapshot:null};return r;});await api.refresh();assert.match(api.render(),/尚未采集到配置快照/);invalid=true;await api.refresh();assert.equal(api.state().snapshotStatus,'ready');assert.equal(api.state().failed,1);assert.match(api.render(),/尚未采集到配置快照/);
});
test('openTarget uses exact country and keeps it selected while all authorized configs are loaded',async()=>{
 const f=allFixture({AR:[target('SAME'),target('SAME','BR')]}),{api}=harness(f.request);api.openTarget({system:'AR',country:'BR',platform:'SAME'});assert.equal(f.calls.length,0);await api.refresh();assert.equal(api.state().country,'BR');assert.equal(api.state().platform,'SAME');assert.equal(f.calls.filter(q=>q.operation==='snapshot'&&q.system==='AR').length,2);const before=f.calls.length;api.openTarget({system:'AR',country:'IN',platform:'SAME'});assert.equal(api.state().country,'IN');assert.equal(api.state().snapshotStatus,'ready');assert.equal(f.calls.length,before);
});
test('missing, ambiguous and invalid exact targets never display another platform as the target',async()=>{
 const f=allFixture(),{api}=harness(f.request);api.openTarget({system:'AR',country:'IN',platform:'MISSING'});await api.refresh();assert.equal(api.state().platform,null);assert.match(api.render(),/未找到该平台/);f.targets.AR=[target('SAME'),target('SAME')];api.openTarget({system:'AR',country:'IN',platform:'SAME'});await api.refresh();assert.equal(api.state().platform,null);assert.match(api.render(),/多个配置来源/);const before=f.calls.length;api.openTarget({system:'INVALID',country:'IN',platform:'SAME'});await api.ensureLoaded();assert.equal(f.calls.length,before);assert.match(api.render(),/来源信息不完整/);
});
test('rapid target and source changes do not reroute or discard all-system query responses',async()=>{
 const f=allFixture(),late=deferred(),{api}=harness(async q=>{if(q.system==='AR'&&q.operation==='index')await late.promise;return f.request(q)});api.openTarget({system:'AR',country:'IN',platform:'A1'});const run=api.refresh();api.openTarget({system:'AR',country:'IN',platform:'A2'});late.resolve();await run;assert.equal(api.state().platform,'A2');assert.match(api.render(),/>A2<\/span>/);api.selectSystem(1);assert.equal(api.state().platform,'N1');api.selectSystem(0);assert.equal(api.state().platform,'A2');
});
test('an invalid target remains unresolved when older index and snapshot replies finish, while other systems keep loading',async()=>{
 for(const operation of ['index','snapshot']){
  const f=allFixture(),late=deferred();let blocked=false;
  const {api}=harness(async q=>{if(q.system==='AR'&&q.operation===operation){blocked=true;await late.promise;}return f.request(q);});
  const run=api.refresh();while(!blocked)await tick();
  api.openTarget({system:'INVALID',country:'IN',platform:'UNRESOLVED'});
  assert.equal(api.state().platform,null);assert.match(api.render(),/来源信息不完整/);
  late.resolve();await run;
  assert.equal(api.state().platform,null,operation+' cannot select an unrelated platform');
  assert.equal(api.state().indexStatus,'error');assert.equal(api.state().snapshotStatus,'error');
  assert.match(api.render(),/来源信息不完整/);assert.doesNotMatch(api.render(),/观测日期|>A1<\/span>/);
  assert.equal(api.state().completed,4);api.selectSystem(1);assert.equal(api.state().platform,'N1');assert.equal(api.state().snapshotStatus,'ready');
  api.selectSystem(0);assert.equal(api.state().platform,null);assert.match(api.render(),/来源信息不完整/);
  const before=f.calls.length;api.selectPlatform(1);assert.equal(api.state().platform,'A2');assert.equal(api.state().snapshotStatus,'ready');assert.match(api.render(),/>A2<\/span>/);assert.equal(f.calls.length,before);
  api.openTarget({system:'INVALID',country:'IN',platform:'UNRESOLVED'});api.openTarget({system:'AR',country:'BR',platform:'BR1'});
  assert.equal(api.state().platform,'BR1');assert.equal(api.state().snapshotStatus,'ready');assert.doesNotMatch(api.render(),/来源信息不完整/);assert.equal(f.calls.length,before);
 }
});
