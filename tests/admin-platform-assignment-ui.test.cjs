// Synthetic component tests; no network, credentials or real mapping changes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../admin-preview/live-configuration.js'),'utf8');
const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function make(){
 const resultHost={innerHTML:''},filtersHost={value:'typing stays here'},L={teamPlatformTeam:'all',teamPlatformCountry:'巴西',teamPlatformSystem:'all',teamPlatformQuery:'',teamPlatformStatus:'all',platformAssignmentsPage:1,platformAssignmentsSize:20,platformAssignmentsAppliedRequest:{action:'platformAssignments',country:'巴西',offset:0,limit:20},platformAssignments:{rows:[{country:'巴西',platform:'SYNTHETIC-BR',team:'M8',system:'AR',sourceSystem:'AR',status:'no_data',mapped:true}],total:1,canManage:true,summary:{mappings:1,mapped:0,noData:1,unmapped:0},options:{countries:['巴西','印尼'],teams:['M8'],systems:['AR']}}};
 const c={document:{getElementById:id=>id==='platformAssignmentResults'?resultHost:filtersHost}};c.window=c;vm.createContext(c);vm.runInContext(code,c);
 const module=c.HensemLiveConfiguration.create({L,E,C:x=>String(x??0),metric:(l,n)=>`<div>${l}:${n}</div>`,box:(t,h)=>`<section><h2>${t}</h2>${h}</section>`,table:(headers,rows)=>`<table><thead>${headers.join('|')}</thead><tbody>${rows.map(r=>r.join('|')).join('\n')}</tbody></table>`,pager:total=>`total:${total}`,request:()=>{throw Error('network forbidden')},render(){},changed(){}});
 return{L,module,resultHost,filtersHost};
}
test('successful assignment results state their applied scope and expose a real submit form',()=>{
 const h=make(),html=h.module.platformView();assert.match(html,/已查询：巴西 · 全部团队 · 全部系统/);assert.match(html,/配置平台:1/);assert.match(html,/SYNTHETIC-BR/);assert.match(html,/<form[^>]+onsubmit="event.preventDefault\(\);platformAssignmentsLoad\(true\)"/);assert.match(html,/type="submit">查询/);assert.match(html,/onchange="platformAssignmentsSet\('teamPlatformCountry',this.value\)"/);
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
