// Exact production reader; synthetic feeds and launch dates only.
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migrationNames=fs.readdirSync(path.join(root,'supabase/migrations')).filter(p=>p.endsWith('_configured_newar_intake_launch.sql'));
assert.equal(migrationNames.length,1,'one reviewed configured launch migration is required');
const migration=read('supabase/migrations/'+migrationNames[0]);
const baseline=read('tests/fixtures/intake-configured-launch-baseline.sql'),md5=s=>crypto.createHash('md5').update(s).digest('hex');
const oldLaunch="if dataset='orders' and source_system='newar' then select launch_at into v_launch from public.newar_detail_platforms where platform=v_raw_platform and country_code=v_raw_country and enabled;end if;";
const id='a'.repeat(32),feed=(changes={})=>({id,dataset:'orders',system:'ar',rawCountry:'IN',country:'印度',rawPlatform:'MAAN.WIN',name:'MAAN.WIN',direction:'withdraw',timezone:'Asia/Kolkata',sourceKind:'direct',...changes});
let db,beforeMeta,patchedDefinition;
const metadata=async()=>(await db.query("select to_jsonb(p)-'prosrc' metadata,p.prosrc body from pg_proc p where oid='private.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure")).rows[0];
const call=async(q)=>(await db.query('select private.dashboard_admin_live_intake_coverage($1::jsonb) data',[JSON.stringify(q)])).rows[0].data;
const rows=async(from='2026-10-02',to=from)=>(await call({operation:'rows',feedIds:[id],startAt:from,endAt:to})).rows;
const replaceFeed=async(f)=>{await db.exec('delete from fixture_feeds');await db.query('insert into fixture_feeds values($1::jsonb)',[JSON.stringify(f)]);};
const expectedReject=async(run,pattern)=>{await db.exec('savepoint expected_rejection');try{await assert.rejects(run(),pattern);}finally{await db.exec('rollback to savepoint expected_rejection;release savepoint expected_rejection');}};
before(async()=>{
 db=new PGlite();await db.exec(`
 create schema private;create role anon;create role authenticated;
 create table fixture_feeds(value jsonb);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin if coalesce(current_setting('test.scope',true),'')='' then raise exception 'unauthorized';end if;return current_setting('test.scope')::jsonb;end$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select $1->>'mode'='all' or coalesce($1->'countries' ? $2,false)$$;
 create function private.dashboard_admin_live_intake_feeds(timestamptz) returns jsonb language sql stable as $$select coalesce(jsonb_agg(value),'[]'::jsonb) from public.fixture_feeds where private.dashboard_scope_allows(private.dashboard_admin_live_scope(),value->>'country',value->>'name')$$;
 create function private.dashboard_admin_live_intake_order_feeds(timestamptz) returns jsonb language sql stable as $$select coalesce(jsonb_agg(value),'[]'::jsonb) from public.fixture_feeds where value->>'dataset'='orders' and private.dashboard_scope_allows(private.dashboard_admin_live_scope(),value->>'country',value->>'name')$$;
 create function private.dashboard_admin_wg_current_feeds(jsonb) returns jsonb language sql immutable as $$select $1$$;
 create table ar_config_targets(country_code text,platform text,source_system text);
 create table newar_detail_platforms(country_code text,platform text,enabled boolean,launch_at timestamptz);
 create table ar_collected_orders(country_code text,platform text,order_kind text,source_system text,applied_at timestamp,completed_at timestamp,updated_at timestamptz,raw_channel text,channel_type text);
 create table collection_success_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,snapshot_id uuid,snapshot_at timestamptz,updated_at timestamptz);
 create table newar_detail_records(platform text,dataset text,created_at timestamptz,success_at timestamptz,status_group text,received_at timestamptz);
 create table third_party_volume(country text,platform text,data_date date,direction text,sheet_name text,quarantined_at timestamptz,updated_at timestamptz);
 select set_config('test.scope','{"mode":"all"}',false);
 `);
 await db.exec(baseline+';revoke all on function private.dashboard_admin_live_intake_coverage(jsonb) from public,anon;grant execute on function private.dashboard_admin_live_intake_coverage(jsonb) to authenticated;');
 beforeMeta=await metadata();assert.equal(md5(beforeMeta.body),'30d6ae0bfbb04d0a5ccea48629fa474c');
 await db.exec(migration);const after=await metadata();assert.deepEqual(after.metadata,beforeMeta.metadata);assert.notEqual(after.body,beforeMeta.body);assert.equal(after.body.includes(oldLaunch),false);
 patchedDefinition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_intake_coverage(jsonb)'::regprocedure) definition")).rows[0].definition;
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('begin');
 // Freeze the statement clock only after the real migration and hash guard ran.
 const clock="v_asof timestamptz:=statement_timestamp();";assert.equal(patchedDefinition.split(clock).length,2);
 await db.exec(patchedDefinition.replace(clock,"v_asof timestamptz:=current_setting('test.asof')::timestamptz;"));
 await db.exec("select set_config('test.asof','2026-10-08T12:00:00Z',true);insert into ar_config_targets values('IN','MAAN.WIN','NEW_AR');insert into newar_detail_platforms values('IN','MAAN.WIN',true,'2026-10-06T00:00:00+05:30');");
 await replaceFeed(feed());
});
afterEach(async()=>db.exec('rollback'));

