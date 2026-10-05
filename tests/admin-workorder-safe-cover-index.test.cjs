// Execute the shipped index DDL against local synthetic records. No production
// data or credentials; numeric/storage key types follow workorder-records/001.
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const ddl=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261005134030_workorder_deposit_safe_cover.sql'),'utf8');
const indexName='ar_workorder_deposit_safe_cover_v1_idx';
const textFields=['country_code','platform','work_order_id','work_order_no','payment_order_no','third_party','channel_type','utr'];
const sizeExpression=textFields.map(k=>`octet_length(coalesce(${k},''))`).join('+');
const predicate=`system_name='AR' and issue_kind='deposit' and ${sizeExpression}<=1500`;
const covered=['country_code','platform','work_order_id','work_order_no','payment_order_no','amount','third_party','channel_type','kyc_connected','status_code','submitted_date','submitted_at','observed_at','utr'];
async function withDatabase(run){const db=new PGlite();try{
 await db.exec(`create table public.ar_workorder_issue_details(
  system_name text not null check(system_name='AR'),country_code text not null,platform text not null,work_order_id text not null,
  issue_kind text not null,work_order_no text,payment_order_no text,amount numeric(24,8),third_party text,channel_type text,
  kyc_connected boolean,status_code integer,submitted_date date,submitted_at timestamptz,observed_at timestamptz,utr text,
  primary key(system_name,country_code,platform,work_order_id))`);
 await run(db);
 }finally{await db.close()}}
async function insert(db,id,extra={}){const row={system_name:'AR',country_code:'IN',platform:'RAJA',work_order_id:id,issue_kind:'deposit',work_order_no:'WN-'+id,payment_order_no:'RC-'+id,amount:'12.34',third_party:'Pay',channel_type:'UPI',kyc_connected:true,status_code:1,submitted_date:'2026-10-04',submitted_at:'2026-10-03T19:00:00Z',observed_at:'2026-10-04T02:00:00Z',utr:'UTR-'+id,...extra};
 const cols=Object.keys(row);await db.query(`insert into public.ar_workorder_issue_details(${cols.join(',')})values(${cols.map((_,i)=>'$'+(i+1)).join(',')})`,cols.map(k=>row[k]));return row}
const incompressible=n=>Array.from({length:Math.ceil(n/64)},(_,i)=>crypto.createHash('sha256').update('synthetic-cover-'+i).digest('hex')).join('').slice(0,n);
function nodes(plan){return [plan,...(plan.Plans||[]).flatMap(nodes)]}

test('table-local visibility maintenance preserves access and other settings, and rejects unexpected maintenance settings',()=>withDatabase(async db=>{
 const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261005135430_workorder_visibility_maintenance.sql'),'utf8');
 await db.exec("create role authenticated;alter table public.ar_workorder_issue_details enable row level security;alter table public.ar_workorder_issue_details force row level security;alter table public.ar_workorder_issue_details set(fillfactor=70);grant select on public.ar_workorder_issue_details to authenticated");
 await insert(db,'maintenance');
 const security=async()=>(await db.query("select relowner,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where oid='public.ar_workorder_issue_details'::regclass")).rows;
 const before=await security();await db.exec(sql);await db.exec(sql);assert.deepEqual(await security(),before);
 const options=(await db.query("select option_name,option_value from pg_class c cross join lateral pg_options_to_table(c.reloptions) where oid='public.ar_workorder_issue_details'::regclass")).rows;
 assert.deepEqual(Object.fromEntries(options.map(x=>[x.option_name,x.option_value])),{fillfactor:'70',autovacuum_vacuum_scale_factor:'0.02',autovacuum_vacuum_insert_scale_factor:'0.02',autovacuum_vacuum_insert_threshold:'1000'});
 assert.equal((await db.query('select count(*)::int n from public.ar_workorder_issue_details')).rows[0].n,1);
 await db.exec('alter table public.ar_workorder_issue_details set(autovacuum_vacuum_scale_factor=0.3)');
 await assert.rejects(()=>db.exec(sql),/WORKORDER_MAINTENANCE_SETTINGS_CHANGED/);await db.exec('rollback');
 assert.deepEqual(await security(),before);
}));

