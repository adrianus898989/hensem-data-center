// Portable code-only regression: no private paths, production data or network.
const{test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Bootstrap the existing repository's real SQL fixture; all rows are synthetic.
const prefix=fs.readFileSync(path.join(__dirname,'admin-workorder-unique-provider-batch.test.cjs'),'utf8').split(/\ntest\(/)[0];let setup;
const load=n=>n==='node:test'?{...require(n),before:fn=>setup=fn,after:()=>{},beforeEach:()=>{},afterEach:()=>{}}:require(n);
const api=new Function('require','__dirname',prefix+';return {db,api,ar,dailyAr,originalInputs};')(load,__dirname);
const operation=fs.readFileSync(path.join(__dirname,'../supabase/operations/workorder-daily-provider-batch.sql'),'utf8');
const replacement={before:operation.match(/before_text constant text:=\$before\$([\s\S]*?)\$before\$/)[1],after:operation.match(/after_text constant text:=\$after\$([\s\S]*?)\$after\$/)[1]};
let old,next;
const sig='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)';
const raw='jsonb_to_recordset($1::jsonb)x(country text,platform text,raw_provider text,channel_type text)';
const mapping="with scalar_platforms as materialized(select distinct a.country_code,a.country,a.platform from private.dashboard_admin_wg_provider_aliases()a),daily_source as(select *from "+raw+replacement.after+")select *from daily_names";
const normalized=r=>r.map(x=>JSON.stringify(x)).sort();
const query={country:'印度',platforms:['Alpha','DhaniWin','DHANIWIN'],direction:'all',startAt:'2026-10-02T00:00:00Z',endAt:'2026-10-08T23:59:59Z',limit:20};
const db=()=>api.db(),scalar=async(q,args=[])=>(await db().query(q,args)).rows[0]?.value;
beforeEach(async()=>{await setup();old=await scalar('select pg_get_functiondef($1::regprocedure)value',[sig]);assert.equal(await scalar('select md5(prosrc)value from pg_proc where oid=$1::regprocedure',[sig]),'770866cae75d9cb307295740962a7d36');assert.equal(old.split(replacement.before).length,2,'the exact current daily lookup occurs once');next=old.replace(replacement.before,replacement.after);await db().exec('begin');});
afterEach(async()=>db()?.close());
async function invoke(def,q=query){await db().exec(def);await db().exec('savepoint compare');try{const text=await scalar('select private.dashboard_admin_live_workorders($1::jsonb)::text value',[JSON.stringify(q)]);await db().exec('release savepoint compare');return{text};}catch(e){await db().exec('rollback to savepoint compare;release savepoint compare');return{error:{code:e.code,message:e.message}};}}
async function same(extra={}){const q={...query,...extra},a=await invoke(old,q),b=await invoke(next,q);assert.deepEqual(b,a,JSON.stringify(extra));return a;}
test('daily mapping retains all current scalar WG/YASH/native/null/blank/channel/override classifications exactly',async()=>{
 const inputs=[];for(const country of['印度','IN','缅甸','马来','巴西','BR','越南','VN',null])for(const platform of['Alpha','26BET','98VV','YASH.BET','YASHBET',null])for(const raw_provider of['ArbPayINR','ArbPay2INR-BANK','paytm','qr','wavepay','duitnow','USDT(TRC20)-3','Custom','未识别通道',null,'','WinPay','NaNaPay(BRL)','YesPay(VND)'])for(const channel_type of['BANK','umoneypayinr',null,'','未识别通道'])inputs.push({country,platform,raw_provider,channel_type});
 await db().exec("insert into private.dashboard_admin_provider_registry values('印度','Alpha','Custom',array['WPay']);insert into private.dashboard_admin_provider_overrides values('印度','Alpha','Custom','Reviewed'),('印度','YASH.BET','WinPay','Custom-Yash'),('巴西','26BET','NaNaPay(BRL)','Custom-WG')");
 const run=async()=>(await db().query(mapping,[JSON.stringify(inputs)])).rows;
 assert.deepEqual(normalized(await run()),normalized(await api.originalInputs(inputs)));
 await db().exec("update private.dashboard_admin_provider_overrides set canonical_provider='Changed-Live'where platform='Alpha'");assert.deepEqual(normalized(await run()),normalized(await api.originalInputs(inputs)));
 assert.deepEqual((await db().query(mapping,['[]'])).rows,[]);
});
test('ordinary daily tuples call existing batch once and make no per-label scalar fallback calls',async()=>{
 await db().exec(`alter function private.dashboard_admin_live_workorder_provider(text,text,text,text)rename to local_original_scalar;
 create function private.dashboard_admin_live_workorder_provider(text,text,text,text)returns text language plpgsql stable as $$begin raise exception 'UNEXPECTED_DAILY_SCALAR';end$$;
 alter function private.dashboard_admin_live_workorder_provider_batch(jsonb)rename to local_original_batch;
 create sequence local_daily_batch_calls;
 create function private.dashboard_admin_live_workorder_provider_batch(p_names jsonb)returns table(country text,platform text,raw_provider text,channel_type text,provider text)language plpgsql volatile as $$begin perform nextval('local_daily_batch_calls');return query select *from private.local_original_batch(p_names);end$$;`);
 const inputs=Array.from({length:500},(_,i)=>({country:'印度',platform:'Alpha',raw_provider:'TestPay-'+i%50,channel_type:i%2?'BANK':null}));
 const result=(await db().query(mapping,[JSON.stringify(inputs)])).rows;assert.equal(result.length,50);assert.equal(await scalar('select last_value::int value from local_daily_batch_calls'),1);
});
test('whole original financial JSON text matches for cross-day originals, unknown supplements, provider/amount conflicts and every filtered scope',async()=>{
 await api.ar('A','SHARED',{status:4,date:'2026-10-02',amount:'9007199254740993.123456789012345678'});await api.ar('B','SHARED',{date:'2026-10-08',amount:'9007199254740993.123456789012345678'});
 await api.ar('UNKNOWN','SHARED',{provider:'未识别三方',status:4,date:'2026-10-08',amount:'9007199254740993.123456789012345678'});
 await api.ar('CONFLICT-A','CONFLICT',{amount:1});await api.ar('CONFLICT-B','CONFLICT',{provider:'OtherPay',amount:2});await api.ar('WITHDRAW','SHARED',{kind:'withdraw'});await api.ar('MISSING',null,{amount:null});await api.dailyAr();
 await api.api.ticket('N1','NATIVE',{provider:'Super-QR',created:'2026-10-02T12:00:00+05:30'});await api.api.ticket('N2','NATIVE',{provider:'Super-QR',status:'4',created:'2026-10-08T12:00:00+05:30'});await api.api.ticket('N3',null,{provider:'Super-QR',raw:{depositOrderNo:7}});await api.api.ticket('USDT','UNCONFIRMED',{type:'USDT存款未到账自动化',currency:'USDT'});
 const source=()=>scalar("select jsonb_build_object('ar',(select jsonb_agg(to_jsonb(r)order by work_order_id)from ar_workorder_issue_details r),'daily',(select jsonb_agg(to_jsonb(r)order by stat_date,platform,third_party)from workorder_deposit_daily r),'newar',(select jsonb_agg(to_jsonb(r)order by source_id)from newar_detail_records r))value"),before=await source();
 for(const q of[{}, {providers:['SUPER']},{providers:['OtherPay']},{providers:['SUPER','Super']},{providers:[]},{providers:['Absent']},{provider:'SUPER'},{direction:'withdraw'},{direction:'charge'},{offset:999},{limit:100},{platforms:['Alpha']},{platforms:['DhaniWin','DHANIWIN']}])await same(q);
 await api.api.daily({date:'2026-10-02',provider:'Super-QR',submitted:1,amount:100});await same({providers:['Super']});assert.deepEqual(await source(),{...before,daily:await scalar('select jsonb_agg(to_jsonb(r)order by stat_date,platform,third_party)value from workorder_deposit_daily r')});
});
test('null/zero/sparse/malformed daily source diagnostics and receipt-only provider labels remain unchanged',async()=>{
 await api.ar('A','A');await api.dailyAr();await db().exec("update workorder_deposit_daily set status_counts='{}',submitted_amount=null");await same();
 for(const counts of['{}','{"存款/已处理":1}','{"存款/待处理":"bad"}','{"提款/待处理":0}','{"未知":0}']){await db().query('update workorder_deposit_daily set status_counts=$1,submitted_count=0',[counts]);await same({providers:['SUPER']});}
 await db().exec("update workorder_deposit_daily set third_party='RECEIPT_ONLY',channel_type=null");await same();
});
test('permission and bad-input errors, helper metadata and all code outside the lookup block remain identical',async()=>{
 const start='  ), daily_names as materialized (',finish='  ), daily_expected as materialized (';
 assert.equal(next.slice(0,next.indexOf('  ), daily_provider_inputs as materialized (')),old.slice(0,old.indexOf(start)));assert.equal(next.slice(next.indexOf(finish)),old.slice(old.indexOf(finish)));
 const meta=()=>scalar("select to_jsonb(p)-'prosrc'value from pg_proc p where oid=$1::regprocedure",[sig]),before=await meta();await db().exec(next);assert.deepEqual(await meta(),before);
 for(const q of[{providers:null},{providers:[null]},{providers:[42]},{startAt:'bad'},{direction:'bad'},{offset:-1}])await same(q);
 await db().exec("set test.active='false'");assert.match((await same()).error.message,/preview_denied/);await db().exec("set test.active='true';set test.scope='{\"platforms\":[\"Alpha\"]}'");await same();
 const result=await scalar('select jsonb_build_object(\'body\',md5(prosrc),\'definition\',md5(pg_get_functiondef(oid)))value from pg_proc where oid=$1::regprocedure',[sig]);
 assert.deepEqual(result,{body:'39393d9ff3333631da2086cb42517fd9',definition:'f15d863db5a96c0045cb7ee3f382cac4'});
});