test('configured NEW_AR fallback remains catalogued but October 2 is not expected before October 6 opening',async()=>{
 const catalog=await call({operation:'orderCatalog'});assert.equal(catalog.feeds.length,1);assert.equal(catalog.feeds[0].id,id);assert.equal(catalog.feeds[0].system,'ar');assert.equal(catalog.feeds[0].name,'MAAN.WIN');
 const r=(await rows())[0];assert.equal(r.date,'2026-10-02');assert.equal(r.status,'not_expected');assert.equal(r.expected,false);assert.equal(r.received,false);assert.equal(r.complete,false);assert.equal(r.zeroConfirmed,false);assert.equal(r.evidence,'before_verified_launch');
});
test('India opening midnight changes only October 6 and later into expected days',async()=>{
 const result=await rows('2026-10-05','2026-10-07');assert.deepEqual(result.map(r=>[r.date,r.expected,r.status]),[['2026-10-05',false,'not_expected'],['2026-10-06',true,'not_received'],['2026-10-07',true,'not_received']]);
 assert.equal((await db.query("select launch_at='2026-10-05T18:30:00Z'::timestamptz unchanged from newar_detail_platforms")).rows[0].unchanged,true);
});
test('the launch day remains expected when opening occurs partway through its local day',async()=>{
 await db.exec("update newar_detail_platforms set launch_at='2026-10-06T12:00:00+05:30'");const result=await rows('2026-10-05','2026-10-06');assert.deepEqual(result.map(r=>r.expected),[false,true]);assert.equal(result[1].evidence,'no_created_orders_received');
});
test('ordinary AR, other backend, wrong country, wrong exact platform and disabled config cannot supply a launch exclusion',async()=>{
 const mutations=["update ar_config_targets set source_system='AR'","update ar_config_targets set source_system='WG'","update ar_config_targets set country_code='VN'","update ar_config_targets set platform='MAANWIN'","update newar_detail_platforms set country_code='VN'","update newar_detail_platforms set platform='MAANWIN'","update newar_detail_platforms set enabled=false","update newar_detail_platforms set launch_at=null","delete from ar_config_targets"];
 for(const sql of mutations){await db.exec('savepoint isolation_case');try{await db.exec(sql);const r=(await rows())[0];assert.equal(r.expected,true,sql);assert.equal(r.status,'not_received',sql);assert.equal(r.evidence,'no_created_orders_received',sql);}finally{await db.exec('rollback to savepoint isolation_case;release savepoint isolation_case')}}
});
test('native newar launch handling and actual created records retain their existing semantics',async()=>{
 await replaceFeed(feed({system:'newar'}));await db.exec("insert into newar_detail_records values('MAAN.WIN','withdraw','2026-10-05T18:30Z',null,'pending','2026-10-06T10:00Z')");
 const result=await rows('2026-10-05','2026-10-06');assert.equal(result[0].expected,false);assert.equal(result[1].expected,true);assert.equal(result[1].received,true);assert.equal(result[1].complete,false);assert.equal(result[1].status,'received');
});
test('non-order feeds sharing the configured platform are never excluded by the new launch lookup',async()=>{
 await replaceFeed(feed({dataset:'volume',system:'AR',rawCountry:'IN',sourceKind:'direct'}));const r=(await rows())[0];assert.equal(r.expected,true);assert.equal(r.status,'not_received');assert.equal(r.evidence,'no_daily_report_received');
});
test('a countries-limited scope and unknown feed still fail closed without borrowing configured launch state',async()=>{
 await db.exec(`select set_config('test.scope','{"countries":["越南"]}',true)`);assert.deepEqual((await call({operation:'orderCatalog'})).feeds,[]);
 await expectedReject(()=>rows(),/coverage_feed_denied/);
 await db.exec(`select set_config('test.scope','{"mode":"all"}',true)`);
 await expectedReject(()=>call({operation:'rows',feedIds:['b'.repeat(32)],startAt:'2026-10-02',endAt:'2026-10-02'}),/coverage_feed_denied/);
 await db.exec("select set_config('test.scope','',true)");await expectedReject(()=>call({operation:'orderCatalog'}),/unauthorized/);
});
test('patched reader preserves its full metadata and original body outside the one launch lookup',async()=>{
 await db.exec(patchedDefinition);const after=await metadata();assert.deepEqual(after.metadata,beforeMeta.metadata);
 const beforeParts=beforeMeta.body.split(oldLaunch);assert.equal(beforeParts.length,2);assert(after.body.startsWith(beforeParts[0]));assert(after.body.endsWith(beforeParts[1]));
 assert.deepEqual((await db.query("select has_function_privilege('anon','private.dashboard_admin_live_intake_coverage(jsonb)','execute') anon,has_function_privilege('authenticated','private.dashboard_admin_live_intake_coverage(jsonb)','execute') authenticated")).rows[0],{anon:false,authenticated:true});
 assert.doesNotMatch(migration,/\b(?:grant|revoke|insert into|delete from|update public|alter table)\b/i);
});
test('body and privilege drift abort before replacing a newer definition',async()=>{
 for(const change of ["alter function private.dashboard_admin_live_intake_coverage(jsonb) security invoker","grant execute on function private.dashboard_admin_live_intake_coverage(jsonb) to anon"]){
 await db.exec('savepoint drift_case');try{await db.exec(change);await assert.rejects(db.exec(migration),/metadata_drift/);}finally{await db.exec('rollback');await db.exec('begin');await db.exec(patchedDefinition)}}
 await db.exec(patchedDefinition.replace('begin\n','begin\n -- unrelated newer reader\n'));await assert.rejects(db.exec(migration),/baseline_drift/);await db.exec('rollback');await db.exec('begin');
});
