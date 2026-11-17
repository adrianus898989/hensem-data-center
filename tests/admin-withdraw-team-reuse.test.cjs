const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const copy=x=>JSON.parse(JSON.stringify(x));
const read=name=>fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8');
const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const counts=['total','success','rejected','autoCount','manualCount','unclassifiedCount','durationSampleCount','durationTotalSeconds'];
function totals(rows){return {...Object.fromEntries(counts.map(k=>[k,rows.reduce((n,r)=>n+(r[k]??(k==='unclassifiedCount'?Math.max(r.total-r.autoCount-r.manualCount,0):0)),0)])),avgSeconds:10,durationBasis:'source_reported_processing',platforms:rows.length,coveredDays:1};}
function fixture({edit=()=>{},respond,view='auto_withdraw',count=2}={}){
 const native=[...Array.from({length:count},(_,i)=>({id:'m'+i,name:'M'+i,country:'印度',team:'M8',source:'game66',timezone:'Asia/Kolkata',currency:'INR'})),{id:'hk',name:'HK',country:'香港',team:'香港',source:'game66',timezone:'Asia/Kolkata',currency:'INR'},{id:'empty',name:'MISSING',country:'印度',team:'M8',source:'game66',timezone:'Asia/Kolkata',currency:'INR'}];
 const row=p=>({country:p.country,platform:p.name,total:10,success:8,rejected:2,autoCount:6,manualCount:4,unclassifiedCount:0,durationSampleCount:10,durationTotalSeconds:100,avgSeconds:10,durationBasis:'source_reported_processing',coveredDays:1,previous:{total:8,success:6,rejected:2,autoCount:4,manualCount:4,durationSampleCount:8,durationTotalSeconds:80,avgSeconds:10,durationBasis:'source_reported_processing',coveredDays:1}});
 const rows=native.filter(p=>p.name!=='MISSING').map(row),payload={version:2,view:'auto',source:'Supabase daily + NEWAR direct + GAME66',startDate:'2026-10-17',endDate:'2026-10-17',previousStartDate:'2026-10-16',previousEndDate:'2026-10-16',rows,total:rows.length,offset:0,limit:500,totals:totals(rows),previousTotals:totals(rows.map(r=>r.previous)),comparison:{singleDay:true,matchedRows:rows.length,totalRows:rows.length,complete:true},notes:[{country:'印度',platform:'M0',date:'2026-10-17',reason:'M8 note'},{country:'香港',sourceCountry:'香港',platform:'HK',date:'2026-10-17',reason:'HK note'}],canWriteNotes:true,platforms:native.map(p=>p.name),creationAvailability:native.map(p=>({country:p.country,platform:p.name,available:true})),windows:{version:2,creationStartAt:'2026-10-17T00:00:00.000Z',creationEndAt:'2026-10-17T23:59:59.000Z',successStartAt:'2026-10-15T03:00:00.000Z',successEndAt:'2026-10-16T20:00:00.000Z',successBasis:'success'},secondary:{basis:'success',startAt:'2026-10-15T03:00:00.000Z',endAt:'2026-10-16T20:00:00.000Z',createdIntersection:false,complete:false,rows:native.map(p=>({country:p.country,platform:p.name,source:p.source,currency:'INR',count:p.name==='MISSING'?null:7,amount:'9007199254740993.12',complete:false,coverageVerified:false,state:'observed_records',capability:{available:true,field:'success_at'},operatorAttributionAvailable:true,operatorRows:[{account:'same-distinct-operator',count:7,amount:'9007199254740993.12'}]}))},platformCoverage:{basis:'registered_game66_selected_scope',expectedCount:native.length,recordedCount:rows.length,missingCount:1,platforms:native.map(p=>({country:p.country,platform:p.name,source:'game66',coveredDays:p.name==='MISSING'?0:1,expectedDays:1,state:p.name==='MISSING'?'no_selected_period_record':'recorded'}))},prepared:{status:'ready',publicationVersion:2,contract:'withdraw-independent-windows-v2',calculationComplete:true,computedAt:'2026-10-18T03:00:00Z',expiresAt:'2026-10-18T04:00:00Z',generation:7,freshness:'refresh_due',refreshState:'queued'}};
 const L={catalogReady:true,catalog:native,withdrawCatalog:[],country:'印度',team:'all',multi:{team:[]},from:'2026-10-17T00:00:00',to:'2026-10-17T23:59:59',successFrom:'2026-10-15T03:00:00',successTo:'2026-10-16T20:00:00',successBasis:'success'},calls=[],ctx={Date,Intl,AbortController,setTimeout,clearTimeout,document:{getElementById:()=>null,querySelector:()=>null},HensemLiveFilters:{multi:()=>''},hensemRoleAccess:{mode:'owner',canView:true,version:1},hensemDataScope:{mode:'owner',identity:'owner-document'}};ctx.window=ctx;edit(payload,L,ctx);vm.createContext(ctx);vm.runInContext(read('live-report-data.js'),ctx);vm.runInContext(read('live-withdraw-pages.js'),ctx);
 const page=ctx.HensemLiveWithdrawPages.create({L,E,C:String,N:String,R:(n,d)=>d?String(n/d*100)+'%':'—',box:(t,b,n)=>'<section><h3>'+t+'</h3>'+b+(n?'<p>'+n+'</p>':'')+'</section>',table:(h,r)=>'<table>'+r.map(x=>'<tr>'+x.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>',render:()=>{},page:()=>view,request:async(q,o)=>{calls.push({q:copy(q),signal:o?.signal});return respond?respond(q,o,calls.length,payload):copy(payload);}});return {page,L,ctx,calls,payload};
}

test('all teams to a selected team clears rows and reads the authorized native scope on Query',async()=>{
 const f=fixture({respond:(q,_o,n,payload)=>{
  if(n===1)return copy(payload);
  const rows=payload.rows.filter(row=>q.platforms.includes(row.platform)).map(row=>({...row,total:17}));
  return {...copy(payload),rows,notes:[],total:rows.length,totals:totals(rows),previousTotals:null};
 }});
 await f.page.load();assert.equal(f.page.state.data.totals.total,30);
 for(const [team,platforms]of [['M8',['M0','M1','MISSING']],['香港',['HK']]]){
  const before=f.calls.length;f.ctx.withdrawTeam(team);
  assert.equal(f.calls.length,before);assert.equal(f.page.state.data,null);assert.equal(f.page.canExport(),false);
  assert.equal(f.page.state.dirty,true);assert.doesNotMatch(f.page.render(),/M8 note|HK note/);
  await f.page.load(true);assert.deepEqual(copy(f.calls.at(-1).q.platforms).sort(),platforms.slice().sort());
  assert(f.page.state.data.rows.every(row=>platforms.includes(row.platform)));assert.equal(f.page.state.data.totals.total,team==='M8'?34:17);
 }
});
for(const [name,edit] of [
 ['wrong response windows',(d)=>{d.windows.successStartAt='2026-10-10T00:00:00.000Z';}],
 ['unknown source summary',(d)=>{d.arCoverage={days:[],uniqueOperators:10};}],
 ['unsafe numeric count',(d)=>{d.rows[0].total=9007199254740992;d.totals.total=9007199254741012;}],
 ['previous-only native totals',(d)=>{d.previousTotals.platforms++;d.previousTotals.total++;}],
 ['unproven multi-day union',(d)=>{d.totals.coveredDays=2;}],
 ['unrepresented totals',(d)=>{d.totals.total++;}],
 ['unknown total field',(d)=>{d.totals.uniqueMembers=7;}],
 ['unknown top-level scope data',(d)=>{d.operatorSummary={uniqueOperators:4};}],
 ['missing secondary native',(d)=>{d.secondary.rows.shift();}],
 ['missing availability native',(d)=>{d.creationAvailability.shift();}],
 ['unattributed secondary',(d)=>{d.secondary.rows[0].platform='UNKNOWN';}],
 ['unattributed coverage',(d)=>{d.arCoverage={currentComplete:false,days:[{country:'印度',platform:'UNKNOWN',date:'2026-10-17'}]};}],
 ['unavailable partial calculation',(d)=>{d.prepared.calculationComplete=false;}],
 ['incomplete pagination',(d)=>{d.total=501;}],
 ['unsupported time null totals',(d)=>{d.totals.total=null;d.creationAvailability[0].available=false;}],
 ['duplicate physical key',(d,L)=>{L.catalog.push({...L.catalog[0],id:'different-id',team:'香港'});}]
])test('unsafe '+name+' cannot be projected after a team change',async()=>{const f=fixture({edit});await f.page.load();f.ctx.withdrawTeam('M8');assert.equal(f.calls.length,1);assert.equal(f.page.state.data,null);assert.equal(f.page.state.dirty,true);assert.equal(f.page.canExport(),false);await f.page.load(true);assert.equal(f.calls.length,2);});
test('permission denial cannot retain or reuse loaded amounts',async()=>{const f=fixture({respond:(q,o,n,p)=>{if(n===2)throw Object.assign(Error('page_action_denied'),{code:'42501'});return copy(p);}});await f.page.load();await f.page.load(true);assert.equal(f.page.state.data,null);f.ctx.withdrawTeam('M8');assert.equal(f.page.state.data,null);assert.equal(f.page.canExport(),false);});
test('new refresh clears old base; team change aborts old transport and late response cannot overwrite',async()=>{let resolve;const f=fixture({respond:(q,o,n,p)=>n===2?new Promise(r=>resolve=r):copy(p)});await f.page.load();const pending=f.page.load(true);f.ctx.withdrawTeam('M8');assert.equal(f.calls[1].signal.aborted,true);assert.equal(f.page.state.dirty,true);resolve({...copy(f.payload),totals:{total:999}});await pending;assert.equal(f.page.state.data,null);assert.equal(f.page.canExport(),false);});
test('compact UI retains four clocks, one basis control, timestamps and collapsed missing-source details',async()=>{const f=fixture();await f.page.load();const html=f.page.render();assert.equal((html.match(/type="datetime-local"/g)||[]).length,4);assert.match(html,/aria-label="显示统计"/);assert.doesNotMatch(html,/onclick="withdrawMetricView|<h3>未收到当期数据|创建时间 .*成功率按这些创建订单/);assert.match(html,/<details class="withdraw-coverage-details" data-withdraw-coverage="registered"><summary>目录 4 · 有记录 3 · 未收到数据 1<\/summary>/);assert.match(html,/等待采集上传/);assert.match(html,/data-withdraw-publication/);assert.doesNotMatch(html,/<summary>数据说明<\/summary>/);f.ctx.withdrawMetricView('secondary');assert.match(f.page.render(),/独立时间窗成功记录/);assert.match(f.page.render(),/<summary>数据说明<\/summary>/);assert.match(f.page.render(),/9007199254740993.12/);});

test('native metadata changes during a read reject its late response before seeding a base',async()=>{let done;const f=fixture({respond:(q,o,n,p)=>new Promise(r=>done=()=>r(copy(p)))});const pending=f.page.load();f.L.catalog[0].capabilities={withdraw:false};done();await pending;assert.equal(f.page.state.data,null);f.ctx.withdrawTeam('M8');assert.equal(f.page.state.data,null);});
test('an invalid explicit query invalidates the original loaded base even if dates are later restored',async()=>{const f=fixture();await f.page.load();f.L.from='invalid';await f.page.load();f.L.from='2026-10-17T00:00:00';f.ctx.withdrawTeam('M8');assert.equal(f.page.state.dirty,true);assert.equal(f.calls.length,1);});
test('actual prepared SQL India rows with incomplete native day evidence are replaced by an independent selected-team read',async()=>{
 const file=path.join(__dirname,'withdraw-prepared-sql.test.cjs'),createRequire=require('node:module').createRequire,noop=()=>{};noop.afterEach=()=>{};const context=vm.createContext({__dirname,console,structuredClone,require:n=>n==='node:test'?noop:createRequire(file)(n)});vm.runInContext(fs.readFileSync(file,'utf8').split(/\ntest\.afterEach/)[0]+';globalThis.fixture={installed,publish,request,h,val,getDb:()=>db};',context);const sql=context.fixture;await sql.installed();const db=sql.getDb();try{
  await db.exec("update public.synthetic_catalog set team=case when name='MAANWIN'then'M8'else'Other'end");
  for(const day of ['2026-10-12','2026-10-13','2026-10-16','2026-10-17'])for(const platform of ['MAANWIN','DhaniWin','FOREIGN','POPZAR','92BLAZE'])await sql.h.add(db,platform,{created:day+'T01:00:00Z',submitted:day+'T01:00:15Z',method:platform==='MAANWIN'||platform==='POPZAR'?'auto':'manual'});
  const india={country:'印度',startAt:'2026-10-17T00:00:00Z',endAt:'2026-10-17T23:59:59Z'};await sql.publish(india);const dto=await sql.request(india),catalog=await sql.val('select jsonb_agg(to_jsonb(p))v from private.dashboard_admin_live_platforms()p');assert.equal(dto.prepared.calculationComplete,true);assert(dto.rows.length>0);assert(dto.rows.every(r=>r.total>0));assert.equal(dto.rows.find(r=>r.platform==='MAANWIN').coveredDays,0);assert.equal(dto.totals.coveredDays,1);
  const f=fixture({edit:(_,L)=>{L.catalog=catalog.map(p=>({...p,sourceName:p.source_name,scopeGroup:p.scope_group}));L.withdrawCatalog=[];L.country='印度';L.from=dto.startDate+'T00:00:00';L.to=dto.endDate+'T23:59:59';L.successFrom=L.from;L.successTo=L.to;},respond:(q,_o,n)=>n===1?copy(dto):sql.val('select private.dashboard_admin_live_auto_withdraw($1)v',[{country:q.country,view:q.view,platforms:q.platforms,startAt:q.startAt,endAt:q.endAt,limit:q.limit}])});
  await f.page.load();f.ctx.withdrawTeam('M8');assert.equal(f.page.state.data,null);await f.page.load(true);
  assert.equal(f.calls.length,2);assert.deepEqual(copy(f.calls[1].q.platforms),['MAANWIN']);
  const native=await sql.val('select private.dashboard_admin_live_auto_withdraw($1)v',[{...india,platforms:['MAANWIN'],view:'auto',limit:500}]);
  assert(f.page.state.data,f.page.state.error||JSON.stringify(f.page.state.prepared));assert.deepEqual(copy(f.page.state.data.totals),copy(native.totals));assert.deepEqual(copy(f.page.state.data.previousTotals),copy(native.previousTotals));
 }finally{await db.close();}
});
