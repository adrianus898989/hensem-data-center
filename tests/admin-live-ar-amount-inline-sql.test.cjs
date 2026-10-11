// Real PostgreSQL execution with synthetic native orders; no network/auth tokens.
const {test,before,after}=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const repo=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const fixtureSQL=read('tests/fixtures/admin-live-ar-amount-inline-production.sql'),migration=read('supabase/migrations/20261011140859_admin_live_ar_amount_inline_once.sql');
const sig='private.dashboard_admin_live_query_raw(jsonb)',money='private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)';
let db,native,f,baseline;
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const metadata=async(signature)=>scalar("select to_jsonb(p) from pg_proc p where oid=$1::regprocedure",[signature]);
const definition=signature=>scalar('select pg_get_functiondef($1::regprocedure)',[signature]);
const clone=(sql,name)=>sql.replace('FUNCTION private.dashboard_admin_live_query_raw(',`FUNCTION private.${name}(`);
before(async()=>{
 const filename=path.join(__dirname,'fee-channel-category.test.cjs');let setup;
 const c=vm.createContext({require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){}}:createRequire(filename)(n),__dirname,process,console,structuredClone});
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.h={get db(){return db},get native(){return native},get f(){return f}};',c,{filename});await setup();({db,native,f}=c.h);
 await db.exec('alter table ar_collected_orders add column money_format_version smallint,add column amount_local numeric,add column currency_local text,add column money_issue_code text;create table private.dashboard_admin_order_provider_confirmations(source_system text,country_code text,platform text,order_kind text,order_no text,confirmed_provider text,active boolean)');
 await db.exec(fixtureSQL);baseline=await definition(sig);await db.exec(clone(baseline,'merchant_amount_reference'));
 await db.exec('revoke all on function private.merchant_amount_reference(jsonb) from public,anon,authenticated,service_role');
 const rows=[
 ['PRECISE','123456789012345678901234567.12345678',null,null,null,null,'BANK','SelectedPay',null],
 ['ZERO','0',null,null,null,null,'BANK','SelectedPay',null],['NEGATIVE','-0.00000001',null,null,null,null,'BANK','SelectedPay',null],
 ['LOCAL','999',1,'1.23000000','INR',null,'BANK','SelectedPay',null],['LOCAL_ZERO','999',1,'0','INR','LOCAL_AMOUNT_NOT_PROVIDED','BANK','SelectedPay',null],
 ['STALE','999',1,'1','INR','LOCAL_AMOUNT_STALE_FOR_USDT','BANK','SelectedPay',null],['BAD_CURRENCY','999',1,'1','USD',null,'BANK','SelectedPay',null],
 ['BAD_VERSION','999',2,'1','INR',null,'BANK','SelectedPay',null],['NAN_LOCAL','999',1,'NaN','INR',null,'BANK','SelectedPay',null],['INF_LOCAL','999',1,'Infinity','INR',null,'BANK','SelectedPay',null],
 ['MISSING',null,null,null,null,null,'BANK','',null],['MANUAL',null,null,null,null,null,'BANK','人工充值','-12.12345678'],
 ['DUAL',null,null,null,null,null,'BANK','USDT(TRC20)-3','金额：1000\n兑换比例：80\nUSDT：12.5'],['USDT_WITHDRAW','123',null,null,null,null,' usdt ','SelectedPay',null]
 ];
 for(const [id,legacy,version,local,currency,issue,type,provider,text]of rows){await native.add('ar',id==='USDT_WITHDRAW'?'withdraw':'charge',id,legacy,{provider});await db.query('update ar_collected_orders set money_format_version=$1,amount_local=$2,currency_local=$3,money_issue_code=$4,channel_type=$5,amount_text=$6,member_id=$7 where order_no=$8',[version,local,currency,issue,type,text,'0001',id]);}
 await db.exec("insert into private.dashboard_admin_order_provider_confirmations values('AR','IN','AR-BANDS','recharge','MISSING','ConfirmedPay',true)");
 await f.publish(f.input([f.rate({country:'IN',collect_fee:'1.23456789%',collect_single_fee:'0.00000001'})],[f.evidence({effectiveFrom:'2026-09-18T00:00:00+05:30',currency:'INR'})]));
});
after(()=>db?.close());
function requests(){const qs=[];for(const source of ['ar','newar','game66','lg']){
 for(const direction of ['all','charge','withdraw']){qs.push(native.request(source,{direction,view:'providers'}));for(const status of ['all','success','pending','failed','rejected','unknown'])qs.push(native.request(source,{direction,status,view:'full'}));}
 for(const action of ['query','details'])for(const status of ['all','success','unknown'])qs.push(native.request(source,{action,status,direction:'charge',limit:100}));
 }
 for(const view of ['providers','full'])for(const extra of [{providers:['SelectedPay']},{providers:['ConfirmedPay']},{providers:[]},{channelTypes:['BANK']},{currency:'USD'},{amountMin:'0'},{amountMax:'2000'},
 {amountMin:'0',amountMax:'2000',amountMaxExclusive:true},{amountMin:'123456789012345678901234567.12345678',amountMax:'123456789012345678901234567.12345678'},
 {memberId:'0001'},{memberId:'1'},{orderNumber:'PRECISE'},{startAt:'2026-09-19T01:00:00+05:30',endAt:'2026-09-19T01:05:00+05:30'}])qs.push(native.request('ar',{view,...extra}));
 qs.push(native.request('ar',{view:'full',durationVersion:2,durationRange:{minSeconds:120,maxSeconds:180}}));return qs;}
