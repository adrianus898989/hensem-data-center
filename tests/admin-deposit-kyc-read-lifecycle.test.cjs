const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){
 const calls=[],drawers=[],root={},L={catalogReady:true,catalog:[{country:'印度',name:'SYNTHETIC',source:'ar',timezone:'Asia/Kolkata'}]};
 for(const file of ['live-workorder-operations.js','live-kyc-reconciliation.js','live-deposit-workspace.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview',file),'utf8'),{window:root});
 root.HensemWorkorderUI.today=()=>({from:'2026-10-04',to:'2026-10-04'});
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let html='',handler=q=>({source:'collected-workorders',dimension:q.dimension,summary:{rawRecords:2,duplicateSourceRows:0,uniqueWorkorders:2},kycSummary:{connected:{count:1},disconnected:{count:1},unknown:{count:0}},rows:[{key:'SYNTHETIC',platform:'SYNTHETIC',workOrderId:'000TICKET',paymentOrderId:'RC20260901FIXTURE',amount:'0.00',kycStatus:'connected',manualKyc:'NO',receiptState:'unknown',sourceSystem:'AR',rawRecords:1,sourceCount:2,relatedWorkorderCount:2,sources:[{sourceSystem:'AR',sourcePlatform:'SYNTHETIC-RAW',paymentOrderReferences:['RC20260901FIXTURE','RC-CONFLICT<&'],referenceConflict:true,submittedDate:'2026-10-04',workOrderId:'000TICKET',submittedAt:'2026-10-03T18:30:00Z',observedAt:'2026-10-04T06:00:00Z',amount:'0.00',currency:'INR'}],providerReply:'<img src=x onerror=alert(1)>'}],total:1,coverage:{complete:false,label:'仅含已采集工单，来源覆盖未确认'},sourceManifest:{platforms:[{platform:'SYNTHETIC',system:'AR',selectedWorkorders:2,latestSubmittedDate:'2026-10-04',lastObservedAt:'2026-10-04T06:00:00Z'}]}});
 const live=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8'),adapter={window:root};vm.runInNewContext(live.slice(live.indexOf(' function preemptSyncHealth'),live.indexOf(' const previousRender'))+';globalThis.request=foregroundRequest',adapter);root.hensemLiveRequest=async q=>{calls.push(JSON.parse(JSON.stringify(q)));return handler(q)};
 const panel=root.HensemLiveDepositWorkspace.create({L,E,C:v=>String(v??'—'),N:v=>Number(v).toFixed(2),formatTime:v=>v,table:(h,rows)=>rows.map(r=>r.join('|')).join('\n'),render:()=>{html=panel.render()},request:adapter.request,openDrawer:(title,body)=>drawers.push({title,body})});
 return {root,panel,calls,drawers,L,html:()=>html,dispatch:(m,...a)=>root.HensemLiveKycReconciliation.dispatch('deposit-source-kyc',m,...a),setHandler:v=>handler=v};
}

