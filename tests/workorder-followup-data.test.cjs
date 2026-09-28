const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {createHash,webcrypto}=require('node:crypto');
globalThis.crypto=webcrypto;
const file=path.join(__dirname,'../supabase/functions/workorder-followup-data/handler.ts');
const source=fs.readFileSync(file,'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('module','exports',compiled)(mod,mod.exports);
const {createWorkorderFollowupHandler}=mod.exports;
const actor='11111111-1111-4111-8111-111111111111',caseId='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const proxy='synthetic-server-proof',hash=createHash('sha256').update(proxy).digest('hex'),now=Date.parse('2026-09-27T10:00:00Z');
const account={auth_user_id:actor,role:'agent',active:true,team:'SYNTHETIC-TEAM',platforms:['SYNTHETIC-PLATFORM']};
const identity={ok:true,identity_kind:'workorder',account,catalog:{platformTeams:{'SYNTHETIC-PLATFORM':'SYNTHETIC-TEAM'}}};
const entry={upiId:'synthetic@upi.invalid',kycUpiId:'***@bank.invalid',utr:'00001234',kycCheck:'yes',utrMatch:'no',providerReply:'Waiting for confirmation',outcome:'other_order',documentType:'pdf',followedAt:'2026-09-26T10:00:00Z',orderDate:'2026-09-25'};
const record={id:caseId,source:'TEST_AR',country:'IN',currency:'INR',team:account.team,platform:account.platforms[0],order_no:'RC20260925SYNTHETIC',amount_cents:12345,provider:'SYNTHETIC-PROVIDER',status:'waiting',owner_id:actor,created_by:actor,created_by_name:'Synthetic creator',last_follow_actor_name:'Synthetic follower',last_follow_actor_id:actor,created_at:'2026-09-25T20:00:00Z',updated_at:'2026-09-26T10:00:00Z',due_at:null,version:2,reason:'',entry_json:JSON.stringify(entry),workorders:['WORK-ONE','WORK-TWO']};
function harness(options={}){
 const calls={identify:[],list:[],mirror:[]};
 const gateway={identify:async h=>{calls.identify.push(Object.fromEntries(h));return options.identity??identity;},list:async(...args)=>{calls.list.push(args);return options.result??{rows:[],total:0,facets:{platforms:account.platforms,providers:[],creators:[],followers:[]}};},mirror:async r=>{calls.mirror.push(r);return options.mirrorResult??true;}};
 const handle=createWorkorderFollowupHandler(gateway,{proxyKeySha256:hash,now:()=>now});
 const request=(body={action:'list'},headers={},method='POST')=>handle(new Request('https://synthetic.invalid/followup',{method,headers:{'Content-Type':'application/json',Authorization:'Bearer SYNTHETIC-TOKEN','x-portal-proxy-key':proxy,'x-portal-client-ip':'192.0.2.15',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
 return {calls,request};
}
test('server proxy proof, valid client IP and user token are all required before identity or DB',async()=>{
 for(const headers of [{'x-portal-proxy-key':''},{'x-portal-proxy-key':'wrong'},{'x-portal-client-ip':''},{'x-portal-client-ip':'unknown'},{Authorization:''},{Origin:'https://synthetic.invalid'}]){
  const h=harness(),r=await h.request({action:'list'},headers);assert([401,403].includes(r.status));assert.equal(h.calls.identify.length,0);assert.equal(h.calls.list.length,0);assert.equal(h.calls.mirror.length,0);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
 }
 for(const method of ['GET','OPTIONS']){const h=harness();assert.equal((await h.request({}, {},method)).status,405);assert.equal(h.calls.identify.length,0);}
});
test('identity revalidates active workorder role and current catalog; owners are denied',async()=>{
 for(const changed of [{identity_kind:'dashboard_owner'},{account:{...account,active:false}},{account:{...account,role:'owner'}},{account:{...account,platforms:['UNAUTHORIZED']}},{catalog:{platformTeams:{'SYNTHETIC-PLATFORM':'OTHER-TEAM'}}}]){
  const h=harness({identity:{...identity,...changed}});assert.equal((await h.request()).status,403);assert.equal(h.calls.list.length,0);assert.equal(h.calls.mirror.length,0);
 }
});
test('list sends separately validated AND filters and drops empty source instead of filtering everything out',async()=>{
 const h=harness(),filters={platform:account.platforms[0],orderNo:'ORDER',workorder:'WORK',utr:'0000',reply:'confirmation',provider:'SYNTHETIC-PROVIDER',outcome:'other_order',kyc:'yes',utrMatch:'no',source:'',creator:'Synthetic creator',follower:'Synthetic follower',staffCode:'STAFF',upiId:'synthetic',kycUpiId:'bank',from:'2026-09-01',to:'2026-09-27',minAmount:'1.25',maxAmount:'999.00'};
 const r=await h.request({action:'list',filters,offset:50,limit:50});assert.equal(r.status,200);
 const [a,f,offset,limit]=h.calls.list[0];assert.deepEqual(a,account);assert.deepEqual(f,Object.fromEntries(Object.entries(filters).filter(([,v])=>v)));assert.equal(offset,50);assert.equal(limit,50);
 assert.equal(h.calls.identify[0]['x-portal-client-ip'],'192.0.2.15');assert.equal(h.calls.identify[0].authorization,'Bearer SYNTHETIC-TOKEN');
});
test('invalid, out-of-scope and malformed filters never call DB',async()=>{
 for(const filters of [{unexpected:'x'},{platform:'OTHER'},{outcome:'x'.repeat(201)},{kyc:'true'},{source:'raw'},{from:'2026-02-30'},{from:'2026-09-20',to:'2026-09-01'},{minAmount:'1e10'},{minAmount:'2',maxAmount:'1'},{reply:'x\u0000'},{provider:42},{provider:null}]){
  const h=harness();assert([400,403].includes((await h.request({action:'list',filters})).status));assert.equal(h.calls.list.length,0);
 }
 for(const page of [{offset:-1},{offset:0.1},{limit:101},{limit:0}]){const h=harness();assert.equal((await h.request({action:'list',...page})).status,400);assert.equal(h.calls.list.length,0);}
});
test('literal all in a column search is retained, while all enum means no restriction',async()=>{
 const h=harness();assert.equal((await h.request({action:'list',filters:{orderNo:'all',reply:'all',source:'all'}})).status,200);assert.deepEqual(h.calls.list[0][1],{orderNo:'all',reply:'all'});
});
test('history response is read-only and exposes only allowlisted fields, never guessed actors or private fields',async()=>{
 const row={id:'sheet:tab:2',source_kind:'sheet',source_sheet:'synthetic-sheet',source_tab:'SYNTHETIC-TAB',source_row:2,platform:account.platforms[0],order_number:'ORDER',work_order_number:'WORK',utr:'00001234',amount:'125.25',provider:'SYNTHETIC-PROVIDER',normalized_outcome:'pending',normalized_kyc:'yes',normalized_utr:'unknown',followup_at:'raw time',first_actor:'DO-NOT-INFER',last_actor:'DO-NOT-INFER',staff_code:'STAFF-001',followup_status:'Not Yet Received',evidence:'NO',receipt_text:'12',source_date_text:'raw date',source_updated_at:'2026-09-26T00:00:00Z',member_id:'PRIVATE-MEMBER',upi:'PRIVATE-UPI',raw:{bank:'PRIVATE-BANK'},portal_payload:{secret:'PRIVATE-SECRET'}};
 const h=harness({result:{rows:[row],total:1,facets:{platforms:[account.platforms[0],'OTHER'],providers:['SYNTHETIC-PROVIDER']}}}),r=await h.request();assert.equal(r.status,200);const data=await r.json(),item=data.rows[0];
 assert.equal(item.source,'sheet');assert.equal(item.sourceTab,'SYNTHETIC-TAB');assert.equal(item.readOnly,true);assert.equal(item.amount,125.25);assert.equal(item.creator,'');assert.equal(item.follower,'');assert.equal(item.createdAt,'');assert.equal(item.rawFields.staffCode,'STAFF-001');assert.equal(item.rawFields.sourceDateText,'raw date');assert.equal(item.utr,'00001234');assert.deepEqual(data.facets.platforms,account.platforms);assert(!JSON.stringify(data).includes('PRIVATE-'));assert(!JSON.stringify(data).includes('DO-NOT-INFER'));
});
test('mirrors only current scoped portal case and assigns immutable portal namespace and safe payload',async()=>{
 const h=harness(),r=await h.request({action:'mirror',record});assert.equal(r.status,200);const m=h.calls.mirror[0];
 assert.equal(m.id,'PORTAL:'+caseId);assert.equal(m.source_sheet,'PORTAL');assert.equal(m.source_tab,caseId);assert.equal(m.source_kind,'portal');assert.equal(m.source_row,1);assert.equal(m.portal_owner_id,actor);assert.equal(m.portal_team,account.team);assert.equal(m.portal_version,2);assert.equal(m.amount,123.45);assert.equal(m.work_order_number,'WORK-ONE / WORK-TWO');assert.equal(m.followup_status,'Success To Other Order');assert.equal(m.followup_date,'2026-09-26');assert.equal(m.first_actor,'Synthetic creator');assert.equal(m.portal_payload.entry.outcome,'other_order');assert.equal(m.portal_payload.entry.utr,'00001234');assert.equal(m.upi_id,'synthetic@upi.invalid');assert.equal(m.kyc_upi_id,'***@bank.invalid');assert.equal(m.portal_payload.entry_json,undefined);assert.equal(m.portal_payload.proofs,undefined);
});
test('mirror cannot target sheet IDs or inject source columns, PII, proofs or unknown entry fields',async()=>{
 for(const changed of [{id:'sheet:tab:2'},{source_sheet:'synthetic-sheet'},{bank_account:'PRIVATE'},{proofs:[{data:'PRIVATE-BYTES'}]},{entry_json:JSON.stringify({...entry,bank:'PRIVATE'})},{entry_json:JSON.stringify({...entry,providerReply:'private@example.invalid'})}]){
  const h=harness();assert.equal((await h.request({action:'mirror',record:{...record,...changed}})).status,400);assert.equal(h.calls.mirror.length,0);
 }
});
test('mirror rejects inactive scope, foreign owner for agents and auditors before DB',async()=>{
 for(const changed of [{platform:'OTHER'},{team:'OTHER'},{owner_id:other}]){const h=harness();assert.equal((await h.request({action:'mirror',record:{...record,...changed}})).status,403);assert.equal(h.calls.mirror.length,0);}
 const h=harness({identity:{...identity,account:{...account,role:'auditor'}}});assert.equal((await h.request({action:'mirror',record})).status,403);assert.equal(h.calls.mirror.length,0);
 const supervisor=harness({identity:{...identity,account:{...account,role:'supervisor'}}});assert.equal((await supervisor.request({action:'mirror',record:{...record,owner_id:other}})).status,200);
});
test('mirror validates integer cents, version, identifiers, country, times and enum fields',async()=>{
 for(const changed of [{amount_cents:1.1},{amount_cents:0},{version:0},{version:1.2},{country:'US'},{currency:'USD'},{created_by:'not-uuid'},{last_follow_actor_id:'not-uuid'},{status:'paid'},{created_at:'yesterday'},{updated_at:'2026-09-20T10:00:00Z'},{workorders:['bad identifier']},{entry_json:JSON.stringify({...entry,kycCheck:'true'})},{entry_json:JSON.stringify({...entry,followedAt:'2027-01-01T00:00:00Z'})}]){
  const h=harness();assert.equal((await h.request({action:'mirror',record:{...record,...changed}})).status,400,JSON.stringify(changed));assert.equal(h.calls.mirror.length,0);
 }
});
test('portal list serializes version and all workorders while enforcing agent owner and auditor readOnly',async()=>{
 const mirror=harness();await mirror.request({action:'mirror',record});const row={...mirror.calls.mirror[0],normalized_outcome:'other_order',normalized_kyc:'yes',normalized_utr:'no'};
 const result={rows:[row],total:1,facets:{}};
 const h=harness({result}),data=await (await h.request()).json();assert.equal(data.rows[0].readOnly,false);assert.equal(data.rows[0].portalCaseId,caseId);assert.deepEqual(data.rows[0].workorders,record.workorders);assert.equal(data.rows[0].version,2);assert.equal(data.rows[0].creator,'Synthetic creator');assert.equal(data.rows[0].orderDate,'2026-09-25');
 const audit=harness({result,identity:{...identity,account:{...account,role:'auditor'}}});assert.equal((await (await audit.request()).json()).rows[0].readOnly,true);
 const foreign=harness({result:{...result,rows:[{...row,portal_owner_id:other}]}});assert.equal((await foreign.request()).status,503);
});
test('empty followup date uses case creation India date without inventing followup time',async()=>{
 const h=harness();await h.request({action:'mirror',record:{...record,entry_json:JSON.stringify({...entry,followedAt:''})}});assert.equal(h.calls.mirror[0].followup_at,null);assert.equal(h.calls.mirror[0].followup_date,'2026-09-26');
});

test('custom receipt status survives mirror, list and exact status filtering without becoming unknown',async()=>{
 const custom='人工核实中 / Awaiting bank confirmation',h=harness();
 assert.equal((await h.request({action:'mirror',record:{...record,entry_json:JSON.stringify({...entry,outcome:' '+custom+' '})}})).status,200);
 const m=h.calls.mirror[0];assert.equal(m.followup_status,custom);assert.equal(m.portal_payload.entry.outcome,custom);
 const reader=harness({result:{rows:[{...m,normalized_outcome:custom}],total:1,facets:{}}});
 const result=await(await reader.request({action:'list',filters:{outcome:custom}})).json();assert.equal(result.rows[0].outcome,custom);assert.equal(reader.calls.list[0][1].outcome,custom);
 for(const outcome of ['', '  ', 'x'.repeat(201),'待处理\u0085']){const bad=harness();assert.equal((await bad.request({action:'mirror',record:{...record,entry_json:JSON.stringify({...entry,outcome})}})).status,400);assert.equal(bad.calls.mirror.length,0);}
});

test('UPI addresses survive scoped history/list while RC date and India-day age ignore stale sheet text',async()=>{
 const raw={id:'history',source_kind:'sheet',platform:account.platforms[0],order_number:'RC20260925ABC',upi_id:'synthetic@upi.invalid',kyc_upi_id:'***@bank.invalid',receipt_text:'9999',normalized_outcome:'success'};
 const h=harness({result:{rows:[raw],total:1,facets:{}}});const r=(await(await h.request()).json()).rows[0];assert.equal(r.upiId,raw.upi_id);assert.equal(r.kycUpiId,raw.kyc_upi_id);assert.equal(r.orderDate,'2026-09-25');assert.equal(r.daysSinceOrder,2);
 for(const order_number of ['SYNTHETIC20260925','RC20260230ABC','RC20990101ABC']){const f=harness({result:{rows:[{...raw,order_number}],total:1,facets:{}}});const row=(await(await f.request()).json()).rows[0];assert.equal(row.orderDate,'');assert.equal(row.daysSinceOrder,null);}
});
test('mirror derives receipt date from immutable order number and validates only new UPI fields',async()=>{
 const h=harness();assert.equal((await h.request({action:'mirror',record:{...record,entry_json:JSON.stringify({...entry,orderDate:'2020-01-01'})}})).status,200);assert.equal(h.calls.mirror[0].portal_payload.entry.orderDate,'2026-09-25');assert.equal(h.calls.mirror[0].receipt_text,'2026-09-25');
 for(const upiId of ['123456789012','bank account 1234','a@b c@d']){const b=harness();assert.equal((await b.request({action:'mirror',record:{...record,entry_json:JSON.stringify({...entry,upiId})}})).status,400);assert.equal(b.calls.mirror.length,0);}
 for(const limit of [20,50,100]){const p=harness();const r=await p.request({action:'list',limit});assert.equal(r.status,200);assert.equal(p.calls.list[0][3],limit);}
});

test('all and pending views are validated and forwarded before database pagination',async()=>{
 for(const view of ['all','pending']){const h=harness();assert.equal((await h.request({action:'list',filters:{view},offset:50,limit:20})).status,200);assert.equal(h.calls.list[0][1].view,view);assert.equal(h.calls.list[0][2],50);}
 for(const view of ['due','completed',true,null]){const h=harness();assert.equal((await h.request({action:'list',filters:{view}})).status,400);assert.equal(h.calls.list.length,0);}
});
test('actual follow event time survives mirroring independently of manual third-party time and sync time',async()=>{
 const lastFollowAt='2026-09-26T18:30:00.000Z',h=harness();
 assert.equal((await h.request({action:'mirror',record:{...record,last_follow_at:lastFollowAt,updated_at:'2026-09-27T09:00:00Z',entry_json:JSON.stringify({...entry,followedAt:'2026-08-01T10:00:00Z'})}})).status,200);
 const m=h.calls.mirror[0];assert.equal(m.portal_payload.last_follow_at,lastFollowAt);assert.equal(m.followup_date,'2026-09-27');assert.equal(m.followup_at,'2026-08-01T10:00:00.000Z');
 const reader=harness({result:{rows:[{...m,normalized_outcome:'other_order'}],total:1,facets:{}}});const item=(await(await reader.request()).json()).rows[0];assert.equal(item.lastFollowAt,lastFollowAt);assert.equal(item.followedAt,'2026-08-01T10:00:00.000Z');assert.equal(item.follower,'Synthetic follower');
 const legacy=harness();await legacy.request({action:'mirror',record:{...record,entry_json:JSON.stringify({...entry,followedAt:'2026-08-01T10:00:00Z'})}});const old=legacy.calls.mirror[0];assert.equal(old.portal_payload.last_follow_at,null);assert.equal(old.followup_date,'2026-09-26');
 const missing=harness({result:{rows:[{...old,normalized_outcome:'other_order'}],total:1,facets:{}}});assert.equal((await(await missing.request()).json()).rows[0].lastFollowAt,'');
 const sheet=harness({result:{rows:[{id:'sheet',source_kind:'sheet',platform:account.platforms[0],followup_at:'2026-09-26T18:30:00Z',source_updated_at:'2026-09-27T09:00:00Z'}],total:1,facets:{}}});assert.equal((await(await sheet.request()).json()).rows[0].lastFollowAt,'');
});
test('mirror rejects invalid or impossible saved follow timestamps without writing',async()=>{
 for(const last_follow_at of ['yesterday','2026-09-01T00:00:00Z','2026-09-27T10:02:00Z','2026-09-26T10:02:00Z']){const h=harness();assert.equal((await h.request({action:'mirror',record:{...record,last_follow_at}})).status,400);assert.equal(h.calls.mirror.length,0);}
});
