// Isolated PostgreSQL fixtures only; no production credentials or data.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');let db;
const sql=n=>fs.readFileSync(path.join(__dirname,'../supabase/workorder-records',n),'utf8');
const account={auth_user_id:'10000000-0000-4000-8000-000000000001',role:'agent',active:true,team:'Synthetic',platforms:['A','82LOTTERY']};
const filters={from:'2026-09-01',to:'2026-09-27'};
const read=async(query={action:'list',filters},a=account)=>(await db.query('select public.workorder_collected_records($1,$2) value',[JSON.stringify(a),JSON.stringify(query)])).rows[0].value;
const ingest=async rows=>(await db.query('select public.ingest_ar_workorder_issue_details_v2($1) value',[JSON.stringify(rows)])).rows[0].value;
const record=(id,extra={})=>({system_name:'AR',country_code:'IN',country:'印度',platform:'A',work_order_id:id,issue_kind:'deposit',observed_at:'2026-09-27T00:00:00Z',query_date:'2026-09-26',schema_version:2,query_basis:'submission',field_gaps:[],submitted_date:'2026-09-25',submitted_at:'2026-09-25T02:00:00Z',work_order_no:'WO-'+id,payment_order_no:'RC20260925-'+id,source_order_no:'SRC-'+id,utr:'00001234',amount:'123.45678901',third_party:'SyntheticPay',status_code:1,kyc_connected:true,utr_matched:false,operator_account:'synthetic-employee',attachment_types:['image','pdf'],...extra});
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');await db.exec(sql('002-read.sql'));});
after(async()=>db?.close());
test('absent real detail source is explicit and never substituted with Sheet or aggregates',async()=>{const r=await read();assert.equal(r.sourceStatus,'not_connected');assert.equal(r.total,0);assert.deepEqual(r.rows,[]);});
test('storage install is additive and idempotent; real collector v2 shape is accepted',async()=>{await db.exec(sql('001-storage.sql'));await db.exec(sql('002-read.sql'));await db.exec(sql('001-storage.sql'));assert.deepEqual(await ingest([record('A1'),record('ALIAS',{platform:'INDIA82'}),record('OTHER',{platform:'B'}),record('COUNTRY',{country_code:'PH',country:'菲律宾'}),record('DONE',{status_code:4})]),{accepted:5,written:5});const r=await read();assert.equal(r.sourceStatus,'ready');assert.equal(r.total,3);assert.deepEqual(r.rows.map(x=>x.platform).sort(),['82LOTTERY','A','A']);assert.equal(r.rows[0].amount,'123.45678901');assert(r.rows.some(r=>r.statusCode===4),'processed records remain searchable');});
test('ingest rejects private fields and invalid batches atomically, retains newer and missing optional fields',async()=>{
 for(const extra of [{phone:'PRIVATE'},{bank_account:'PRIVATE'},{raw:{}},{attachment_url:'PRIVATE'},{amount:'NaN'},{amount:'0.123456789'},{status_code:6}])await assert.rejects(()=>ingest([record('SAFE'),record('BAD',extra)]));
 assert.equal((await read()).total,3);await assert.rejects(()=>ingest([record('DUP'),record('DUP')]));
 assert.deepEqual(await ingest([record('A1')]),{accepted:1,written:0});await ingest([record('A1',{observed_at:'2026-09-28T00:00:00Z',status_code:4,amount:null,utr:null,kyc_connected:false})]);await ingest([record('A1',{observed_at:'2026-09-27T12:00:00Z',status_code:1,amount:'1'})]);
 const r=(await read({action:'detail',platform:'A',workorderId:'A1'})).rows[0];assert.equal(r.statusCode,4);assert.equal(r.amount,'123.45678901');assert.equal(r.utr,'00001234');assert.equal(r.kycConnected,false);assert.equal((await db.query('select count(*)::int n from public.ar_workorder_issue_details')).rows[0].n,5);
});
test('AND field searches, India date basis, source status and pagination are distinct',async()=>{
 let r=await read({action:'list',filters:{...filters,platform:'A',workorderNo:'WO-A1',orderNo:'RC20260925',sourceOrderNo:'SRC-A1',utr:'0000',provider:'synthetic',operator:'employee',statusCode:'4',issueKind:'deposit',kyc:'no',utrMatch:'no',minAmount:'123',maxAmount:'124'},limit:20,offset:0});assert.equal(r.total,1);assert.equal(r.rows[0].workorderId,'A1');assert(!JSON.stringify(r).includes('tenant_id'));
 assert.equal((await read({action:'list',filters:{...filters,workorderNo:'WO-A1',utr:'missing'}})).total,0);
 await ingest([record('MIDNIGHT',{submitted_date:'2026-09-26',submitted_at:'2026-09-25T18:30:00Z',operated_at:'2026-09-26T18:30:00Z',operation_time_source:'operationTime'})]);
 assert.equal((await read({action:'list',filters:{from:'2026-09-27',to:'2026-09-27',dateBasis:'operation'}})).total,1);
 assert.equal((await read({action:'list',filters:{from:'2026-09-26',to:'2026-09-26',dateBasis:'submission'}})).total,1);
 await ingest(Array.from({length:105},(_,i)=>record('PAGE-'+String(i).padStart(3,'0'))));for(const limit of [20,50,100]){r=await read({action:'list',filters:{...filters,workorderId:'PAGE-'},limit,offset:0});assert.equal(r.total,105);assert.equal(r.rows.length,limit);assert.equal((await read({action:'list',filters:{...filters,workorderId:'PAGE-'},limit,offset:100})).rows.length,5);}
});
test('scope never conflates arbitrary platform punctuation, and detail rechecks exact platform',async()=>{
 await ingest([record('COLLIDE',{platform:'A-B'}),record('COLLIDE',{platform:'A.B'}),record('COLLIDE',{platform:'AB'})]);const a={...account,platforms:['AB']};assert.equal((await read(undefined,a)).total,1);assert.equal((await read({action:'detail',platform:'AB',workorderId:'COLLIDE'},a)).total,1);await assert.rejects(()=>read({action:'detail',platform:'B',workorderId:'OTHER'}),/scope_denied/);
});
test('only service reads/ingests; no anonymous or authenticated direct access or delete privilege',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>read());await assert.rejects(()=>ingest([record('DENIED')]));await assert.rejects(()=>db.exec('select * from public.ar_workorder_issue_details'));await db.exec('reset role');}
 await db.exec('set role service_role');assert.equal((await read({action:'detail',platform:'A',workorderId:'A1'})).total,1);await assert.rejects(()=>db.exec('delete from public.ar_workorder_issue_details'),/permission denied/);await db.exec('reset role');
 for(const a of [{...account,active:false},{...account,role:'owner'},{...account,platforms:[]}])await assert.rejects(()=>read(undefined,a),/scope_denied/);
 for(const q of [{action:'mirror'},{action:'list',filters:{bank:'x'}},{action:'list',filters:{...filters,platform:'B'}},{action:'list',filters:{from:'2026-02-30',to:'2026-03-01'}},{action:'list',filters:{from:'2026-01-01',to:'2026-09-27'}},{action:'list',limit:10},{action:'list',filters:{minAmount:'2',maxAmount:'1'}}])await assert.rejects(()=>read(q));
});

