// Isolated PostgreSQL tests with synthetic source text; no network or production records.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const migration=read('supabase/migrations/20261002080558_withdraw_rejection_exact_source.sql');
const originals=['4996627','i','5843909','24339947','System abnormal: synthetic case A','System abnormal: synthetic case B','/ [Resubmit order] Recheck your UPI information'];
const extra=['i ',' I','[Resubmit order] Recheck your UPI information','&#40;IFSC Code Incorrect&#41; Check','(IFSC Code Incorrect) Check','line 1\nline 2','line 1 line 2','（源备注为空）','源备注为空',null,'',' \t\n','<img src=x onerror=alert(1)>','a'.repeat(220)+' X','a'.repeat(220)+' Y'];
let db,beforeBlocking,metadata;
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
const call=extra=>scalar('select private.dashboard_admin_live_withdraw_reasons($1::jsonb) value',[JSON.stringify({country:'印度',platform:'AR-A',date:'2026-09-30',kind:'categories',...extra})]);
const attrs=()=>db.query("select oid::regprocedure::text signature,proowner,prosecdef,proconfig,proacl::text,proargnames,provolatile,proparallel,prorettype,prolang from pg_proc where oid in('private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)'::regprocedure) order by signature").then(x=>x.rows);
const note=value=>value!=null&&/\S/.test(value)?value:null;
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql stable as $$select coalesce(current_setting('test.allow',true),'yes')<>'no' and $2 in('印度','IN') and $3 in('AR-A','SNAP-A','WG-A')$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
 create function private.dashboard_admin_live_platforms() returns table(name text,source_name text,country text,scope_group text,source text) language sql stable as $$values('AR-A','AR-A','印度','IN','ar'),('SNAP-A','SNAP-A','印度','IN','newar')$$;
 create function private.dashboard_admin_wg_sites() returns table(country text,country_code text,platform text,site_code text,currency text,timezone text) language sql stable as $$values('印度','IN','WG-A','SYNTHETIC-SITE','INR','Asia/Kolkata')$$;
 create table ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,amount numeric,status text,operator text,applied_at timestamp,completed_at timestamp,manual_remark text,remark text,raw_channel text,updated_at timestamptz default now());
 create table auto_withdraw_daily(country text,data_date date,platform text,total bigint,updated_at timestamptz);
 create table dashboard_platform_team_map(country_name text,country_code text,active boolean);
 create table withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create view withdraw_reasons_daily_grouped as select country_code,platform,stat_date,source_system,jsonb_build_object('note_field','remark','groups',jsonb_build_array(jsonb_build_object('reason_label','FORBIDDEN SEMANTIC MERGE','reject',999,'count',999))) snapshot,updated_at from withdraw_reasons_daily;
 create table wg_detail_coverage(site_code text,business text,basis text,business_date date,complete boolean);
 create table wg_withdraw_details(site_code text,order_number text,member_amount numeric,status_code integer,status_group text,created_at timestamptz,captured_at timestamptz,business_fields jsonb);
 insert into wg_detail_coverage values('SYNTHETIC-SITE','withdraw','created','2026-09-30',true);`);
 const norm=read('supabase/admin-live-withdraw-note-normalization.sql');await db.exec(norm.slice(norm.indexOf('create or replace function'),norm.indexOf('create or replace function private.dashboard_admin_live_rejection_category(')));
 await db.exec(`create function private.dashboard_admin_live_rejection_category(text,text) returns text language sql immutable as $$select coalesce($2,'源备注为空')$$;
