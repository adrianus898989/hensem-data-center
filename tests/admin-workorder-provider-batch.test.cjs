const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=n=>fs.readFileSync(path.join(__dirname,'../supabase',n),'utf8');
const patch=sql('admin-live-workorder-provider-batch.sql');
const part=(s,start,end)=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)+start.length));
let db,fixtures=[];
before(async()=>{db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;
create table private.dashboard_admin_provider_registry(country text,platform text,raw_provider text,canonical_values text[],primary key(country,platform,raw_provider));
create table private.dashboard_admin_provider_overrides(country text,platform text,raw_provider text,canonical_provider text,primary key(country,platform,raw_provider));`);
const aliases=sql('admin-live-provider-aliases.sql');await db.exec(part(aliases,'create or replace function private.dashboard_admin_live_provider_alias(','revoke all'));
const config=sql('admin-live-configuration.sql');await db.exec(part(config,'create or replace function private.dashboard_admin_live_provider_alias_values(','create or replace function private.dashboard_admin_live_provider_rows('));
const usdt=sql('admin-live-india-usdt-classification.sql');await db.exec(part(usdt,'create or replace function private.dashboard_admin_live_confirmed_usdt_provider(','create or replace function private.dashboard_admin_live_provider_rows('));
const wo=sql('admin-live-configuration-workorders.sql');await db.exec(part(wo,'create or replace function private.dashboard_admin_live_workorder_provider(','create or replace function private.dashboard_admin_live_workorders('));
await db.exec(patch.slice(0,patch.indexOf('do $patch$'))+'commit;');
const cases=[['paytm','haoxpayinr'],['paytm','wpayinr'],['paytm','ic2payinr'],['paytm','ninepayinr'],['paytm','ox2payinr'],['paytm','rapayinr'],['paytm','umoneypayinr'],['paytm','wepay2inr'],['paytm','unknown'],['paytm','paytm'],['qr','umoneypayinr'],['qr','wepay2inr'],['qr',null],['ArbPayINR','BANK'],['UPI-QR','ArbPayINR'],['ArbPay2INR-BANK','BANK'],['kbzpay','kingpaymmk'],['wavepay','ytpaymmk'],['kbzpay','unknown'],['duitnow','fpaymyr'],['touch n go','truepaymyr'],['touch n go','unknown'],['USDT(TRC20)-3',null],['USDT(TRC20)-4','USDT'],['USDT(TRC20)-5','USDT'],['USDT(BEP20)-5','USDT'],['Wallet66-USDT',''],['Custom',null],['Ambiguous',null],['AliasSet',''],['EmptySet',''],['OverrideOnly',null],['未识别通道',null],['  unknown  ','  '],[null,null],['',null]];
for(const country of ['印度','缅甸','马来','巴西','IN',null])for(const platform of ['A','B'])for(const [raw_provider,channel_type] of cases)fixtures.push({country,platform,raw_provider,channel_type});
for(const country of ['印度','缅甸','马来','巴西','IN'])for(const platform of ['A','B']){
for(const [raw,values] of [['Custom',['WPay']],['Ambiguous',['WPay','ArbPay']],['AliasSet',['wpay','WPay']],['EmptySet',[]],['USDT(TRC20)-3',['USDT']],['',['UnknownPay']]])await db.query('insert into private.dashboard_admin_provider_registry values($1,$2,$3,$4)',[country,platform,raw,values]);
await db.query("insert into private.dashboard_admin_provider_overrides values($1,$2,'OverrideOnly',' Exact Display '),($1,$2,'ArbPayINR','WrongOverride'),($1,$2,'Custom',case when $2='A' then 'Reviewed-A' else 'Reviewed-B' end)",[country,platform]);
}
});after(()=>db?.close());
test('batch exactly matches scalar classifier across platform overrides, countries, generic rails, unknowns and confirmed USDT',async()=>{
const rows=(await db.query(`select b.*,private.dashboard_admin_live_workorder_provider(country,platform,raw_provider,channel_type) expected from private.dashboard_admin_live_workorder_provider_batch($1::jsonb)b`,[JSON.stringify(fixtures)])).rows;
assert.equal(rows.length,fixtures.length);for(const r of rows)assert.equal(r.provider,r.expected,JSON.stringify(r));
});
test('live override edits are read afresh and never shared across platforms or requests',async()=>{
await db.exec("update private.dashboard_admin_provider_overrides set canonical_provider='Updated-A' where country='印度' and platform='A' and raw_provider='Custom'");
const rows=(await db.query('select * from private.dashboard_admin_live_workorder_provider_batch($1::jsonb)',[JSON.stringify(fixtures.filter(f=>f.country==='印度'&&f.raw_provider==='Custom'))])).rows;
assert.equal(rows.find(x=>x.platform==='A').provider,'Updated-A');assert.equal(rows.find(x=>x.platform==='B').provider,'Reviewed-B');
});
test('helper grants no client access and empty input produces no fabricated names',async()=>{
assert.equal((await db.query("select has_function_privilege('anon','private.dashboard_admin_live_workorder_provider_batch(jsonb)','execute') a,has_function_privilege('authenticated','private.dashboard_admin_live_workorder_provider_batch(jsonb)','execute') b")).rows[0].a,false);
assert.equal((await db.query("select count(*)::int n from private.dashboard_admin_live_workorder_provider_batch('[]')")).rows[0].n,0);
});
test('guarded patches retain auth and full-range unique aggregation, reject unexpected baseline',async()=>{
assert.match(patch,/Workorder batch summary baseline changed/);assert.match(patch,/Workorder batch unique baseline changed/);
assert.doesNotMatch(patch,/\b(?:delete|insert into|update public|grant execute)\b/i);
await assert.rejects(db.exec(patch),/dashboard_admin_live_workorders/);await db.exec('rollback');
});
test('full summary and original-order responses remain identical across aliases, filters and multiple submitted days',async()=>{
await db.exec(`create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select '{"mode":"all"}'::jsonb$$;
create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select true$$;
create table catalog(id uuid,name text,source_name text,country text,scope_group text,source text);
create function private.dashboard_admin_live_platforms() returns setof public.catalog language sql stable as $$select * from public.catalog$$;
create table workorder_deposit_daily(stat_date date,country_code text,country text,platform text,third_party text,channel_type text,source_system text,submitted_count bigint,submitted_amount numeric,success_count bigint,success_amount numeric,withdraw_not_received_count bigint,withdraw_not_received_amount numeric,withdraw_success_count bigint,withdraw_success_amount numeric,source_updated_at timestamptz default now(),updated_at timestamptz default now());
create table ar_workorder_issue_details(system_name text,country_code text,country text,platform text,work_order_id text,work_order_no text,payment_order_no text,source_order_no text,amount numeric,issue_kind text,third_party text,channel_type text,status_code integer,submitted_date date,primary key(system_name,country_code,platform,work_order_id));
insert into catalog values('11111111-1111-4111-8111-111111111111','A','A','印度','IN','ar'),('22222222-2222-4222-8222-222222222222','B','B','印度','IN','ar');
insert into ar_workorder_issue_details select 'AR','IN','印度',p,i::text,i::text,case when i%11=0 then null else 'ORIGINAL-'||(i%12)::text end,null,100,case when i%3=0 then 'withdraw' else 'deposit' end,case when i%5=0 then 'ArbPayINR' else 'USDT(TRC20)-3' end,case when i%4=0 then null else 'BANK' end,case when i%2=0 then 4 else 3 end,date '2026-09-01'+i%3 from unnest(array['A','B'])p cross join generate_series(1,60)i;
insert into workorder_deposit_daily select submitted_date,country_code,country,platform,third_party,channel_type,'AR_WORKORDER',count(*)filter(where issue_kind='deposit'),coalesce(sum(amount)filter(where issue_kind='deposit'),0),count(*)filter(where issue_kind='deposit' and status_code=4),coalesce(sum(amount)filter(where issue_kind='deposit' and status_code=4),0),count(*)filter(where issue_kind='withdraw'),coalesce(sum(amount)filter(where issue_kind='withdraw'),0),count(*)filter(where issue_kind='withdraw' and status_code=4),coalesce(sum(amount)filter(where issue_kind='withdraw' and status_code=4),0),now(),now() from ar_workorder_issue_details group by submitted_date,country_code,country,platform,third_party,channel_type;`);
for(const file of ['admin-live-workorder-platform-breakdown.sql','admin-live-workorder-original-order-totals.sql','admin-live-workorder-unique-single-pass.sql','admin-live-workorder-provider-lookup-once.sql'])await db.exec(sql(file));
const cases=[{}, {direction:'charge'},{direction:'withdraw'},{platforms:['A']},{providers:['ArbPay']},{providers:['TronPayUSDT']},{offset:20},{startAt:'2026-09-03T00:00:00Z'}, {platforms:[]}];
const call=async q=>(await db.query('select private.dashboard_admin_live_workorders($1::jsonb) r',[JSON.stringify({country:'印度',startAt:'2026-09-01T00:00:00Z',endAt:'2026-09-03T23:59:59Z',limit:20,...q})])).rows[0].r;
const before=[];for(const c of cases)before.push(await call(c));
const acl=(await db.query("select proname,proacl::text,prosecdef,proconfig from pg_proc where oid in ('private.dashboard_admin_live_workorders(jsonb)'::regprocedure,'private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure) order by proname")).rows;
await db.exec(patch);for(let i=0;i<cases.length;i++)assert.deepEqual(await call(cases[i]),before[i],JSON.stringify(cases[i]));
await db.exec(patch);assert.deepEqual(await call({}),before[0]);
await db.exec(sql('admin-live-workorder-grouped-metrics.sql'));
for(let i=0;i<cases.length;i++)assert.deepEqual(await call(cases[i]),before[i],JSON.stringify(cases[i]));
await db.exec(sql('admin-live-workorder-source-scope-once.sql'));
for(let i=0;i<cases.length;i++)assert.deepEqual(await call(cases[i]),before[i],JSON.stringify(cases[i]));
await db.exec(sql('admin-live-workorder-source-scope-once.sql'));
assert.deepEqual(await call({}),before[0]);
assert.deepEqual((await db.query("select proname,proacl::text,prosecdef,proconfig from pg_proc where oid in ('private.dashboard_admin_live_workorders(jsonb)'::regprocedure,'private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)'::regprocedure) order by proname")).rows,acl);
});
