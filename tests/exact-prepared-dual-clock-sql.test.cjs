// Native SQL engine behavior against synthetic orders; no production access.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');let db,native,f;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const migration=read('supabase/migrations/20261015141000_exact_prepared_aggregates.sql');
const part=name=>migration.split('-- BEGIN '+name+'\n')[1].split('-- END '+name)[0];
before(async()=>{
 const filename=path.join(__dirname,'fee-channel-category.test.cjs');let setup;
 const c=vm.createContext({require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){}}:createRequire(filename)(n),__dirname,process,console,structuredClone});
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.h={get db(){return db},get native(){return native},get f(){return f}};',c,{filename});await setup();({db,native,f}=c.h);
 await db.exec('alter table ar_collected_orders add column money_format_version smallint,add column amount_local numeric,add column currency_local text,add column money_issue_code text;create table private.dashboard_admin_order_provider_confirmations(source_system text,country_code text,platform text,order_kind text,order_no text,confirmed_provider text,active boolean);alter table newar_detail_records add column source_updated_at timestamptz;');
 await db.exec(read('tests/fixtures/admin-live-ar-amount-inline-production.sql'));
 await db.exec(part('helpers'));await db.exec(part('kernel'));
 // Decoration is independent from native cohort SQL and is identity in this
 // clock-only fixture. Provider/result suites exercise the real wrapper.
 await db.exec(`create or replace function private.dashboard_admin_order_business_result(j jsonb,text,text,text,uuid)returns jsonb language sql immutable as $$select j$$;`);
});
after(()=>db?.close());
const target=async(source)=>scalar('select to_jsonb(p)from private.dashboard_admin_live_platforms()p where p.id=$1',[native.request(source).platformId]);
const query=async(source,extra={})=>scalar('select private.prepared_aggregate_raw_kernel($1,$2)',[JSON.stringify(native.request(source,{view:'providers',...extra})),JSON.stringify([await target(source)])]);
function normalized(x){const y=structuredClone(x);for(const k of ['successStartAt','successEndAt','successBasis','asOf'])delete y[k];return y;}
test('same-window created/success metrics preserve legacy native output',async()=>{
 for(const source of ['ar','newar','lg','game66'])for(const view of ['providers','full']){
 const q=native.request(source,{view});const pair=(await db.query('select private.dashboard_admin_live_query_raw($1)old,private.prepared_aggregate_raw_kernel($1,$2)current',[JSON.stringify(q),JSON.stringify([await target(source)])])).rows[0];assert.deepEqual(normalized(pair.current),normalized(pair.old),source+'/'+view);
 }
});
test('disjoint secondary window does not intersect away the created cohort',async()=>{
 for(const source of ['ar','newar','lg','game66']){
 const r=await query(source,{successStartAt:'2026-09-01T00:00:00+05:30',successEndAt:'2026-09-02T00:00:00+05:30',successBasis:'success'});
 const old=await query(source);assert.equal(r.total,old.total,source);assert.ok(r.summary.length>0);assert.ok(r.summary.every(x=>x.success_count===0));assert.deepEqual(r.summary.map(x=>[x.direction,x.all_count,x.all_amount]),old.summary.map(x=>[x.direction,x.all_count,x.all_amount]));
 }
});
test('microseconds retain exact independent boundaries',async()=>{
 const r=await query('ar',{successStartAt:'2026-09-19T01:00:00.000001+05:30',successEndAt:'2026-09-19T01:00:00.000002+05:30',successBasis:'success'});
 assert.match(r.successStartAt,/000001/);assert.match(r.successEndAt,/000002/);assert.equal(r.successBasis,'success');assert.ok(r.summary.every(x=>x.success_count===0));
});
test('independent success window includes historical-created orders once and keeps creation counts separate',async()=>{
 await db.exec('begin');try{
 await db.exec('delete from ar_collected_orders');
 await native.add('ar','charge','CREATED_AND_SUCCESS',100,{created:'2026-09-19 02:00',success:'2026-09-21 01:00'});
 await native.add('ar','charge','OLD_CREATED_SUCCESS',200,{created:'2026-09-17 02:00',success:'2026-09-21 02:00'});
 await native.add('ar','charge','CREATED_OTHER_SUCCESS',300,{created:'2026-09-19 03:00',success:'2026-09-22 01:00'});
 await native.add('ar','charge','END_EXCLUSIVE',400,{created:'2026-09-18 02:00',success:'2026-09-22 00:00'});
 for(const view of ['providers','full']){const r=await query('ar',{view,successStartAt:'2026-09-21T00:00:00+05:30',successEndAt:'2026-09-22T00:00:00+05:30',successBasis:'success'});const s=r.summary.find(x=>x.direction==='charge');assert.equal(s.all_count,2);assert.equal(s.all_amount,'400');assert.equal(s.success_count,2);assert.equal(s.success_amount,'300');assert.equal(r.total,2);}
 }finally{await db.exec('rollback')}
});
test('NEWAR uses real source_updated clock independently and retains native success timestamp for latency',async()=>{
 await db.exec('begin');try{
 await db.exec('delete from newar_detail_records');await native.add('newar','charge','UPDATE_CLOCK',100,{created:'2026-09-19 02:00',success:'2026-09-19 02:01'});
 await db.exec("update newar_detail_records set source_updated_at='2026-09-21T02:00:00+05:30';create index newar_detail_source_updated_success_idx on newar_detail_records(platform,dataset,source_updated_at) where status_group='success'and source_updated_at is not null;");
 const r=await query('newar',{view:'full',successStartAt:'2026-09-21T00:00:00+05:30',successEndAt:'2026-09-22T00:00:00+05:30',successBasis:'source_updated'});assert.equal(r.summary[0].all_count,1);assert.equal(r.summary[0].success_count,1);assert.equal(r.latencySummary[0].mean_ms,60000);
 const success=await query('newar',{successStartAt:'2026-09-21T00:00:00+05:30',successEndAt:'2026-09-22T00:00:00+05:30',successBasis:'success'});assert.equal(success.summary[0].success_count,0);
 }finally{await db.exec('rollback')}
});
