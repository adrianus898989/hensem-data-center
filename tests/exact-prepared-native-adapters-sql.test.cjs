const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),migration=read('supabase/migrations/20261015141000_exact_prepared_aggregates.sql');
const part=name=>migration.split('-- BEGIN '+name+'\n')[1].split('-- END '+name)[0];
function fn(source,name){const p=source.search(new RegExp('create(?: or replace)? function private\\.'+name+'\\(','i'));assert(p>=0,name);const tail=source.slice(p),m=tail.match(/as\s+(\$[a-z_]*\$)/i),end=tail.indexOf(m[1]+';',m.index+m[0].length);return tail.slice(0,end+m[1].length+1);}
async function boot(file){let setup;const filename=path.join(__dirname,file),context=vm.createContext({require:n=>n==='node:test'?{test(){},before:f=>setup=f,after(){}}:createRequire(filename)(n),__dirname,process,console,structuredClone,crypto:require('node:crypto')});
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={get db(){return db},req,add};',context,{filename});await setup();const f=context.fixture,db=f.db;
 await db.exec("do $$begin if not exists(select from pg_roles where rolname='service_role')then create role service_role;end if;end$$;");
 if(file==='wg-existing-orders.test.cjs')await db.exec(`
 create table private.fee_rate_versions(country text);
 create function private.dashboard_admin_fee_category(text,text)returns text language sql as $$select $2$$;
 create function private.dashboard_admin_fee_intervals(text,text,text,text,text,text)returns table(effective_from timestamptz,effective_until timestamptz,percent_rate numeric,fixed_fee numeric)language sql as $$select null::timestamptz,null::timestamptz,null::numeric,null::numeric where false$$;
 create function private.dashboard_admin_fee_quote(text,text,text,text,text,timestamptz,numeric,text)returns jsonb language sql as $$select '{}'::jsonb$$;
 `);
 await db.exec(part('helpers'));await db.exec(part('kernel'));await db.exec(part('expand'));await db.exec(part('mask'));
 await db.exec(fn(read('supabase/migrations/20261015061212_provider_published_snapshot_shadow.sql'),'provider_snapshot_orders_result_kernel'));
 await db.exec(fn(part('worker'),'prepared_aggregate_compute'));
 await db.exec(`create or replace function private.dashboard_admin_order_business_result(j jsonb,text,text,text,uuid)returns jsonb language sql immutable as $$select j$$;`);
 return f;
}
async function run(f,extra){const q=f.req({view:'providers',status:'all',...extra}),db=f.db;const t=(await db.query('select to_jsonb(p)t from private.dashboard_admin_live_platforms()p where p.id=$1',[q.platformId])).rows[0].t;return(await db.query('select private.prepared_aggregate_compute($1,$2)r',[JSON.stringify(q),JSON.stringify(t)])).rows[0].r;}
const creation=r=>r.summary.map(x=>[x.direction,x.all_count,x.all_amount]);
test('DUOLI real updated-clock adapter keeps creation cohort and masks requested true-success instead of using audit/ingest',async()=>{
 const f=await boot('duoli-updated-success.test.cjs');try{
 const legacy=await run(f,{});assert.equal(legacy.summary[0].all_count,4);assert.equal(legacy.summary[0].success_count,2);assert.equal(legacy.successBasis,'source_updated');
 const updated=await run(f,{successBasis:'source_updated',successStartAt:'2026-10-09T00:00:00+07:00',successEndAt:'2026-10-10T00:00:00+07:00'});assert.deepEqual(creation(updated),creation(legacy));assert.ok(updated.summary.every(x=>x.success_count===0));
 for(const view of ['providers','full']){const success=await run(f,{view,successBasis:'success',successStartAt:f.req().startAt,successEndAt:f.req().endAt});assert.deepEqual(creation(success),creation(legacy));assert.ok(success.summary.every(x=>x.success_count===null&&x.success_amount===null));assert.equal(success.capabilities.secondaryTimeAvailable,false);if(view==='full')assert.deepEqual(success.groups.latency,[]);}
 }finally{await f.db.close()}
});
test('YASH real completion-clock adapter supports independent ranges and never calls received_at update time',async()=>{
 const f=await boot('yash-readers.test.cjs');try{
 const baseline=await run(f,{});assert.ok(baseline.summary[0].all_count>0);
 const later=await run(f,{successBasis:'success',successStartAt:'2026-10-08T00:00:00+05:30',successEndAt:'2026-10-09T00:00:00+05:30'});assert.deepEqual(creation(later),creation(baseline));assert.equal(later.summary[0].success_count,1);assert.equal(later.summary[0].success_amount,'500');
 const updated=await run(f,{successBasis:'source_updated',successStartAt:f.req().startAt,successEndAt:f.req().endAt});assert.deepEqual(creation(updated),creation(baseline));assert.ok(updated.summary.every(x=>x.success_count===null));assert.equal(updated.capabilities.secondaryTimeUnavailableReason,'source_update_time_unavailable');
 }finally{await f.db.close()}
});
test('WG real native mixed directions preserve recharge update metrics and mark withdrawal secondary clock unavailable',async()=>{
 const f=await boot('wg-existing-orders.test.cjs');try{
 const base=await run(f,{direction:'all'});assert.ok(base.summary.some(x=>x.direction==='withdraw'&&x.all_count>0));assert.ok(base.summary.filter(x=>x.direction==='withdraw').every(x=>x.success_count===null));
 const changed=await run(f,{direction:'all',successBasis:'source_updated',successStartAt:'2026-10-02T00:00:00-03:00',successEndAt:'2026-10-03T00:00:00-03:00'});assert.deepEqual(creation(changed),creation(base));assert.ok(changed.summary.filter(x=>x.direction==='charge').every(x=>x.success_count===0));assert.ok(changed.summary.filter(x=>x.direction==='withdraw').every(x=>x.success_count===null));assert.equal(changed.capabilities.withdrawSecondaryTimeAvailable,false);
 }finally{await f.db.close()}
});
test('PANDA keeps receipt-proven creation metrics with either requested secondary clock explicitly unavailable',async()=>{
 const f=await boot('panda-native-readers.test.cjs');try{
 for(const basis of ['success','source_updated'])for(const view of ['providers','full']){const r=await run(f,{view,successBasis:basis,successStartAt:f.req({}).startAt,successEndAt:f.req({}).endAt});assert.ok(r.summary[0].all_count>0);assert.ok(r.summary.every(x=>x.success_count===null));assert.equal(r.capabilities.secondaryTimeAvailable,false);if(view==='full')assert.deepEqual(r.groups.latency,[]);}
 }finally{await f.db.close()}
});