`);
 await db.exec(read('tests/fixtures/withdraw-rejection-exact-baseline.sql'));
 await db.exec(`revoke all on function private.dashboard_admin_live_withdraw_reasons(jsonb) from public,anon,service_role;grant execute on function private.dashboard_admin_live_withdraw_reasons(jsonb) to authenticated;
 revoke all on function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) from public,anon,authenticated,service_role;`);
 let i=0;for(const raw of [...originals,...extra,originals[6]]){
  const key='SYNTHETIC-'+(++i);
  await db.query("insert into ar_collected_orders values('AR','IN','AR-A','withdraw',$1,100,'未通过','agent','2026-09-30 12:00','2026-09-30 12:01',$2,$3,'',now())",[key,'首存金额大于19999,首存金额: '+(20000+i),raw]);
  await db.query("insert into wg_withdraw_details values('SYNTHETIC-SITE',$1,100,7,'rejected','2026-09-30T05:00Z',now(),$2)",[key,JSON.stringify({operator_name:'agent',operator_class:'manual',interception_reason:'WG原人工说明',rejection_reason:raw})]);
 }
 await db.exec("insert into ar_collected_orders values('AR','IN','AR-A','withdraw','SUCCESS',100,'已支付','agent','2026-09-30 12:00',null,'首存金额大于19999,首存金额: 40000','成功备注不计驳回','',now());insert into wg_withdraw_details values('SYNTHETIC-SITE','WG-SUCCESS',100,4,'success','2026-09-30T05:00Z',now(),'{\"operator_name\":\"agent\",\"operator_class\":\"manual\",\"interception_reason\":\"WG原人工说明\",\"rejection_reason\":\"成功备注不计驳回\"}');insert into ar_collected_orders values('AR','IN','FOREIGN','withdraw','DO-NOT-LEAK',100,'未通过','agent','2026-09-30 12:00',null,null,'私有外平台备注','',now())");
 beforeBlocking=[];for(const platform of ['AR-A','WG-A']){const d=await call({platform,kind:'blocking'});beforeBlocking.push(d);for(const kind of ['blockingVariants','blockingOrders'])beforeBlocking.push(await call({platform,kind,reasonKey:d.rows[0].reasonKey}));}
 metadata=await attrs();await db.exec(migration);
});
after(async()=>{await db?.close()});
for(const platform of ['AR-A','WG-A']){
 test(platform+' keeps numeric, single-letter, system and Resubmit originals in independent exact groups',async()=>{
  const d=await call({platform,limit:500});assert.equal(d.rejectionGrouping,'exact_source_text_v1');
  for(const raw of originals){const r=d.rows.find(r=>r.sourceReason===raw);assert(r,raw);assert.equal(r.count,raw===originals[6]?2:1);assert.equal(r.category,raw);}
  assert.equal(d.rows.reduce((n,r)=>n+r.count,0),originals.length+extra.length+1);assert.equal(d.noteCount,originals.length+extra.length+1);
  assert(!JSON.stringify(d).includes('成功备注不计驳回'));assert(!JSON.stringify(d).includes('私有外平台备注'));assert(!JSON.stringify(d).includes('其他未归类备注'));
 });
 test(platform+' category and original-distribution drilldowns select the exact same records without changing denominator',async()=>{
  const d=await call({platform,limit:500});const distribution=await call({platform,kind:'rejection',limit:500});assert.equal(distribution.total,d.total);
  for(const r of d.rows){
   const orders=await call({platform,kind:'orders',category:r.categoryKey,limit:500});assert.equal(orders.total,r.count);assert.equal(orders.noteCount,d.noteCount);assert.equal(orders.summary.selectedCount,r.count);
   assert(orders.rows.every(o=>note(o.rejectionReason)===r.sourceReason));assert(orders.rows.every(o=>o.categoryKey===r.categoryKey));
   const detail=distribution.rows.find(g=>g.reasonKey===r.categoryKey);assert(detail);assert.equal(detail.count,r.count);
   const byReason=await call({platform,kind:'orders',reasonKey:detail.reasonKey,limit:500});assert.deepEqual(byReason.rows,orders.rows);
  }
 });
 test(platform+' preserves entities, case, leading/trailing spaces, newlines and long text rather than normalizing labels',async()=>{
  const d=await call({platform,limit:500});for(const raw of extra.filter(x=>note(x)!=null)){const r=d.rows.find(r=>r.sourceReason===raw);assert(r,JSON.stringify(raw));assert.equal(r.count,1);}
  const i=d.rows.find(r=>r.sourceReason==='i'),spaced=d.rows.find(r=>r.sourceReason==='i ');assert.notEqual(i.categoryKey,spaced.categoryKey);
 });
 test(platform+' empty fields are one explicit group and cannot collide with literal placeholder text',async()=>{
  const d=await call({platform,limit:500});const empty=d.rows.find(r=>r.sourceReason===null);assert.equal(empty.count,3);assert.equal(d.summary.missingReason,3);
  for(const raw of ['（源备注为空）','源备注为空'])assert.notEqual(empty.categoryKey,d.rows.find(r=>r.sourceReason===raw).categoryKey);
  assert.equal((await call({platform,kind:'orders',category:empty.categoryKey,limit:500})).total,3);
  const op=await call({platform,kind:'operators'});assert.equal(op.rows[0].missingReasonCount,3);assert.equal(op.rows[0].categoryCount,d.total);
 });
 test(platform+' pagination and scoped order-number search never broaden the selected exact original',async()=>{
  const all=await call({platform,kind:'orders',limit:500}),a=await call({platform,kind:'orders'}),b=await call({platform,kind:'orders',offset:20});assert.equal(a.rows.length,20);assert.equal(a.rows.length+b.rows.length,all.total);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.orderNumber)).size,all.total);
  const r=(await call({platform,limit:500})).rows.find(r=>r.sourceReason===originals[6]);const filtered=await call({platform,kind:'orders',category:r.categoryKey,query:'SYNTHETIC-7'});assert.equal(filtered.total,1);assert.equal(filtered.rows[0].rejectionReason,originals[6]);assert.equal(filtered.noteCount,all.noteCount);
 });
}
test('raw snapshots do not reuse semantic grouped views or fabricate missing order detail',async()=>{
 const groups=[...originals,originals[6],'（源备注为空）',null].map(raw=>({reason_label:raw,classification:raw===null?'empty':'raw',reject:1,count:1,success:0,other:0,operator_class:'manual'}));
 await db.query("insert into withdraw_reasons_daily values('IN','SNAP-A','2026-09-30','NEWAR',$1,now())",[JSON.stringify({note_field:'remark',totals:{reject:groups.length},groups})]);
 const d=await call({platform:'SNAP-A',limit:500});assert.equal(d.available,true);assert.equal(d.rows.reduce((n,r)=>n+r.count,0),groups.length);assert.equal(d.rows.find(r=>r.sourceReason===originals[6]).count,2);assert(!JSON.stringify(d).includes('FORBIDDEN SEMANTIC MERGE'));
 for(const row of d.rows){const exact=await call({platform:'SNAP-A',kind:'rejection',category:row.categoryKey});assert.equal(exact.rows.length,1);assert.equal(exact.rows[0].count,row.count);assert.equal(exact.rows[0].reasonKey,row.categoryKey);}
 assert.equal((await call({platform:'SNAP-A',kind:'orders'})).available,false);assert.equal(d.canViewOrders,false);
});
test('all existing manual blocking summaries, variants and orders remain byte-for-byte equal',async()=>{
 const after=[];for(const platform of ['AR-A','WG-A']){const d=await call({platform,kind:'blocking'});after.push(d);for(const kind of ['blockingVariants','blockingOrders'])after.push(await call({platform,kind,reasonKey:d.rows[0].reasonKey}));}assert.deepEqual(after,beforeBlocking);
});
test('function attributes and reader ACLs are preserved and exact helpers cannot be called by browser/service roles',async()=>{
 assert.deepEqual(await attrs(),metadata);for(const helper of ['exact_note','exact_key'])for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\') value',[role,'private.dashboard_admin_live_rejection_'+helper+'(text)']),false);
 await assert.rejects(()=>call({platform:'FOREIGN'}),/scope_denied/);await assert.rejects(()=>call({category:'x'}),/invalid_filter/);await assert.rejects(()=>call({arbitraryKey:'x'}),/invalid_request/);
 await db.exec("select set_config('test.allow','no',false)");try{await assert.rejects(()=>call({platform:'AR-A'}),/scope_denied/);await assert.rejects(()=>call({platform:'WG-A'}),/scope_denied/);}finally{await db.exec("select set_config('test.allow','yes',false)");}
});
test('migration is idempotent, rejects unexpected deployed bodies, and never writes source data',async()=>{
 const before=await call({limit:500}),count=await scalar('select count(*)::integer value from ar_collected_orders');await db.exec(migration);assert.deepEqual(await call({limit:500}),before);assert.equal(await scalar('select count(*)::integer value from ar_collected_orders'),count);
 await db.exec('begin');try{await db.exec("create or replace function private.dashboard_admin_wg_withdraw_reasons(p_request jsonb,p_scope jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return '{}'::jsonb;end$$");await assert.rejects(db.exec(migration),/baseline changed/);}finally{await db.exec('rollback');}
 assert.doesNotMatch(migration,/\b(?:insert\s+into|delete\s+from|update\s+public|truncate\s+|drop\s+(?:table|view))\b/i);
});