const waitForRead=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
test('KYC owns the real host loading flag and cancels only the independent health read',async()=>{
 const h=harness(),wait=waitForRead(),canceled=[];let healthCancels=0;
 h.L.workordersLoading=true;h.L.autoWithdrawLoading=true;h.L.depositIssuesLoading=true;
 h.root.HensemLiveSyncHealth={cancel:()=>healthCancels++};h.root.hensemLiveCancelRequests=actions=>canceled.push([...actions]);
 h.setHandler(()=>wait.promise);const pending=h.panel.load();
 assert.equal(h.L.depositKycLoading,true);assert.equal(healthCancels,1);assert.deepEqual(canceled,[['syncHealth']]);
 assert.equal(h.L.workordersLoading,true);assert.equal(h.L.autoWithdrawLoading,true);assert.equal(h.L.depositIssuesLoading,true);assert.match(h.panel.render(),/读取中/);
 wait.reject(Error('正式 KYC 读取超时'));await pending;
 assert.equal(h.L.depositKycLoading,false);assert.match(h.panel.render(),/正式 KYC 读取超时/);
 h.setHandler(q=>({source:'collected-workorders',dimension:q.dimension,rows:[],total:0}));await h.panel.load();
 assert.equal(h.L.depositKycLoading,false);assert.equal(healthCancels,2);assert.equal(h.calls.length,2);
 h.panel.destroy();
});
test('old KYC responses and finally cannot release a replacement read after pause or direct replacement',async()=>{
 for(const pauseFirst of [false,true]){
  const h=harness(),old=waitForRead(),fresh=waitForRead();let n=0;
  h.setHandler(()=>++n===1?old.promise:fresh.promise);
  const first=h.panel.load();assert.equal(h.L.depositKycLoading,true);
  if(pauseFirst){h.panel.pause();assert.equal(h.L.depositKycLoading,false);}
  const second=h.panel.load();assert.equal(h.L.depositKycLoading,true);
  old.resolve({source:'collected-workorders',dimension:'orders',rows:[{paymentOrderId:'STALE-PRIVATE-RESULT'}],total:1});await first;
  assert.equal(h.L.depositKycLoading,true);assert.doesNotMatch(h.panel.render(),/STALE-PRIVATE-RESULT/);
  fresh.resolve({source:'collected-workorders',dimension:'platform',rows:[],total:0});await second;
  assert.equal(h.L.depositKycLoading,false);assert.doesNotMatch(h.panel.render(),/读取中/);
  h.panel.destroy();
 }
});
test('idle KYC lifecycle does not clear another owner and active reset releases only its KYC read',async()=>{
 const h=harness();h.L.depositIssuesLoading=true;h.L.workordersLoading=true;
 h.panel.pause();h.panel.restore(null);h.panel.clear();assert.equal(h.L.depositIssuesLoading,true);
 h.L.depositKycLoading=false;const wait=waitForRead();h.setHandler(()=>wait.promise);const pending=h.panel.load();
 assert.equal(h.L.depositKycLoading,true);h.dispatch('reset');assert.equal(h.L.depositKycLoading,false);
 h.L.depositKycLoading=true;wait.resolve({rows:[],total:0});await pending;
 assert.equal(h.L.depositKycLoading,true,'obsolete finally cannot clear a subsequent KYC owner');
 assert.equal(h.L.workordersLoading,true);h.panel.destroy();assert.equal(h.L.depositKycLoading,true);
});

const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-sync-health.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}};
const issue=(platform='PLATFORM',status='not_received')=>({platform,country:'印度',team:'M8',dataset:'orders',direction:'charge',sourceKind:'direct',source:'ar',date:'2026-09-25',status,received:false,evidence:'no_created_orders_received'});
const response=(rows=[issue()],checked=rows.length)=>({checkedAt:'2026-09-26T01:00:00Z',days:7,total:rows.length,summary:{checked,received:checked-rows.length,notReceived:rows.filter(x=>x.status==='not_received').length,failed:rows.filter(x=>x.status==='failed').length,pending:rows.filter(x=>x.status==='pending').length,unverified:rows.filter(x=>x.status==='unverified').length},rows});
function setup(request=async()=>response()){
 let now=1000000,ready=false,seq=0,changes=0;const timers=new Map(),nodes=new Map(),listeners={},calls=[];
 class Clock extends Date{static now(){return now}}
 const document={getElementById:id=>nodes.get(id),createElement:()=>({innerHTML:'',setAttribute(){},remove(){nodes.delete(this.id)}}),body:{appendChild:node=>nodes.set(node.id,node)},addEventListener:(name,fn)=>listeners[name]=fn};
 const ctx=vm.createContext({Date:Clock,AbortController,document,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)});vm.runInContext('window=globalThis',ctx);vm.runInContext(source,ctx);
 const api=ctx.HensemLiveSyncHealth;api.configure({request:async q=>{calls.push(JSON.parse(JSON.stringify(q)));return request(q)},ready:()=>ready,onChange:()=>changes++});
 return {ctx,api,calls,timers,listeners,setReady:value=>ready=value,tick:value=>now+=value,html:()=>nodes.get('live-sync-health-panel')?.innerHTML||'',changes:()=>changes,run:async()=>{for(const [id,timer]of [...timers]){timers.delete(id);timer.fn()}await flush()}};
}