test('complete identifiers can search all retained history without default date truncation',async()=>{
 await ingest([record('OLD',{submitted_at:'2026-01-01T00:00:00Z',submitted_date:'2026-01-01',work_order_no:'WO-OLD',payment_order_no:'RC20260101EXACT',source_order_no:'SOURCE-OLD',utr:'UTR-OLD'})]);
 for(const [key,value]of Object.entries({workorderId:'OLD',workorderNo:'WO-OLD',orderNo:'RC20260101EXACT',sourceOrderNo:'SOURCE-OLD',utr:'UTR-OLD'})){const r=await read({action:'list',filters:{[key]:value}});assert.equal(r.total,1);assert.equal(r.rows[0].workorderId,'OLD');}
 assert.equal((await read({action:'list',filters:{orderNo:'RC20260101'}})).total,0,'without dates partial identifiers cannot broaden historical search');
 assert.equal((await read({action:'list',filters:{...filters,orderNo:'RC20260101EXACT'}})).total,0,'explicit dates remain part of the filter');
 assert.equal((await read({action:'list',filters:{workorderId:'OLD',utr:'different'}})).total,0);
});
test('full v45/v46 safe business payload is compatible; source timestamps never roll back',async()=>{
 const r=record('FULL',{tenant_id:'SYNTHETIC-TENANT',source_record_id:'INTERNAL',work_order_type_id:1,work_order_type_name:'Deposit missing',work_order_name:'Synthetic',third_party_source_name:'RawPay',third_party_mapping_code:'code',third_party_channel_id:'channel',channel_type:'wallet',kyc_status_source:'source-flag',reminder_count:2,operated_at:'2026-09-26T01:00:00Z',operation_time_source:'operationTime',source_updated_at:'2026-09-26T01:00:00Z',last_updated_by:'employee',attachment_type_codes:[1,2],source_form_id:1,source_type_code:-1,kyc_link_status_code:1,is_locked_by_current_user:false,source_vip_level:'VIP0',source_pay_type_id:0});
 assert.deepEqual(await ingest([r]),{accepted:1,written:1});
 assert.deepEqual(await ingest([{...r,observed_at:'2026-09-29T00:00:00Z',source_updated_at:'2026-09-25T00:00:00Z',amount:'1'}]),{accepted:1,written:0});
 await ingest([{...r,observed_at:'2026-09-29T00:00:00Z',source_updated_at:'2026-09-28T00:00:00Z',reminder_count:0,utr_matched:false}]);
 const current=(await read({action:'detail',platform:'A',workorderId:'FULL'})).rows[0];assert.equal(current.amount,'123.45678901');assert.equal(current.reminderCount,0);assert.equal(current.utrMatched,false);assert.equal((await db.query("select count(*)::int n from public.ar_workorder_issue_details where work_order_id='FULL'")).rows[0].n,1);
});

test('confirmed M8 India AR RAJA alias preserves exact authorization and unique rows',async()=>{
 await ingest([record('RAJA-ALIAS',{platform:'RAJA'}),record('RAJA-PH',{platform:'RAJA',country_code:'PH',country:'菲律宾'})]);
 for(const platforms of [['RAJALOTTERY'],['RAJA','RAJALOTTERY']]){const r=await read(undefined,{...account,team:'M8',platforms});assert.equal(r.total,1);assert.equal(r.rows[0].platform,'RAJALOTTERY');}
 assert.equal((await read(undefined,{...account,team:'Other',platforms:['RAJALOTTERY']})).total,0);
 assert.equal((await read(undefined,{...account,team:'M8',platforms:['RAJA']})).rows[0].platform,'RAJA');
});