async function equal(q){const r=(await db.query('select private.merchant_amount_reference($1::jsonb)reference,private.dashboard_admin_live_query_raw($1::jsonb)candidate',[JSON.stringify(q)])).rows[0];assert.deepEqual(r.candidate,r.reference,JSON.stringify(q));return r.candidate;}
async function captureDefinition(){const sql=await definition(sig),anchor='  execute v_sql into v_result using ';assert.equal(sql.split(anchor).length,2);await db.exec(clone(sql.replace(anchor,"  perform set_config('test.merchant_source',v_source,false);\n  return '{}'::jsonb;\n"+anchor),'merchant_amount_capture'));await db.exec('revoke all on function private.merchant_amount_capture(jsonb) from public,anon,authenticated,service_role');}
async function source(){await db.query('select private.merchant_amount_capture($1::jsonb)',[JSON.stringify(native.request('ar',{view:'providers',direction:'charge'}))]);return scalar("select current_setting('test.merchant_source')");}

test('guarded amount expansion preserves 135 full JSON replies, monetary text precision, all native sources and wrapper metadata',async()=>{
 const old=await metadata(sig),helper=await metadata(money),wrappers=await scalar("select jsonb_agg(to_jsonb(p)order by oid)from pg_proc p where oid in('public.dashboard_admin_live_query(jsonb)'::regprocedure,'private.dashboard_admin_live_query(jsonb)'::regprocedure)");
 assert.equal(await scalar('select md5(prosrc)from pg_proc where oid=$1::regprocedure',[sig]),'26b4cf0c448c9f001576d1a933aea8d9');await db.exec(migration);
 const {prosrc:beforeBody,...beforeMeta}=old,{prosrc:afterBody,...afterMeta}=await metadata(sig);assert.deepEqual(afterMeta,beforeMeta);assert.deepEqual(await metadata(money),helper);
 assert.deepEqual(await scalar("select jsonb_agg(to_jsonb(p)order by oid)from pg_proc p where oid in('public.dashboard_admin_live_query(jsonb)'::regprocedure,'private.dashboard_admin_live_query(jsonb)'::regprocedure)"),wrappers);
 assert.equal(await scalar('select md5(prosrc)from pg_proc where oid=$1::regprocedure',[sig]),'18be6ff6349345d21da91592231567bd');
 const qs=requests();assert.equal(qs.length,135);for(const q of qs)await equal(q);
 const moneyRows=(await equal(native.request('ar',{action:'details',direction:'all',limit:100}))).rows;
 for(const [id,amount]of [['PRECISE','123456789012345678901234567.12345678'],['ZERO','0'],['NEGATIVE','-0.00000001'],['LOCAL','1.23000000'],['LOCAL_ZERO','0'],['STALE',null],['BAD_CURRENCY',null],['BAD_VERSION',null],['NAN_LOCAL',null],['INF_LOCAL',null],['MISSING',null],['MANUAL','-12.12345678'],['DUAL','1000'],['USDT_WITHDRAW',null]])assert.equal(moneyRows.find(r=>r.order_number===id).amount,amount,id);
 await captureDefinition();assert.doesNotMatch(await source(),/private\.dashboard_admin_ar_local_amount\(/,'Known exact helper activates expanded CASE, not a false all-fallback comparison.');
 assert.match(await source(),/LOCAL_AMOUNT_STALE_FOR_USDT/);
});

test('future money-helper body or metadata changes retain original call and full JSON at runtime',async()=>{
 const helperDefinition=await definition(money);await captureDefinition();
 const changes=[helperDefinition.replace('ELSE p_legacy_display','ELSE p_legacy_display * 2'),
  'alter function '+money+' stable','alter function '+money+' parallel unsafe','alter function '+money+' set search_path=public','grant execute on function '+money+' to authenticated'];
 for(const change of changes){await db.exec('begin');try{await db.exec(change);assert.match(await source(),/private\.dashboard_admin_ar_local_amount\(/,'Unknown contract falls back.');for(const q of requests().filter(q=>q.platformId===native.request('ar').platformId))await equal(q);
  if(change.startsWith('CREATE'))assert.equal((await equal(native.request('ar',{action:'details',direction:'charge',orderNumber:'PRECISE'}))).rows[0].amount,'246913578024691357802469134.24691356');
 }finally{await db.exec('rollback')}}
 for(const returnType of ['text','SETOF numeric']){await db.exec('begin');try{
  await db.exec('drop function '+money+';'+helperDefinition.replace('RETURNS numeric','RETURNS '+returnType)+';revoke all on function '+money+' from public,anon,authenticated,service_role');
  assert.match(await source(),/private\.dashboard_admin_ar_local_amount\(/,returnType+' drift must retain the call, rather than masking a new contract.');
 }finally{await db.exec('rollback')}}
});

test('replay is idempotent; body, ACL and configuration drift reject before replacement or replay without partial changes',async()=>{
 const installed=await metadata(sig);await db.exec(migration);assert.deepEqual(await metadata(sig),installed);
 const block=migration.slice(migration.indexOf('do $patch$'),migration.lastIndexOf('commit;'));
 for(const beforeState of [true,false]){await db.exec('begin');try{
  if(beforeState)await db.exec(baseline);const expected=await metadata(sig),helperDefinitionForDrift=await definition(money);
  const changes=[(await definition(sig)).replace('declare\n','declare\n -- synthetic unknown reader\n'),
   'alter function '+sig+' security invoker','alter function '+sig+' set jit=on','grant execute on function '+sig+' to authenticated',
   'alter function '+money+' stable','alter function '+money+' parallel unsafe','alter function '+money+' set search_path=public','grant execute on function '+money+' to anon',
   (await definition(money)).replace(' SELECT CASE',' SELECT CASE /* synthetic new monetary rule */'),
   ...['text','SETOF numeric'].map(type=>'drop function '+money+';'+helperDefinitionForDrift.replace('RETURNS numeric','RETURNS '+type)+';revoke all on function '+money+' from public,anon,authenticated,service_role')];
  for(const change of changes){await db.exec('savepoint drift');await db.exec(change);await assert.rejects(()=>db.exec(block),/AR_AMOUNT_INLINE_(BODY|METADATA|HELPER)_MISMATCH/);await db.exec('rollback to drift');assert.deepEqual(await metadata(sig),expected);}
 }finally{await db.exec('rollback')}}
});

test('private raw-reader ACL and fresh platform denial remain unchanged',async()=>{
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,sig]),false);
 await native.as('10000000-0000-0000-0000-000000000002');try{await assert.rejects(()=>equal(native.request('ar')),/platform_denied|preview_denied/);}finally{await native.as('10000000-0000-0000-0000-000000000001')}
 await db.exec('begin');try{await db.exec("update dashboard_profiles set active=false where role='owner'");await assert.rejects(()=>equal(native.request('ar')),/preview_denied/);}finally{await db.exec('rollback')}
});