test('safe covering index applies twice without replacing its identity or widening its predicate',()=>withDatabase(async db=>{
 await ddlApply(db);const first=await db.query(`select indexrelid::text,pg_get_indexdef(indexrelid) definition,indisvalid,indisready,indnkeyatts,indnatts from pg_index where indexrelid='public.${indexName}'::regclass`);
 await ddlApply(db);assert.deepEqual((await db.query(`select indexrelid::text,pg_get_indexdef(indexrelid) definition,indisvalid,indisready,indnkeyatts,indnatts from pg_index where indexrelid='public.${indexName}'::regclass`)).rows,first.rows);
 assert.equal(first.rows[0].indisvalid,true);assert.equal(first.rows[0].indisready,true);assert.equal(first.rows[0].indnkeyatts,3);assert.equal(first.rows[0].indnatts,14);
}));
async function ddlApply(db){return db.exec(ddl)}

test('a conflicting same-name index is rejected instead of silently accepted',()=>withDatabase(async db=>{
 await db.exec(`create index ${indexName} on public.ar_workorder_issue_details(country_code,platform,work_order_id)`);
 const before=(await db.query(`select pg_get_indexdef('public.${indexName}'::regclass) definition`)).rows;
 await assert.rejects(()=>ddlApply(db),/WORKORDER_DEPOSIT_SAFE_COVER_DRIFT/);await db.exec('rollback');
 assert.deepEqual((await db.query(`select pg_get_indexdef('public.${indexName}'::regclass) definition`)).rows,before);
}));

test('long source fields remain byte-for-byte intact and are omitted only from the safe index',()=>withDatabase(async db=>{
 await ddlApply(db);await insert(db,'normal');
 const long=incompressible(5000),saved=[];
 for(const field of ['utr','work_order_no','payment_order_no','third_party','channel_type'])saved.push(await insert(db,'long-'+field,{[field]:long}));
 saved.push(await insert(db,'multi-byte',{utr:'界'.repeat(600)}));
 await insert(db,'withdraw',{issue_kind:'withdraw'});
 const all=(await db.query('select * from public.ar_workorder_issue_details order by work_order_id')).rows;
 assert.equal(all.length,8);
 for(const row of saved){const stored=all.find(x=>x.work_order_id===row.work_order_id);for(const field of textFields)assert.equal(stored[field],row[field],field);}
 assert.equal(all.find(x=>x.work_order_id==='long-utr').utr.length,5000);
 const eligible=(await db.query(`select work_order_id from public.ar_workorder_issue_details where ${predicate}`)).rows;
 assert.deepEqual(eligible,[{work_order_id:'normal'}]);
 // Eligibility uses the complete byte sum, not character count or UTR alone.
 const multi=(await db.query(`select length(utr) chars,octet_length(utr) bytes from public.ar_workorder_issue_details where work_order_id='multi-byte'`)).rows[0];
 assert.equal(multi.chars,600);assert.equal(multi.bytes,1800);
}));

test('the exact 1500-byte boundary is writable and normal rows support Index Only Scan',()=>withDatabase(async db=>{
 await ddlApply(db);await insert(db,'normal');
 const base={work_order_no:null,payment_order_no:null,third_party:null,channel_type:null,utr:null};
 const id1500='boundary-1500',id1501='boundary-1501';
 const fixed=Buffer.byteLength('IN'+'RAJA'+id1500);
 await insert(db,id1500,{...base,amount:'9999999999999999.99999999',utr:incompressible(1500-fixed)});
 await insert(db,id1501,{...base,utr:incompressible(1501-fixed)});
 const lengths=(await db.query(`select work_order_id,${sizeExpression} bytes from public.ar_workorder_issue_details where work_order_id like 'boundary-%' order by work_order_id`)).rows;
 assert.deepEqual(lengths,[{work_order_id:id1500,bytes:1500},{work_order_id:id1501,bytes:1501}]);
 await db.exec('vacuum analyze public.ar_workorder_issue_details');
 await db.exec('set enable_seqscan=off;set enable_bitmapscan=off');
 const sql=`select ${covered.join(',')} from public.ar_workorder_issue_details where ${predicate} and country_code='IN' and platform='RAJA'`;
 const result=await db.query('explain(analyze,format json) '+sql),plan=Object.values(result.rows[0])[0][0].Plan;
 const scan=nodes(plan).find(n=>n['Index Name']===indexName);
 assert(scan,JSON.stringify(plan));assert.equal(scan['Node Type'],'Index Only Scan');assert.equal(scan['Heap Fetches'],0);
 assert.deepEqual((await db.query(sql)).rows.map(x=>x.work_order_id).sort(),[id1500,'normal']);
 // The fallback can still retrieve the excluded record by the full source PK.
 const fallback=(await db.query(`select octet_length(utr) bytes from public.ar_workorder_issue_details where system_name='AR' and country_code='IN' and platform='RAJA' and work_order_id=$1`,[id1501])).rows;
 assert.equal(fallback[0].bytes,1501-fixed);
}));
