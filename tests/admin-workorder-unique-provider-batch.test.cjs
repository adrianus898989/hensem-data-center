// Real PostgreSQL functions over synthetic records; no production requests or data.
const {test,before}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=fs.readFileSync(path.join(__dirname,'admin-newar-workorder-detail-cohorts.test.cjs'),'utf8').split(/\ntest\(/)[0];
let setup;
const fixtureRequire=name=>name==='node:test'?{...require(name),before:fn=>{setup=fn}}:require(name);
const api=new Function('require','__dirname',fixture+'\nreturn {call,ticket,daily,getDb:()=>db};')(fixtureRequire,__dirname);
const read=p=>fs.readFileSync(path.join(__dirname,'../',p),'utf8');
const operation=read('supabase/operations/workorder-unique-provider-batch.sql');
const patch=operation.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const sig='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)';
let baseline,candidate,metadata;
const db=()=>api.getDb();
const scalar='private.dashboard_admin_live_workorder_provider(country,platform,raw_provider,channel_type)';
const raw="jsonb_to_recordset($1::jsonb) x(country text,platform text,raw_provider text,channel_type text)";
let mapping;
before(async()=>{
 await setup();
 await db().exec(read('supabase/migrations/20261004112744_workorder_platform_direction_unique_totals.sql'));
 await db().exec(read('tests/fixtures/workorder-current-provider-classifiers.sql'));
 baseline=(await db().query('select pg_get_functiondef($1::regprocedure) x',[sig])).rows[0].x;
 metadata=(await db().query("select to_jsonb(p)-'prosrc' x from pg_proc p where oid=$1::regprocedure",[sig])).rows[0].x;
 assert.equal((await db().query('select md5(prosrc) x from pg_proc where oid=$1::regprocedure',[sig])).rows[0].x,'14b1fb584d1d86332a71f9b6451816dd');
 await db().exec(operation);
 candidate=(await db().query('select pg_get_functiondef($1::regprocedure) x',[sig])).rows[0].x;
 mapping='with raw_details as (select * from '+raw+'), provider_inputs as materialized ('+candidate.split('), provider_inputs as materialized (')[1].split('), mapped_details as materialized (')[0]+') select * from provider_names';
});
const normalize=rows=>rows.map(r=>JSON.stringify(r)).sort();
async function mapInputs(inputs){return (await db().query(mapping,[JSON.stringify(inputs)])).rows;}
async function originalInputs(inputs){return (await db().query('select distinct x.*,'+scalar+' provider from '+raw,[JSON.stringify(inputs)])).rows;}
async function unchanged(extra={}){
 const after=await api.call(extra);await db().exec(baseline);
 const before=await api.call(extra);await db().exec(candidate);
 assert.deepEqual(after,before);return after;
}
async function ar(id,original,{provider='SUPER',status=3,date='2026-10-03',platform='Alpha',country='印度',code='IN',kind='deposit',amount=100}={}){
 await db().query(`insert into ar_workorder_issue_details values('AR',$1,$2,$3,$4,$4,$5,null,$6,$7,$8,'BANK',$9,$10,false)`,[code,country,platform,id,original,amount,kind,provider,status,date]);
}
async function dailyAr(){await db().exec(`insert into workorder_deposit_daily
 select submitted_date,country_code,country,platform,third_party,channel_type,'AR_WORKORDER',
 count(*)filter(where issue_kind='deposit'),coalesce(sum(amount)filter(where issue_kind='deposit'),0),
 count(*)filter(where issue_kind='deposit' and status_code=4),coalesce(sum(amount)filter(where issue_kind='deposit' and status_code=4),0),
 count(*)filter(where issue_kind='withdraw'),coalesce(sum(amount)filter(where issue_kind='withdraw'),0),
 count(*)filter(where issue_kind='withdraw' and status_code=4),coalesce(sum(amount)filter(where issue_kind='withdraw' and status_code=4),0),
 '2026-10-04T06:00:00Z','2026-10-04T06:01:00Z','{}'::jsonb
 from ar_workorder_issue_details group by 1,2,3,4,5,6;`);}
test('actual current classifiers retain exact WG/YASH rules, aliases, nulls and live overrides',async()=>{
 const labels=['ArbPayINR','ArbPay2INR-BANK','paytm','qr','kbzpay','wavepay','duitnow','touch n go','USDT(TRC20)-3','Custom','未识别通道',null,'','WinPay','NaNaPay(BRL)','YesPay(VND)'];
 const inputs=[];
 for(const country of ['印度','IN','缅甸','马来','巴西','BR','越南','VN',null])for(const platform of ['Alpha','26BET','98VV','YASH.BET','YASHBET'])for(const raw_provider of labels)for(const channel_type of ['BANK','umoneypayinr',null])inputs.push({country,platform,raw_provider,channel_type});
 await db().exec("insert into private.dashboard_admin_provider_registry values('印度','Alpha','Custom',array['WPay']),('印度','Alpha','',array['UnknownPay']);insert into private.dashboard_admin_provider_overrides values('印度','Alpha','Custom','Reviewed'),('印度','YASH.BET','WinPay','Custom-Yash'),('巴西','26BET','NaNaPay(BRL)','Custom-WG')");
 assert.deepEqual(normalize(await mapInputs(inputs)),normalize(await originalInputs(inputs)));
 await db().exec("update private.dashboard_admin_provider_overrides set canonical_provider='Changed-Live' where platform='Alpha'");
 const updated=await mapInputs(inputs);
 assert.deepEqual(normalize(updated),normalize(await originalInputs(inputs)));
 assert.equal(updated.find(r=>r.country==='印度'&&r.platform==='Alpha'&&r.raw_provider==='Custom').provider,'Changed-Live');
 const yash={country:'印度',platform:'YASHBET',raw_provider:'WinPay',channel_type:null};
 assert.equal((await mapInputs([yash]))[0].provider,'NewWinPay');
 const oldBatch=(await db().query('select * from private.dashboard_admin_live_workorder_provider_batch($1::jsonb)',[JSON.stringify([yash])])).rows[0];
 assert.notEqual(oldBatch.provider,'NewWinPay','test proves that unconditional old batch would change a current native rule');
 assert.deepEqual(await mapInputs([]),[]);
});
test('ordinary distinct inputs call the batch once and never call the scalar fallback',async()=>{
 await db().exec(`alter function private.dashboard_admin_live_workorder_provider(text,text,text,text) rename to test_scalar;
 create function private.dashboard_admin_live_workorder_provider(p_country text,p_platform text,p_raw text,p_channel text)
 returns text language plpgsql stable as $$begin raise exception 'unexpected_scalar';end$$;
 alter function private.dashboard_admin_live_workorder_provider_batch(jsonb) rename to test_batch;
 create sequence batch_calls;
 create function private.dashboard_admin_live_workorder_provider_batch(p_names jsonb)
 returns table(country text,platform text,raw_provider text,channel_type text,provider text) language plpgsql volatile as $$begin
 perform nextval('batch_calls');return query select * from private.test_batch(p_names);end$$;`);
 const inputs=Array.from({length:200},(_,i)=>({country:'印度',platform:'Alpha',raw_provider:'Provider-'+(i%20),channel_type:'BANK'}));
 assert.equal((await mapInputs(inputs)).length,20);
 assert.equal((await db().query('select last_value::int v from batch_calls')).rows[0].v,1);
});
test('full DTO keeps one original across providers/days and all scopes, directions and pagination',async()=>{
 await ar('1','SAME',{status:4});await ar('2','SAME');await ar('3','CONFLICT');await ar('4','CONFLICT',{provider:'OtherPay',status:4});
 await ar('5',null,{provider:'未识别三方'});await ar('6','EARLIER',{date:'2026-10-02'});await ar('7','SAME',{kind:'withdraw'});
 await ar('8','BAD-AMOUNT',{amount:null});await dailyAr();
 await api.ticket('N1','NATIVE');await api.ticket('N2','NATIVE',{status:'4'});await api.ticket('N3',null,{raw:{}});
 const sourceRows=async()=>Promise.all(['ar_workorder_issue_details','newar_detail_records','workorder_deposit_daily'].map(async t=>(await db().query('select to_jsonb(x) value from '+t+' x order by to_jsonb(x)::text')).rows));
 const sourcesBefore=await sourceRows();
 for(const q of [{},{direction:'withdraw'},{providers:['SUPER']},{offset:999},{startAt:'2026-10-02T00:00:00Z'},{platforms:['Alpha']},{platforms:[]}]){
  await unchanged({platforms:['Alpha','DhaniWin','DHANIWIN'],direction:'all',...q});
 }
 await db().query("select set_config('test.scope',$1,true)",[JSON.stringify({platforms:['Alpha']})]);
 const scoped=await unchanged({platforms:['Alpha','DhaniWin','DHANIWIN'],direction:'all'});
 assert.ok(scoped.byPlatformDirection.every(r=>r.source==='ar'));
 assert.deepEqual(await sourceRows(),sourcesBefore,'read-only before/after comparisons never change source or daily rows');
 await db().exec("savepoint denied;set local test.active='false'");await assert.rejects(api.call(),/preview_denied/);await db().exec('rollback to denied');
});
test('only mapping CTE changes, metadata and sources remain identical, operation is idempotent and private',async()=>{
 const start='), provider_names as materialized (',end='), mapped_details as materialized (';
 assert.equal(candidate.slice(0,candidate.indexOf('), provider_inputs as materialized (')),baseline.slice(0,baseline.indexOf(start)));
 assert.equal(candidate.slice(candidate.indexOf(end)),baseline.slice(baseline.indexOf(end)));
 const before=(await db().query("select oid,to_jsonb(p) value from pg_proc p where pronamespace='private'::regnamespace order by oid")).rows;
 await db().exec(patch);
 assert.deepEqual((await db().query("select oid,to_jsonb(p) value from pg_proc p where pronamespace='private'::regnamespace order by oid")).rows,before);
 assert.deepEqual((await db().query("select to_jsonb(p)-'prosrc' x from pg_proc p where oid=$1::regprocedure",[sig])).rows[0].x,metadata);
 await db().exec('savepoint denied;set local role authenticated');await assert.rejects(db().query(`select ${sig.split('(')[0]}('{}','{}')`),/permission denied/);await db().exec('rollback to denied');
});
test('unknown body, metadata and mapping dependencies fail closed without partial changes',async()=>{
 for(const ddl of [`alter function ${sig} security definer`,`alter function ${sig} volatile`,`alter function ${sig} set search_path=public`,`grant execute on function ${sig} to authenticated`]){
  await db().exec('savepoint drift');await db().exec(ddl);await assert.rejects(db().exec(patch),/metadata_or_acl_drift/);await db().exec('rollback to drift');
 }
 await db().exec('savepoint dependency');await db().exec("create or replace function private.dashboard_admin_live_provider_canonical(p_country text,p_platform text,p_raw text) returns text language sql stable security definer set search_path='' as $$select p_raw$$");
 await assert.rejects(db().exec(patch),/dependency_drift/);await db().exec('rollback to dependency');
 await db().exec('savepoint body');await db().exec(candidate.replace('WORKORDER_UNIQUE_PROVIDER_BATCH_V3','UNEXPECTED_BODY'));
 await assert.rejects(db().exec(patch),/baseline_drift/);await db().exec('rollback to body');
});
