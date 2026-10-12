// Real production reader definitions with synthetic identities only; no network.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261012121938_duoli_native_member_daily.sql');
const baseline=JSON.parse(read('tests/fixtures/duoli-member-daily-production.json'));
const signature='private.dashboard_admin_live_member_daily(jsonb)',helper='private.dashboard_admin_duoli_member_daily(jsonb,timestamptz,timestamptz,text,text[],text)';
let db,H,ids,oldAr,oldMetadata;
const scalar=async(q,args=[])=>(await db.query(q,args)).rows[0].v;
const request=(more={})=>({platformId:ids.UANG,startAt:'2026-10-07T00:00:00+07:00',endAt:'2026-10-08T00:00:00+07:00',direction:'all',...more});
const call=q=>H.call(request(q));
const row=(r,direction='charge',date='2026-10-07')=>r.rows.find(x=>x.direction===direction&&x.date===date);
const transaction=async(fn)=>{await db.exec('begin');try{return await fn();}finally{await db.exec('rollback');}};
async function add(id,patch={}){const r={platform:'UANG',business:'recharge',source_order_id:id,system_name:'DOLI',country:'ID',member_id:'synthetic-member-a',created_at:'2026-10-07T01:00:00+07:00',updated_at:'2026-10-07T01:05:00+07:00',status_code:'2',currency:'IDR',provider_code:'124',...patch};await db.query('insert into private.duoli_order_details select (jsonb_populate_record(null::private.duoli_order_details,$1)).*',[r]);}
const metadata=()=>scalar("select jsonb_agg(to_jsonb(p)-'prosrc' order by p.oid) v from pg_proc p where p.oid=any($1::regprocedure[])",[[signature,'private.dashboard_admin_duoli_capabilities()','public.dashboard_admin_live_member_daily(jsonb)']]);
before(async()=>{
 const file=path.join(__dirname,'admin-live-member-daily.test.cjs');let setup;
 const ctx={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){}}:createRequire(file)(n),__dirname,console,process};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(file,'utf8')+';globalThis.h={get db(){return db},call,as,request,ids,owner,viewer};',ctx,{filename:file});await setup();H=ctx.h;db=H.db;
 await db.exec(`create role service_role;set check_function_bodies=off;
 create table private.duoli_order_details(platform text,business text,source_order_id text,system_name text,country text,member_id text,created_at timestamptz,updated_at timestamptz,status_code text,currency text,provider_code text,primary key(platform,business,source_order_id));
 alter table private.duoli_order_details enable row level security;
 create index duoli_order_details_day_idx on private.duoli_order_details(platform,business,created_at);
 create index duoli_order_details_updated_idx on private.duoli_order_details(platform,business,updated_at) where updated_at is not null;
 insert into fixture_platforms select md5('duoli:ID:'||p)::uuid,p,'M8','印尼','ID','duoli','Asia/Jakarta','IDR',p from unnest(array['UANG','FB168','FB333','HOT985','IND666'])p;
 create or replace function private.dashboard_admin_live_expand_provider_filter(q jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select case when q->'providers' ? 'CombinedPay' then jsonb_set(q,'{providers}','["route-a","route-b"]') when q->'providers' ? 'DuoliCombined' then jsonb_set(q,'{providers}','["YerePay","SecPay"]') else q end$$;
 `);
 for(const x of baseline.dependencies){await db.exec(x.definition);await db.exec('revoke all on function '+x.signature+' from public,anon,authenticated,service_role');}
 for(const x of baseline.functions)await db.exec(x.definition);
 ids=Object.fromEntries((await db.query("select name,id from fixture_platforms where source='duoli'")).rows.map(x=>[x.name,x.id]));
 oldAr=await H.call(H.request());oldMetadata=await metadata();await db.exec(migration);
 await add('A1');await add('A2',{provider_code:'1',member_id:' synthetic-member-a '});
 await add('A3',{member_id:'synthetic-member-b',status_code:'0'});await add('MISSING',{member_id:null});
 await add('MISSING-BLANK',{member_id:'   ',status_code:'99'});
 await add('CROSS-IN',{member_id:'synthetic-cross-in',created_at:'2026-10-06T23:59:59+07:00',updated_at:'2026-10-07T00:00:00+07:00'});
 await add('CROSS-OUT',{member_id:'synthetic-cross-out',created_at:'2026-10-07T23:59:59+07:00',updated_at:'2026-10-08T00:00:00+07:00'});
 await add('EXCLUSIVE-END',{created_at:'2026-10-08T00:00:00+07:00',updated_at:'2026-10-08T00:00:00+07:00'});
 for(let n=0;n<5;n++)await add('W'+n,{business:'withdraw',member_id:'synthetic-withdraw',status_code:n%2?'2':'6'});
 await add('FOREIGN',{platform:'FB168',member_id:'synthetic-foreign'});
});
after(()=>db?.close());
test('created and successful-update clocks dedupe whole provider unions on Jakarta local days',async()=>{
 const r=await call(),c=row(r),w=row(r,'withdraw');
 assert.equal(c.created_order_count,6);assert.equal(c.created_member_count,3);assert.equal(c.created_missing_member_count,2);
 assert.equal(c.success_order_count,4);assert.equal(c.success_member_count,2);assert.equal(c.success_missing_member_count,1);
 assert.equal(w.created_order_count,5);assert.equal(w.created_member_count,1);assert.equal(w.success_member_count,1);
 for(const n of [2,3,4,5])assert.equal(w['success_members_ge'+n],1);
 assert.equal(c.created_members_ge2,1);assert.equal(c.created_members_ge3,0);
 assert.equal(r.capabilities.successTimeBasis,'order_updated_at');assert.equal(r.capabilities.paymentSuccessTimeAvailable,false);
 assert.equal(r.capabilities.sourceCompletenessVerified,false);assert.equal(r.capabilities.withdrawCreatedCoverageAvailable,false);
 assert.doesNotMatch(JSON.stringify(r),/synthetic-member|synthetic-cross|CROSS-IN|source_order_id|member_id/);
});
test('multiple local dates and exact partial-day boundaries never merge daily distinct identities',async()=>{
 const r=await call({endAt:'2026-10-09T00:00:00+07:00',direction:'charge'});assert.equal(r.rows.length,2);
 assert.equal(row(r,'charge','2026-10-08').created_order_count,1);assert.equal(row(r,'charge','2026-10-08').success_member_count,2);
 const x=row(await call({startAt:'2026-10-07T00:00:00+07:00',endAt:'2026-10-07T01:00:00+07:00',direction:'charge'}));
 assert.equal(x.created_order_count,0);assert.equal(x.success_order_count,1);assert.equal(x.success_member_count,1);
});
test('provider aliases expand before native projection and no affiliate/provider fallback is invented',async()=>{
 const canonical=await call({providers:['DuoliCombined']}),raw=await call({providers:['YerePay','SecPay']});assert.deepEqual(canonical.rows,raw.rows);
 assert.equal(row(canonical).created_member_count,3);
 await transaction(async()=>{await add('NOPROVIDER',{provider_code:null,member_id:'synthetic-unassigned'});assert.equal(row(await call({providers:['未识别通道']})).created_member_count,1);assert.equal(row(await call({providers:['nt_affiliate']})).created_order_count,0);});
});
test('unknown statuses and invalid update timestamps are retained in created counts but never become success events',async()=>transaction(async()=>{
 for(const [id,status,updated] of [['UNKNOWN','99','2026-10-07T01:05:00+07:00'],['NULL','2',null],['REVERSE','2','2026-10-07T00:59:59+07:00'],['FUTURE','2','2999-01-01T00:00:00Z'],['INFINITE','2','infinity']])await add(id,{status_code:status,updated_at:updated});
 const c=row(await call());assert.equal(c.created_order_count,11);assert.equal(c.success_order_count,4);
 for(const status of ['0','1','4','7','99'])await add('W-OTHER-'+status,{business:'withdraw',status_code:status});
 const w=row(await call(),'withdraw');assert.equal(w.created_order_count,10);assert.equal(w.success_order_count,5);
}));
test('currency, direction and empty stored windows preserve zero counts without claiming complete collection',async()=>{
 const r=await call({direction:'withdraw',currency:'USDT'});assert.equal(r.rows.length,1);assert.equal(r.rows[0].created_order_count,0);assert.equal(r.capabilities.sourceCompletenessVerified,false);
 const empty=await call({startAt:'2026-09-01T00:00:00+07:00',endAt:'2026-09-03T00:00:00+07:00'});assert.equal(empty.rows.length,4);assert(empty.rows.every(x=>x.created_order_count===0&&x.success_order_count===0));
});
test('live scope, fresh profile and preview grants remain mandatory before DUOLI dispatch',async()=>transaction(async()=>{
 await db.query("update dashboard_profiles set data_scope=$1 where auth_user_id=$2",[{countries:['ID'],platforms:['UANG']},H.viewer]);await H.as(H.viewer);
 const denied=async(q,pattern)=>{await db.exec('savepoint denied');await assert.rejects(call(q),pattern);await db.exec('rollback to denied');};
 assert.equal((await call()).platform.id,ids.UANG);await denied({platformId:ids.FB168},/platform_denied/);
 await db.query('update dashboard_admin_preview_grants set can_view=false where auth_user_id=$1',[H.viewer]);await denied({},/permission|denied/);
 await H.as('');await denied({},/login|permission|denied/);
}));
test('helper refuses forged stable identities, foreign countries and timezone changes; request validation is unchanged',async()=>{
 const platform=await scalar('select to_jsonb(p) v from fixture_platforms p where id=$1',[ids.UANG]);
 for(const patch of [{id:ids.FB168},{scope_group:'IN'},{timezone:'UTC'},{source_name:'OTHER'},{currency:'USDT'},{source:'ar'}])await assert.rejects(scalar('select '+helper.split('(')[0]+"($1,'2026-10-06T17:00Z','2026-10-07T17:00Z','all',null,null) v",[{...platform,...patch}]),/platform_denied/);
 for(const patch of [{direction:'deposit'},{endAt:'2026-12-01T00:00:00+07:00'},{startAt:'2026-10-07 00:00'},{providers:[1]},{orderNumber:'synthetic'}])await assert.rejects(call(patch),/invalid/);
});
test('AR behavior and public/private metadata remain unchanged; DUOLI capability changes only memberDaily',async()=>{
 const now=await H.call(H.request());delete now.asOf;delete oldAr.asOf;assert.deepEqual(now,oldAr);assert.deepEqual(await metadata(),oldMetadata);
 const caps=await scalar('select private.dashboard_admin_duoli_capabilities() v');assert.equal(caps.memberDailyAvailable,true);assert.equal(caps.latencyAvailable,false);assert.equal(caps.paymentSuccessTimeAvailable,false);
 const p=await scalar('select to_jsonb(p) v from pg_proc p where oid=$1::regprocedure',[helper]);assert.equal(p.prosecdef,false);assert.deepEqual(p.proconfig,['search_path=""','jit=off']);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\') v',[role,helper]),false);
});
test('altered production definition or ACL refuses atomically before helper creation',async()=>{
 for(const drift of ['definition','acl'])await transaction(async()=>{
  await db.exec('drop function '+helper);
  for(const f of baseline.functions)await db.exec(f.definition);
  for(const f of baseline.dependencies)await db.exec(f.definition);
  if(drift==='definition')await db.exec(baseline.functions.find(f=>f.schema==='private').definition.replace('-- Same fresh Auth','-- Changed fresh Auth'));
  else await db.exec('grant execute on function private.dashboard_admin_duoli_capabilities() to authenticated');
  // Strip outer transaction only inside this test's rollback boundary.
  await db.exec('savepoint guarded');await assert.rejects(db.exec(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,'')),/dependency definition or permissions changed/);await db.exec('rollback to guarded');
  assert.equal(await scalar('select to_regprocedure($1)::text v',[helper]),null);
 });
});
