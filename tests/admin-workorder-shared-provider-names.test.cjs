// Portable whole-reader PostgreSQL oracle with synthetic data only. No private
// paths, production calls, alternate financial aggregation or latency claims.
const{test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-workorder-unique-provider-batch.test.cjs'),'utf8').split(/\ntest\(/)[0];let setup;
const load=n=>n==='node:test'?{...require(n),before:fn=>setup=fn,after:()=>{},beforeEach:()=>{},afterEach:()=>{}}:require(n);
const fixture=new Function('require','__dirname',prefix+';return {db,api,ar,dailyAr};')(load,__dirname);
const operation=name=>fs.readFileSync(path.join(__dirname,'../supabase/operations',name),'utf8');
const replacement=sql=>({before:sql.match(/before_text constant text:=\$before\$([\s\S]*?)\$before\$/)[1],after:sql.match(/after_text constant text:=\$after\$([\s\S]*?)\$after\$/)[1]});
const daily=replacement(operation('workorder-daily-provider-batch.sql')),patches=JSON.parse(operation('workorder-shared-provider-names.sql').match(/\$patches\$([\s\S]*?)\$patches\$/)[1]);
const signature='private.dashboard_admin_live_workorder_unique_totals(jsonb,jsonb)',q={country:'印度',platforms:['Alpha','DhaniWin','DHANIWIN'],direction:'all',startAt:'2026-10-02T00:00:00Z',endAt:'2026-10-08T23:59:59Z',limit:20};
let old,next;const db=()=>fixture.db(),scalar=async(sql,args=[])=>(await db().query(sql,args)).rows[0]?.value;
beforeEach(async()=>{await setup();const baseline=await scalar('select pg_get_functiondef($1::regprocedure)value',[signature]);assert.equal(baseline.split(daily.before).length,2);await db().exec(baseline.replace(daily.before,daily.after));assert.equal(await scalar('select md5(prosrc)value from pg_proc where oid=$1::regprocedure',[signature]),'39393d9ff3333631da2086cb42517fd9');old=await scalar('select pg_get_functiondef($1::regprocedure)value',[signature]);next=old;for(const patch of patches){assert.equal(next.split(patch.before).length,2,'each exact shared-name patch occurs once');next=next.replace(patch.before,()=>patch.after);}await db().exec('begin');});
afterEach(async()=>db()?.close());
async function invoke(def,request){await db().exec(def);await db().exec('savepoint compare');try{const text=await scalar('select private.dashboard_admin_live_workorders($1::jsonb)::text value',[JSON.stringify(request)]);await db().exec('release savepoint compare');return{text};}catch(error){await db().exec('rollback to savepoint compare;release savepoint compare');return{error:{code:error.code,message:error.message}};}}
async function same(extra={}){const request={...q,...extra},before=await invoke(old,request),after=await invoke(next,request);assert.deepEqual(after,before,JSON.stringify(extra));return before;}
const inputs=()=>scalar("select jsonb_build_object('ar',(select jsonb_agg(to_jsonb(r)order by work_order_id)from ar_workorder_issue_details r),'daily',(select jsonb_agg(to_jsonb(r)order by stat_date,platform,third_party,channel_type)from workorder_deposit_daily r),'newar',(select jsonb_agg(to_jsonb(r)order by platform,dataset,source_id)from newar_detail_records r))::text value");

test('raw and daily share one full native tuple resolver while both original nullable-channel joins and financial code stay unchanged',async()=>{
 assert.equal(patches.length,2);let restored=next;for(const patch of patches.slice().reverse()){assert.equal(restored.split(patch.after).length,2);restored=restored.replace(patch.after,()=>patch.before);}assert.equal(restored,old);
 assert.equal((next.match(/private\.dashboard_admin_live_workorder_provider_batch\(/g)||[]).length,1);assert.equal(next.includes('daily_provider_routes'),false);assert.equal((next.match(/p\.channel_type is not distinct from d\.channel_type/g)||[]).length,2);
 for(const marker of['  ), mapped_details as materialized (','  ), original_groups as materialized (','  ), daily_expected as materialized (']){const end=next.indexOf('  ),',next.indexOf(marker)+marker.length);const endOld=old.indexOf('  ),',old.indexOf(marker)+marker.length);assert.equal(next.slice(next.indexOf(marker),end),old.slice(old.indexOf(marker),endOld));}
 const meta=()=>scalar("select to_jsonb(p)-'prosrc'value from pg_proc p where oid=$1::regprocedure",[signature]),before=await meta();await db().exec(next);assert.deepEqual(await meta(),before);assert.equal(await scalar('select md5(prosrc)value from pg_proc where oid=$1::regprocedure',[signature]),'7a0c9a592bca8642dcd60e685f5ee49c');
});

test('one exact tuple across both sources is resolved once; country/platform/channel/null distinctions and current scalar routing remain',async()=>{
 const fragment=next.slice(next.indexOf('  ), provider_inputs as materialized ('),next.indexOf('  ), mapped_details as materialized ('));
 const rows=[{country:'印度',platform:'Alpha',raw_provider:'Custom',channel_type:null},{country:'印度',platform:'Alpha',raw_provider:'Custom',channel_type:''},{country:'印度',platform:'Other',raw_provider:'Custom',channel_type:null},{country:'印度',platform:'YASH.BET',raw_provider:'WinPay',channel_type:'BANK'},{country:'IN',platform:'YASH.BET',raw_provider:'WinPay',channel_type:'BANK'},{country:'巴西',platform:'26BET',raw_provider:'NaNaPay(BRL)',channel_type:null}];
 await db().exec("insert into private.dashboard_admin_provider_overrides values('印度','Alpha','Custom','Reviewed'),('印度','YASH.BET','WinPay','Native-Yash')");
 const prefix="with raw_details as(select *from jsonb_to_recordset($1::jsonb)x(country text,platform text,raw_provider text,channel_type text)),daily_source as(select *from jsonb_to_recordset($2::jsonb)x(country text,platform text,raw_provider text,channel_type text))";
 const run=(raw,daily)=>db().query(prefix+fragment.replace(/^  \)/,'')+")select jsonb_agg(to_jsonb(x)order by country,platform,raw_provider,channel_type)value from provider_names x",[JSON.stringify(raw),JSON.stringify(daily)]);
 const expected=(await run(rows,[])).rows[0].value;assert.equal(expected.length,rows.length);
 assert.deepEqual((await run(rows.concat(rows),rows.concat(rows))).rows[0].value,expected);
 await db().exec(`alter function private.dashboard_admin_live_workorder_provider_batch(jsonb)rename to synthetic_old_batch;
 create sequence synthetic_batch_calls;create sequence synthetic_scalar_calls;
 create function private.dashboard_admin_live_workorder_provider_batch(p_names jsonb)returns table(country text,platform text,raw_provider text,channel_type text,provider text)language plpgsql volatile as $$begin perform nextval('synthetic_batch_calls');return query select *from private.synthetic_old_batch(p_names);end$$;
 alter function private.dashboard_admin_live_workorder_provider(text,text,text,text)rename to synthetic_old_scalar;
 create function private.dashboard_admin_live_workorder_provider(p_country text,p_platform text,p_raw text,p_channel text)returns text language plpgsql volatile as $$begin perform nextval('synthetic_scalar_calls');return private.synthetic_old_scalar(p_country,p_platform,p_raw,p_channel);end$$;`);
 assert.deepEqual((await run(rows.concat(rows),rows.concat(rows))).rows[0].value,expected);assert.equal(await scalar('select last_value::int value from synthetic_batch_calls'),1);assert.equal(await scalar('select last_value::int value from synthetic_scalar_calls'),3);
});

test('whole current financial JSON/text stays exact for repeated generic channels, native classifiers, null/empty labels and duplicates',async()=>{
 const channels=[null,'','  ','BANK','umoneypayinr','wepay2inr','QR','渠道','é','é'];
 await db().exec("insert into private.dashboard_admin_provider_registry values('印度','Alpha','Custom',array['WPay']);insert into private.dashboard_admin_provider_overrides values('印度','Alpha','Custom','Reviewed')");
 for(let i=0;i<120;i++){const id='CHANNEL-'+i;await fixture.ar(id,'ORIGINAL-'+Math.floor(i/3),{provider:i%4?'paytm':'Custom',status:i%3?3:4,date:i%2?'2026-10-02':'2026-10-08',amount:i%17?'0.000000000000000001':null});await db().query('update ar_workorder_issue_details set channel_type=$1 where work_order_id=$2',[channels[i%channels.length],id]);}
 await fixture.dailyAr();const before=await inputs();
 for(const extra of[{}, {providers:['Reviewed']},{providers:['UmoneyPay']},{providers:['Reviewed','UmoneyPay']},{providers:[]},{providers:['Absent']},{provider:'Reviewed'},{direction:'charge'},{direction:'withdraw'},{offset:999},{limit:100}])await same(extra);
 await db().exec("update private.dashboard_admin_provider_overrides set canonical_provider='Changed-Live'where platform='Alpha'");await same({providers:['Changed-Live']});assert.equal(await inputs(),before);
});

test('cross-day shared originals, unknown supplements, provider/amount conflicts, missing references and exact decimals remain unchanged',async()=>{
 await fixture.ar('KNOWN','SHARED',{provider:'SUPER',date:'2026-10-02',amount:'9007199254740993.123456789012345678',status:4});await fixture.ar('UNKNOWN','SHARED',{provider:'未识别三方',date:'2026-10-08',amount:'9007199254740993.123456789012345678'});
 await fixture.ar('CONFLICT-A','CONFLICT',{provider:'SUPER',amount:1});await fixture.ar('CONFLICT-B','CONFLICT',{provider:'OtherPay',amount:2});await fixture.ar('MISSING',null,{provider:'SUPER',amount:null});await fixture.ar('WITHDRAW','SHARED',{kind:'withdraw'});await fixture.dailyAr();
 await fixture.api.ticket('N1','NATIVE',{provider:'Super-QR',created:'2026-10-02T12:00:00+05:30'});await fixture.api.ticket('N2','NATIVE',{provider:'Super-QR',created:'2026-10-08T12:00:00+05:30',status:'4'});await fixture.api.ticket('N3',null,{provider:'Super-QR',amount:null,raw:{depositOrderNo:7}});
 await fixture.api.ticket('USDT',null,{type:'USDT存款未到账自动化',currency:null,provider:'ExcludedPay'});await fixture.api.daily({provider:'ExcludedPay',submitted:1,amount:100});
 const before=await inputs();for(const extra of[{}, {providers:['SUPER']},{providers:['OtherPay']},{providers:['SUPER','Super-QR']},{providers:['未识别三方']},{providers:['ExcludedPay']},{direction:'charge'},{direction:'withdraw'},{platforms:['Alpha']},{platforms:['DhaniWin','DHANIWIN']},{startAt:'2026-10-03T00:00:00Z'},{endAt:'2026-10-07T23:59:59Z'}]){const result=await same(extra);if(Object.keys(extra).length===0)assert(result.text.includes('9007199254740993.123456789012345678'));}assert.equal(await inputs(),before);
});

test('zero, nullable and malformed daily diagnostics and missing-provider matches retain the whole original DTO',async()=>{
 await fixture.ar('A','A');await fixture.dailyAr();await db().exec("update workorder_deposit_daily set submitted_amount=null,status_counts='{}',channel_type=null");await same();
 for(const counts of['{}','{"存款/已处理":1}','{"存款/待处理":"bad"}','{"提款/待处理":0}','{"未知":0}']){await db().query('update workorder_deposit_daily set status_counts=$1,submitted_count=0',[counts]);await same({providers:['SUPER']});}
 await db().exec("update workorder_deposit_daily set third_party='RECEIPT_ONLY',channel_type=''");await same();
});

test('permission, bad-input and selected-native errors remain identical without changing raw records or unrelated functions',async()=>{
 await fixture.ar('A','A');await fixture.dailyAr();const before=await inputs();
 const protectedFunctions=()=>scalar("select jsonb_agg(to_jsonb(p)order by p.oid)::text value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')and p.oid<>$1::regprocedure",[signature]),metadata=await protectedFunctions();
 for(const extra of[{providers:null},{providers:[null]},{providers:[42]},{startAt:'bad'},{direction:'bad'},{offset:-1}])await same(extra);
 await db().exec("set test.active='false'");assert.match((await same()).error.message,/preview_denied/);await db().exec("set test.active='true';set test.scope='{\"mode\":\"selected\",\"platforms\":[\"Alpha\"]}'");await same();
 assert.equal(await inputs(),before);assert.equal(await protectedFunctions(),metadata);
});

test('source and classifier errors propagate unchanged instead of returning cached, empty or complete statistics',async()=>{
 await fixture.ar('A','A');await fixture.dailyAr();await db().exec(old);const baseline=await scalar('select private.dashboard_admin_live_workorders($1::jsonb)value',[JSON.stringify(q)]);
 await db().exec("alter function private.dashboard_admin_live_workorder_provider_batch(jsonb)rename to synthetic_error_batch;create function private.dashboard_admin_live_workorder_provider_batch(p_names jsonb)returns table(country text,platform text,raw_provider text,channel_type text,provider text)language plpgsql stable as $$begin raise exception using errcode='22023',message='synthetic_classifier_error';end$$");
 async function unique(def){await db().exec(def);await db().exec('savepoint source_error');try{return await scalar('select private.dashboard_admin_live_workorder_unique_totals($1::jsonb,$2::jsonb)::text value',[JSON.stringify(q),JSON.stringify(baseline)]);}catch(e){await db().exec('rollback to source_error');return{code:e.code,message:e.message};}finally{await db().exec('release source_error');}}
 assert.deepEqual(await unique(next),await unique(old));assert.deepEqual(await unique(next),{code:'22023',message:'synthetic_classifier_error'});
 await db().exec("drop function private.dashboard_admin_live_workorder_provider_batch(jsonb);alter function private.synthetic_error_batch(jsonb)rename to dashboard_admin_live_workorder_provider_batch;set test.active='false'");assert.match((await same()).error.message,/preview_denied/);
});
