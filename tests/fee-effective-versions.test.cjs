// Real PostgreSQL publisher and query engines, synthetic records only.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261002080803_immutable_fee_effective_versions.sql');
let f,db,seq=0;
async function bootstrap(){const filename=path.join(__dirname,'admin-duration-precision-ranges.test.cjs'),req=createRequire(filename);let setup;
 const ctx={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){}}:req(n),__dirname,process,console,structuredClone};vm.createContext(ctx);vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={get db(){return db},request,call,add,as};',ctx,{filename});await setup();return ctx.fixture;}
const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
const rate=(extra={})=>({id:'rate',sheet_name:'Synthetic',country:'IN',category:'BANK',third_party:'SelectedPay',collect_fee:'1%',payout_fee:'2%',total_fee:'',collect_single_fee:'0',payout_single_fee:'0',collect_limit:'',payout_limit:'',status:'active',source_row:2,channel_info:'',leak:'',whitelist:'',...extra});
const evidence=(extra={})=>({id:'rate',sheetId:17,effectiveFrom:'2026-09-18T00:00:00+05:30',currency:null,state:'ready',effectiveCell:'BB2',currencyCell:null,...extra});
const input=(rates=[rate()],ev=[evidence()])=>({id:crypto.randomUUID(),at:new Date(Date.UTC(2026,9,1,0,0,++seq)).toISOString(),rates,ev,status:[{...rate(),id:'status',platform:'Synthetic',raw_status:'active',source_column:3}],manifest:{complete:true,sheets:['Synthetic']}});
const publish=x=>scalar('select public.fee_rate_publish_generation($1,$2,$3,$4,$5,$6,$7)',[x.id,'synthetic-book',x.at,JSON.stringify(x.rates),JSON.stringify(x.status),JSON.stringify(x.ev),JSON.stringify(x.manifest)]);
const quote=(created='2026-09-19T10:00:00+05:30',extra={})=>scalar('select private.dashboard_admin_fee_quote($1,$2,$3,$4,$5,$6,$7)',['IN','Synthetic',extra.provider||'SelectedPay',extra.direction||'charge',extra.currency===undefined?'INR':extra.currency,created,extra.amount===undefined?1000:extra.amount]);
async function rollback(fn){await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}}
before(async()=>{f=await bootstrap();db=f.db;
 await db.exec(`create role service_role;create table third_party_rates(id text primary key,sheet_name text,country text,category text,third_party text,collect_fee text,payout_fee text,total_fee text,collect_single_fee text,payout_single_fee text,collect_limit text,payout_limit text,channel_info text,leak text,whitelist text,status text,source_row integer,created_at timestamptz,updated_at timestamptz);
 create table third_party_platform_status(id text primary key,sheet_name text,country text,platform text,category text,third_party text,collect_fee text,payout_fee text,total_fee text,collect_single_fee text,payout_single_fee text,collect_limit text,payout_limit text,status text,raw_status text,source_row integer,source_column integer,created_at timestamptz,updated_at timestamptz);
 create table sync_status(module text primary key,last_sync_at timestamptz,status text,message text,updated_at timestamptz);
 create or replace function private.dashboard_data_group(text,text) returns text language sql immutable as $$select case $1 when '印度' then 'IN' else $1 end$$;
 create or replace function private.dashboard_admin_live_provider_canonical(text,text,text) returns text language sql stable as $$select case when $3='AliasPay' then 'SelectedPay' else $3 end$$;`);
 for(const name of ['query-raw','rates','remap-groups'])await db.exec(read('tests/fixtures/fee-versions/production-'+name+'.sql'));
 await db.exec('revoke all on function private.dashboard_admin_live_query_raw(jsonb),private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean),private.dashboard_admin_live_rates(jsonb) from public,anon,authenticated;grant execute on function private.dashboard_admin_live_rates(jsonb) to authenticated;');
 await db.exec(migration);
});
after(()=>db?.close());
test('complete publication updates both projections atomically and retry is idempotent',async()=>rollback(async()=>{
 const x=input();const out=await publish(x);assert.equal(out.feeVersions.inserted,2);assert.equal(out.feeVersions.state,'complete');assert.deepEqual(await publish(x),out);
 assert.equal(await scalar('select count(*)::int from private.fee_rate_versions'),2);assert.equal(await scalar('select count(*)::int from third_party_platform_status'),1);
 const fresh=input();assert.equal((await publish(fresh)).feeVersions.inserted,0,'hourly observation is not a new effective version');
 assert.equal(await scalar('select count(*)::int from private.fee_rate_versions'),2);
}));
test('two explicit versions retain old prices and exact creation-time boundary across a later success window',async()=>rollback(async()=>{
 await publish(input());await publish(input([rate({collect_fee:'3%'})],[evidence({effectiveFrom:'2026-09-19T12:00:00+05:30'})]));
 assert.equal((await quote('2026-09-19T11:59:59.999+05:30')).fee_version_estimated_amount,'10.00000000000000000000');
 assert.equal(Number((await quote('2026-09-19T12:00:00+05:30')).fee_version_estimated_amount),30);
 assert.equal((await quote('2026-09-17T23:59:59+05:30')).fee_version_state,'unknown');
 const r=await quote();assert.equal(r.fee_version_basis,'order_created_at');assert.equal(r.fee_version_ids.length,1);
}));
test('same timestamp conflicting price cannot overwrite history; backdated version cannot insert',async()=>rollback(async()=>{
 await publish(input());const before=await scalar('select jsonb_agg(to_jsonb(v) order by id) from private.fee_rate_versions v');
 let r=await publish(input([rate({collect_fee:'9%'})]));assert.equal(r.feeVersions.inserted,0);assert.equal(r.feeVersions.unversionedRules,1);
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(v) order by id) from private.fee_rate_versions v'),before);
 r=await publish(input([rate({collect_fee:'4%'})],[evidence({effectiveFrom:'2026-09-17T00:00:00Z'})]));assert.equal(r.feeVersions.inserted,0);
 assert.equal(await scalar('select count(*)::int from private.fee_rate_versions'),2);
}));
test('missing or invalid explicit time never uses observation time and still displays current rates',async()=>rollback(async()=>{
 for(const ev of [evidence({effectiveFrom:null,state:'missing_effective_column'}),evidence({effectiveFrom:'2026-09-19',state:'ready'}),evidence({effectiveFrom:'2026-02-30T00:00:00Z'})]){
 const r=await publish(input([rate()],[ev]));assert.equal(r.feeVersions.inserted,0);assert.equal(r.feeVersions.state,'unknown');assert.equal((await quote()).fee_version_estimated_amount,null);
 }
 assert.equal(await scalar('select collect_fee from third_party_rates'), '1%');
}));
test('currency unknown never defaults; fixed money requires explicit source currency while pure percentages do not',async()=>rollback(async()=>{
 await publish(input());assert.equal((await quote(undefined,{currency:null})).fee_version_state,'unknown');
 await publish(input([rate({collect_single_fee:'6'})],[evidence({effectiveFrom:'2026-09-19T00:00:00Z'})]));assert.equal((await quote()).fee_version_state,'unknown');
 await publish(input([rate({collect_single_fee:'6'})],[evidence({effectiveFrom:'2026-09-19T01:00:00Z',currency:'INR'})]));assert.equal(Number((await quote()).fee_version_estimated_amount),16);
 assert.equal((await quote(undefined,{currency:'USD'})).fee_version_state,'unknown');
}));
test('unsupported tier, invalid amount, missing creation time and overlapping category conflicts stay unknown',async()=>rollback(async()=>{
 await publish(input());for(const amount of [null,-1,'NaN','Infinity'])assert.equal((await quote(undefined,{amount})).fee_version_state,'unknown');
 assert.equal((await quote(null)).fee_version_state,'unknown');
 await publish(input([rate(),rate({id:'other',category:'QR',collect_fee:'2%'})],[evidence(),evidence({id:'other'})]));assert.equal((await quote()).fee_version_state,'unknown');
}));
test('moving source row preserves immutable rule identity; unknown provider or country cannot borrow',async()=>rollback(async()=>{
 await publish(input());const r=await publish(input([rate({id:'moved',source_row:20})],[evidence({id:'moved',effectiveCell:'BB20'})]));assert.equal(r.feeVersions.inserted,0);
 assert.equal(Number((await quote()).fee_version_estimated_amount),10);assert.equal((await quote(undefined,{provider:'OTHER'})).fee_version_state,'unknown');
 assert.equal((await scalar("select private.dashboard_admin_fee_quote('PK','Synthetic','SelectedPay','charge','INR','2026-09-19Z',1000)" )).fee_version_state,'unknown');
}));
test('service-only publisher, private RLS and immutable versions resist direct access',async()=>rollback(async()=>{
 await publish(input());assert.equal(await scalar("select bool_and(relrowsecurity) from pg_class where relnamespace='private'::regnamespace and relname like 'fee_rate_%' and relkind='r'"),true);
 for(const role of ['anon','authenticated']){await db.exec('savepoint denied;set role '+role);await assert.rejects(publish(input()),/permission denied/);await db.exec('rollback to denied');}
 for(const statement of ["update private.fee_rate_versions set fixed_fee=1","delete from private.fee_rate_versions"]){await db.exec('savepoint immutable');await assert.rejects(db.exec(statement),/fee_version_immutable/);await db.exec('rollback to immutable');}
 await db.exec('savepoint service;set role service_role');assert.equal((await publish(input())).ok,true);await db.exec('rollback to service');
}));
test('incomplete input and stale generation roll back both projections without half publication',async()=>rollback(async()=>{
 await publish(input());const before=await scalar('select jsonb_agg(to_jsonb(r)) from third_party_rates r');
 const x=input();x.status.push({...x.status[0]});await db.exec('savepoint bad');await assert.rejects(publish(x),/incomplete_fee_generation/);await db.exec('rollback to bad');assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(r)) from third_party_rates r'),before);
 x.status.length=1;x.at='2026-09-30T00:00:00Z';await db.exec('savepoint stale');await assert.rejects(publish(x),/stale_fee_generation/);await db.exec('rollback to stale');
}));
test('actual native aggregate full/providers engines conserve successful fee matched+unmatched counts',async()=>rollback(async()=>{
 await publish(input([rate({country:'IN'})],[evidence({effectiveFrom:'2026-09-19T01:00:00+05:30'})]));
 for(const source of ['ar','newar','game66','lg'])for(const view of ['full','providers']){
 const out=await f.call(f.request(source,{view,direction:'charge'}));
 for(const row of out.groups.provider){assert.equal(row.fee_version_matched_count+row.fee_version_unmatched_count,row.success_count,source+'/'+view);assert.ok(['unknown','partial','complete'].includes(row.fee_version_state));}
 }
}));
test('same-identity conflicting source rows cannot publish the first row as a usable rate',async()=>rollback(async()=>{
 const r=await publish(input([rate(),rate({id:'duplicate',collect_fee:'9%'})],[evidence(),evidence({id:'duplicate'})]));
 assert.equal(r.feeVersions.inserted,1,'only identical payout rule remains valid');assert.equal((await quote()).fee_version_state,'unknown');
 assert.equal(await scalar("select count(*)::int from private.fee_rate_versions where direction='charge'"),0);
}));
test('actual raw AR query applies old and new creation prices when both succeed in one later day',async()=>rollback(async()=>{
 await db.exec("delete from ar_collected_orders");await publish(input());
 await publish(input([rate({collect_fee:'3%'})],[evidence({effectiveFrom:'2026-09-19T00:00:00+05:30'})]));
 await f.add('ar','charge','OLD',1000,{created:'2026-09-18 23:59:59',success:'2026-09-19 04:00'});
 await f.add('ar','charge','NEW',1000,{created:'2026-09-19 00:00:00',success:'2026-09-19 04:00'});
 await f.add('ar','charge','BEFORE',1000,{created:'2026-09-17 23:59:59',success:'2026-09-19 04:00'});
 for(const view of ['full','providers']){
  const out=await f.call(f.request('ar',{direction:'charge',view})),row=out.groups.provider[0];assert.equal(row.success_count,3);assert.equal(row.fee_version_matched_count,2);assert.equal(row.fee_version_unmatched_count,1);assert.equal(Number(row.fee_version_estimated_amount),40);assert.equal(row.fee_version_state,'partial');
 }
 const detail=await f.call(f.request('ar',{action:'details',direction:'charge',status:'success'}));assert.equal(detail.rows.length,3);
 assert.equal(Number(detail.rows.find(r=>r.order_number==='OLD').fee_version_estimated_amount),10);assert.equal(Number(detail.rows.find(r=>r.order_number==='NEW').fee_version_estimated_amount),30);assert.equal(detail.rows.find(r=>r.order_number==='BEFORE').fee_version_state,'unknown');
}));
test('canonical provider merge preserves partial subtotal but never invents a price for an unknown leaf',async()=>rollback(async()=>{
 const rows=[{provider:'SelectedPay',direction:'charge',currency:'INR',fee_version_matched_count:1,fee_version_unmatched_count:0,fee_version_estimated_amount:'10',fee_version_state:'complete'},
 {provider:'AliasPay',direction:'charge',currency:'INR',fee_version_matched_count:0,fee_version_unmatched_count:2,fee_version_estimated_amount:null,fee_version_state:'unknown'}];
 for(const data of [rows,[...rows].reverse()]){const out=await scalar("select private.dashboard_admin_live_remap_groups($1,'IN','Synthetic',false)",[JSON.stringify(data)]);assert.equal(out.length,1);assert.equal(out[0].fee_version_matched_count,1);assert.equal(out[0].fee_version_unmatched_count,2);assert.equal(Number(out[0].fee_version_estimated_amount),10);assert.equal(out[0].fee_version_state,'partial');}
}));
test('failure late in current-projection publication rolls back new versions and the generation receipt',async()=>rollback(async()=>{
 await publish(input());const before=await scalar('select jsonb_build_array((select count(*) from private.fee_rate_versions),(select count(*) from private.fee_rate_generations),(select jsonb_agg(to_jsonb(x)) from third_party_rates x))');
 await db.exec("alter table third_party_platform_status add constraint simulated_rejection check(platform<>'FAIL');savepoint failprojection");
 const x=input([rate({collect_fee:'4%'})],[evidence({effectiveFrom:'2026-09-19T00:00:00Z'})]);x.status[0].platform='FAIL';await assert.rejects(publish(x),/simulated_rejection/);await db.exec('rollback to failprojection');
 assert.deepEqual(await scalar('select jsonb_build_array((select count(*) from private.fee_rate_versions),(select count(*) from private.fee_rate_generations),(select jsonb_agg(to_jsonb(x)) from third_party_rates x))'),before);
}));
test('raw query retains active account and scope denial; service publisher cannot open query helper ACL',async()=>rollback(async()=>{
 await publish(input());await f.as('10000000-0000-0000-0000-000000000002');await db.exec('savepoint denied');await assert.rejects(()=>f.call(f.request('ar')),/platform_denied|preview_denied/);await db.exec('rollback to denied');
 await f.as('10000000-0000-0000-0000-000000000001');await db.exec("update dashboard_profiles set active=false where role='owner'");await db.exec('savepoint inactive');await assert.rejects(()=>f.call(f.request('ar')),/preview_denied/);await db.exec('rollback to inactive');
 assert.equal(await scalar("select has_function_privilege('authenticated','private.dashboard_admin_fee_quote(text,text,text,text,text,timestamptz,numeric)','EXECUTE')"),false);
}));
test('function replacement guards reject actual body, ACL or execution-setting drift and retain OIDs',async()=>rollback(async()=>{
 const guards=[...migration.matchAll(/do \$patch_\d\$[\s\S]+?end \$patch_\d\$;/g)].map(m=>m[0]).join('\n');
 for(const name of ['query-raw','rates','remap-groups'])await db.exec(read('tests/fixtures/fee-versions/production-'+name+'.sql'));
 const metadata=()=>scalar("select jsonb_agg(to_jsonb(p)-'prosrc' order by oid) from pg_proc p where oid in ('private.dashboard_admin_live_query_raw(jsonb)'::regprocedure,'private.dashboard_admin_live_rates(jsonb)'::regprocedure,'private.dashboard_admin_live_remap_groups(jsonb,text,text,boolean)'::regprocedure)");
 const before=await metadata();await db.exec('savepoint original');await db.exec(guards);assert.deepEqual(await metadata(),before);await db.exec('rollback to original');
 for(const change of ["grant execute on function private.dashboard_admin_live_query_raw(jsonb) to authenticated","alter function private.dashboard_admin_live_query_raw(jsonb) set work_mem='8MB'","create or replace function private.dashboard_admin_live_query_raw(p_request jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path='' set jit='off' as $$begin return '{}';end$$"]){
  await db.exec('savepoint drift;'+change);await assert.rejects(db.exec(guards),/fee_function_(metadata|baseline)_drift/);await db.exec('rollback to drift');
 }
}));
test('no version history short-circuits matching yet correctly reports the full unpriced success cohort',async()=>rollback(async()=>{
 assert.equal(await scalar('select count(*)::int from private.fee_rate_versions'),0);
 for(const view of ['full','providers']){const r=await f.call(f.request('ar',{direction:'charge',view}));for(const row of r.groups.provider){assert.equal(row.fee_version_matched_count,0);assert.equal(row.fee_version_unmatched_count,row.success_count);assert.equal(row.fee_version_state,row.success_count?'unknown':'complete');assert.equal(row.fee_version_estimated_amount,row.success_count?null:'0');}}
}));
test('production-sized synthetic generation publishes complete 512 rates and 4766 statuses without per-batch visibility',async()=>rollback(async()=>{
 const rates=Array.from({length:512},(_,i)=>rate({id:'r'+i,third_party:'SyntheticPay'+i,source_row:i+2}));
 const ev=rates.map((r,i)=>evidence({id:r.id,effectiveCell:'BB'+(i+2)}));const x=input(rates,ev);
 x.status=Array.from({length:4766},(_,i)=>({...x.status[0],id:'s'+i,third_party:'SyntheticPay'+i%512,platform:'Platform'+i%18}));
 const t=performance.now(),out=await publish(x);assert.equal(out.rates,512);assert.equal(out.platformStatuses,4766);assert.equal(out.feeVersions.inserted,1024);
 assert.equal(await scalar('select count(*)::int from private.fee_rate_versions'),1024);
 console.log('synthetic complete-generation milliseconds:',Math.round(performance.now()-t));
}));
test('an unversioned current category cannot be ignored to extend another category current price',async()=>rollback(async()=>{
 await publish(input([rate(),rate({id:'other',category:'QR',collect_fee:'9%'})],[evidence(),evidence({id:'other',effectiveFrom:null,state:'missing_effective_time'})]));
 assert.equal((await quote()).fee_version_state,'unknown');
}));
test('a fee inherited from another source row cannot borrow the receiving rows effective timestamp',async()=>rollback(async()=>{
 const r=await publish(input([rate()],[evidence({chargeState:'inherited_fee_without_time_proof'})]));
 assert.equal(r.feeVersions.inserted,1);assert.equal((await quote()).fee_version_state,'unknown');assert.equal((await quote(undefined,{direction:'withdraw'})).fee_version_state,'complete');
}));
test('explicitly different fee currencies cannot contaminate or shadow the matching currency rule',async()=>rollback(async()=>{
 await publish(input([rate({category:'INR',collect_fee:'1%'}),rate({id:'usd',category:'USD',collect_fee:'8%'})],[evidence({currency:'INR'}),evidence({id:'usd',currency:'USD'})]));
 assert.equal(Number((await quote()).fee_version_estimated_amount),10);assert.equal(Number((await quote(undefined,{currency:'USD'})).fee_version_estimated_amount),80);assert.equal((await quote(undefined,{currency:'PHP'})).fee_version_state,'unknown');
}));
test('non-finite creation time never acquires an open-ended historical fee',async()=>rollback(async()=>{
 await publish(input());for(const created of ['Infinity','-Infinity',null])assert.equal((await quote(created)).fee_version_state,'unknown');
 await db.exec('delete from ar_collected_orders');await f.add('ar','charge','INFINITE',1000,{created:'Infinity',success:'2026-09-19 04:00'});
 for(const view of ['full','providers']){const r=await f.call(f.request('ar',{view,direction:'charge'})),row=r.groups.provider[0];assert.equal(row.success_count,1);assert.equal(row.fee_version_matched_count,0);assert.equal(row.fee_version_unmatched_count,1);assert.equal(row.fee_version_state,'unknown');}
}));
test('legacy or out-of-band current projection writes cannot keep stale open-interval price evidence',async()=>rollback(async()=>{
 await publish(input());assert.equal((await quote()).fee_version_state,'complete');
 await db.exec("update third_party_rates set collect_fee='9%',updated_at=updated_at+interval '1 second'");assert.equal((await quote()).fee_version_state,'unknown');
}));
test('AR inferred display currency cannot price percentage or fixed fees without exact native config evidence',async()=>rollback(async()=>{
 await db.exec('delete from ar_collected_orders');await f.add('ar','charge','CURRENCY-PROOF',1000);
 for(const fixed of ['0','6']){
  await publish(input([rate({collect_single_fee:fixed})],[evidence({currency:'INR',effectiveFrom:fixed==='0'?'2026-09-18T00:00:00+05:30':'2026-09-19T00:00:00+05:30'})]));
  await db.exec("update ar_config_targets set currency=null where country_code='IN' and platform='AR-BANDS'");
  for(const view of ['full','providers']){const out=await f.call(f.request('ar',{direction:'charge',view})),row=out.groups.provider[0];assert.equal(out.platform.currency,'INR','legacy country fallback display retained');assert.equal(row.currency,'INR');assert.equal(row.success_count,1);assert.equal(row.success_amount,'1000');assert.equal(row.fee_version_matched_count,0);assert.equal(row.fee_version_unmatched_count,1);assert.equal(row.fee_version_estimated_amount,null);}
  const details=await f.call(f.request('ar',{action:'details',direction:'charge',status:'success'}));assert.equal(details.rows[0].currency,'INR');assert.equal(details.rows[0].fee_version_state,'unknown');
  await db.exec("update ar_config_targets set currency='INR' where country_code='IN' and platform='AR-BANDS'");
  const known=await f.call(f.request('ar',{direction:'charge',view:'providers'}));assert.equal(known.groups.provider[0].fee_version_matched_count,1);assert.equal(Number(known.groups.provider[0].fee_version_estimated_amount),10+Number(fixed));
 }
}));
test('NEW_AR prices only explicit order currency rather than platform currency',async()=>rollback(async()=>{
 await publish(input());await db.exec('delete from newar_detail_records');await f.add('newar','charge','MISSING-CURRENCY',1000);await db.exec('update newar_detail_records set currency=null');
 for(const view of ['full','providers']){const out=await f.call(f.request('newar',{direction:'charge',view})),row=out.groups.provider[0];assert.equal(row.success_count,1);assert.equal(row.fee_version_matched_count,0);assert.equal(row.fee_version_unmatched_count,1);assert.equal(row.fee_version_state,'unknown');}
 const details=await f.call(f.request('newar',{action:'details',direction:'charge',status:'success'}));assert.equal(details.rows[0].fee_version_state,'unknown');
}));
test('confirmed GAME66 India monetary adapter uses India fee rules without changing team authorization scope',async()=>rollback(async()=>{
 await publish(input());await db.exec('delete from game66_charge_orders;delete from game66_withdraw_orders');await f.add('game66','charge','TEAM-SCOPE',1000);
 for(const view of ['full','providers']){const out=await f.call(f.request('game66',{direction:'charge',view})),row=out.groups.provider[0];assert.equal(out.platform.scopeGroup,'HK_TEAM');assert.equal(row.currency,'INR');assert.equal(row.fee_version_matched_count,1);assert.equal(Number(row.fee_version_estimated_amount),10);}
 const details=await f.call(f.request('game66',{action:'details',direction:'charge',status:'success'}));assert.equal(Number(details.rows[0].fee_version_estimated_amount),10);
}));
test('confirmed LG currency contract matches only its country and rejects changed or unknown adapter currency',async()=>rollback(async()=>{
 await publish(input([rate({country:'PH'})],[evidence({currency:'PHP'})]));await db.exec('delete from lg_orders');await f.add('lg','charge','LG-CURRENCY',1000);
 for(const view of ['full','providers']){const out=await f.call(f.request('lg',{direction:'charge',view})),row=out.groups.provider[0];assert.equal(row.currency,'PHP');assert.equal(row.fee_version_matched_count,1);assert.equal(Number(row.fee_version_estimated_amount),10);}
 const def=await scalar("select pg_get_functiondef('private.dashboard_admin_live_platforms()'::regprocedure)");assert.ok(def.includes("'PHP'"));await db.exec(def.replace("'PHP'","'INR'"));
 for(const view of ['full','providers']){const out=await f.call(f.request('lg',{direction:'charge',view})),row=out.groups.provider[0];assert.equal(row.success_count,1);assert.equal(row.fee_version_matched_count,0);assert.equal(row.fee_version_unmatched_count,1);}
}));
test('native aggregate non-finite monetary input remains an unmatched success rather than a priced Infinity',async()=>rollback(async()=>{
 await publish(input());await db.exec('delete from ar_collected_orders');for(const [i,amount] of ['Infinity','-Infinity','NaN'].entries())await f.add('ar','charge','NONFINITE-'+i,amount);
 for(const view of ['full','providers']){const out=await f.call(f.request('ar',{direction:'charge',view})),row=out.groups.provider[0];assert.equal(row.success_count,3);assert.equal(row.fee_version_matched_count,0);assert.equal(row.fee_version_unmatched_count,3);assert.equal(row.fee_version_estimated_amount,null);assert.equal(row.fee_version_state,'unknown');}
}));