test('real collected KYC loading defers scheduled health and cancels an older in-flight health read',async()=>{
 const live=fs.readFileSync(path.join(__dirname,'../admin-preview/live-data.js'),'utf8');
 const ready=live.match(/configure\(\{request:\(q,options\)=>window\.hensemLiveRequest\(q,options\),context:syncHealthContext,ready:\(\)=>(.*?),onChange:/)[1];
 const declarations=live.slice(live.indexOf(' const supervisorPages='),live.indexOf('\n for(const [id,page]of Object.entries(supervisorPages))'));
 const phase=live.match(/ const phasedReadBusy=\(\)=>[^\n]+;/)[0];
 const L={serial:1,catalogReady:true,initialReadComplete:true,pageQueried:true,loading:false,catalog:[{country:'印度',name:'SYNTHETIC',source:'ar',timezone:'Asia/Kolkata'}]},hostState={page:'deposit_statistics'};
 const h=setup(),root=h.ctx,canceled=[],healthOld=deferred(),kycOld=deferred();let healthReads=0,kycReads=0;
 for(const file of ['live-workorder-operations.js','live-kyc-reconciliation.js','live-deposit-workspace.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview',file),'utf8'),root);
 root.HensemWorkorderUI.today=()=>({from:'2026-10-12',to:'2026-10-12'});
 root.hensemLiveCancelRequests=actions=>canceled.push([...actions]);
 const actualReady=()=>vm.runInNewContext(declarations+'\n'+phase+'\n'+ready,{pages:[],roleAllowed:()=>true,state:hostState,L,readPhase:null,submissionAnalysis:null,window:root,collectedPage:{state:{busy:false}},reportData:{state:{}}});
 h.api.configure({ready:actualReady,onChange:()=>{},request:()=>++healthReads===1?healthOld.promise:Promise.resolve(response([]))});
 // A prior idle health request is already pending when the user starts KYC.
 h.api.schedule('current-authorized-catalog');await h.run();assert.equal(healthReads,1);
 root.hensemLiveRequest=()=>{kycReads++;return kycOld.promise};vm.runInContext(live.slice(live.indexOf(' function preemptSyncHealth'),live.indexOf(' const previousRender')),root);
 let panel;panel=root.HensemLiveDepositWorkspace.create({L,E:String,C:String,N:String,formatTime:String,table:()=>'',render:()=>{panel.render();h.api.schedule('current-authorized-catalog')},request:(q,o)=>root.foregroundRequest(q,o)});
 const pending=panel.load();assert.equal(L.depositKycLoading,true);assert.equal(actualReady(),false);assert.deepEqual(canceled,[['syncHealth']]);
 await h.run();assert.equal(healthReads,1);assert.equal(kycReads,1);
 healthOld.resolve(response([issue('OBSOLETE-HEALTH')]));await flush();assert.equal(h.api.badge(),'','canceled health result stays obsolete');
 kycOld.resolve({source:'collected-workorders',dimension:'platform',rows:[],total:0});await pending;
 assert.equal(L.depositKycLoading,false);assert.equal(actualReady(),true);await h.run();assert.equal(healthReads,1,'the canceled attempt retains the existing five-minute throttle');
 h.tick(300001);h.api.schedule('current-authorized-catalog');await h.run();assert.equal(healthReads,2,'independent health becomes eligible after KYC settles and the original throttle expires');
 panel.destroy();
});

test('switching a pending regular statistics read to KYC keeps busy ownership separate when the old read settles',async()=>{
 const h=harness(),sheet=waitForRead(),kyc=waitForRead();
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-deposit-issues.js'),'utf8'),{window:h.root});
 Object.assign(h.L,{country:'印度',depositIssuesSize:20,depositIssuesPage:1,from:'2026-10-12T00:00:00',to:'2026-10-12T23:59:59'});
 const adapter=h.root.HensemLiveDepositIssues.create({L:h.L,E:String,C:String,N:String,R:String,metric:()=>'',box:()=>'',table:()=>'',pager:()=>'',formatTime:String,page:()=> 'deposit_statistics',render:()=>{},request:q=>q.section==='kyc'?kyc.promise:sheet.promise});
 const original=adapter.load(true);assert.equal(h.L.depositIssuesLoading,true);
 const replacement=h.root.depositIssuesSection('kyc');assert.equal(h.L.depositIssuesLoading,false);assert.equal(h.L.depositKycLoading,true);
 sheet.resolve({total:0,rows:[]});await original;assert.equal(h.L.depositKycLoading,true);assert.equal(h.L.depositIssuesLoading,false);
 kyc.resolve({source:'collected-workorders',dimension:'platform',rows:[],total:0});await replacement;
 assert.equal(h.L.depositKycLoading,false);adapter.destroy();h.panel.destroy();
});
