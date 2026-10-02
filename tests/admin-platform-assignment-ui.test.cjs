// Synthetic component tests; no network, credentials or real mapping changes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../admin-preview/live-configuration.js'),'utf8');
const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function make(){
 const resultHost={innerHTML:''},filtersHost={value:'typing stays here'},L={teamPlatformTeam:'all',teamPlatformCountry:'巴西',teamPlatformSystem:'all',teamPlatformQuery:'',teamPlatformStatus:'all',platformAssignmentsPage:1,platformAssignmentsSize:20,platformAssignmentsAppliedRequest:{action:'platformAssignments',country:'巴西',offset:0,limit:20},platformAssignments:{rows:[{country:'巴西',platform:'SYNTHETIC-BR',team:'M8',system:'AR',sourceSystem:'AR',status:'no_data',mapped:true}],total:1,canManage:true,summary:{mappings:1,mapped:0,noData:1,unmapped:0},options:{countries:['巴西','印尼'],teams:['M8'],systems:['AR']}}};
 const c={document:{getElementById:id=>id==='platformAssignmentResults'?resultHost:filtersHost}};c.window=c;vm.createContext(c);vm.runInContext(code,c);
 const module=c.HensemLiveConfiguration.create({L,E,C:x=>String(x??0),metric:(l,n)=>`<div>${l}:${n}</div>`,box:(t,h)=>`<section><h2>${t}</h2>${h}</section>`,table:(headers,rows)=>`<table><thead>${headers.join('|')}</thead><tbody>${rows.map(r=>r.join('|')).join('\n')}</tbody></table>`,pager:total=>`total:${total}`,request:()=>{throw Error('network forbidden')},render(){},changed(){}});
 const queries=[];c.platformAssignmentsLoad=reset=>queries.push({reset,country:L.teamPlatformCountry});
 return{L,module,resultHost,filtersHost,context:c,queries};
}
test('assignment query buttons and guarded Enter preserve the applied scope without native submit',()=>{
 const h=make(),html=h.module.platformView();assert.match(html,/已查询：巴西 · 全部团队 · 全部系统/);assert.match(html,/配置平台:1/);assert.match(html,/SYNTHETIC-BR/);assert.match(html,/<form[^>]+onsubmit="return false"/);assert.match(html,/type="button" onclick="configQuery\(this.form,null,'platform'\)">查询/);assert.match(html,/onchange="platformAssignmentsSet\('teamPlatformCountry',this.value\)"/);
 const click=html.match(/onclick="(configQuery\(this.form,null,'platform'\))"/)[1],keydown=html.match(/onkeydown="([^"]+)"/)[1],submit=html.match(/onsubmit="([^"]+)"/)[1];
 const run=(handler,self,event)=>vm.runInContext('(function(event){'+handler+'})',h.context).call(self,event);
 let valid=true,prevented=0;const form={reportValidity:()=>valid},event={key:'Enter',target:{tagName:'INPUT',type:'text'},preventDefault(){prevented++}},applied=h.L.platformAssignmentsAppliedRequest;
 h.L.teamPlatformCountry='印尼';run(click,{form});assert.deepEqual(h.queries,[{reset:true,country:'印尼'}]);
 run(keydown,form,event);assert.equal(prevented,1);assert.equal(h.queries.length,2);assert.equal(run(submit,form,event),false);assert.equal(h.queries.length,2,'native submit cannot repeat the query');
 assert.equal(h.L.platformAssignmentsAppliedRequest,applied,'requesting a new country must not relabel the old response');assert.match(h.module.platformView(),/筛选条件已修改/);assert.doesNotMatch(h.module.platformView(),/SYNTHETIC-BR|已查询：印尼/);
 valid=false;run(click,{form});run(keydown,form,event);assert.equal(h.queries.length,2,'invalid fields do not query');valid=true;
 for(const change of [{isComposing:true},{keyCode:229},{repeat:true},{defaultPrevented:true},{ctrlKey:true},{target:{tagName:'TEXTAREA'}},{target:{tagName:'SELECT'}},{target:{tagName:'INPUT',type:'checkbox'}}])run(keydown,form,{...event,...change});
 h.L.platformAssignmentsLoading=true;run(click,{form});assert.equal(h.queries.length,2,'IME, non-search controls and an in-flight read do not query');
});
test('draft country or any changed filter hides old rows, edit controls and totals until queried',()=>{
 for(const [field,value]of [['teamPlatformCountry','印尼'],['teamPlatformTeam','胖虎'],['teamPlatformSystem','PANDA'],['teamPlatformQuery','ANOTHER'],['teamPlatformStatus','mapped']]){
  const h=make();h.L[field]=value;const html=h.module.platformView();assert.match(html,/筛选条件已修改/);assert.doesNotMatch(html,/<table>|SYNTHETIC-BR|configEditPlatform|配置平台:1/);
 }
});
test('loading and failed queries never label old rows as newly selected results; valid empty results show zero',()=>{
 const h=make();h.L.teamPlatformCountry='印尼';h.L.platformAssignmentsLoading=true;
 assert.match(h.module.platformView(),/正在查询：印尼/);assert.doesNotMatch(h.module.platformView(),/<table>|SYNTHETIC-BR|配置平台:1/);
 h.L.platformAssignmentsLoading=false;h.L.platformAssignmentsError='读取失败 <unsafe>';
 let html=h.module.platformView();assert.match(html,/读取失败 &lt;unsafe&gt;/);assert.match(html,/>重试/);assert.doesNotMatch(html,/<table>|SYNTHETIC-BR/);
 h.L.platformAssignmentsError='';h.L.platformAssignmentsAppliedRequest={country:'印尼'};h.L.platformAssignments={rows:[],total:0,summary:{mappings:0,mapped:0,noData:0,unmapped:0}};
 html=h.module.platformView();assert.match(html,/已查询：印尼/);assert.match(html,/配置平台:0/);assert.match(html,/total:0/);assert.match(html,/<option value="印尼" selected>印尼<\/option>/,'selected scope stays visible even when fresh authorized option list is empty');
});
test('changing a filter only refreshes the result region and restored unstamped results require a query',()=>{
 const h=make();h.L.teamPlatformQuery='typed <name>';h.module.platformChanged();assert.match(h.resultHost.innerHTML,/筛选条件已修改/);assert.equal(h.filtersHost.value,'typing stays here');
 h.L.teamPlatformQuery='';delete h.L.platformAssignmentsAppliedRequest;assert.doesNotMatch(h.module.platformView(),/<table>|SYNTHETIC-BR/);
 h.L.platformAssignmentsAppliedRequest={country:'巴西',offset:20,limit:50};assert.match(h.module.platformView(),/<table>/,'paging does not alter filter identity');
});

test('provider association counts distinguish unknown source coverage from verified zero',()=>{
 const h=make();h.L.country='巴西';h.L.providerConfig={rows:[{country:'巴西',platform:'SYNTHETIC-BR',rawProvider:'Source-A',canonicalProvider:'Known-A',canonicalProviders:['Known-A'],chargeCount:null,withdrawCount:0,matchedCount:null,status:'assigned'}],total:1,summary:{rawProviders:1,assigned:1,unassigned:0,conflict:0},options:{countries:['巴西']}};h.L.providerConfigPage=1;h.L.providerConfigSize=20;
 let html=h.module.providerView();assert.match(html,/SYNTHETIC-BR\|—\|0\|—\|已归类/);
 for(const invalid of [undefined,'',true,-1,'NaN','Infinity']){h.L.providerConfig.rows[0].chargeCount=invalid;html=h.module.providerView();assert.match(html,/SYNTHETIC-BR\|—\|0\|—\|已归类/);}
 h.L.providerConfig.rows[0].chargeCount='123';h.L.providerConfig.rows[0].matchedCount=123;assert.match(h.module.providerView(),/SYNTHETIC-BR\|123\|0\|123\|已归类/);
});
