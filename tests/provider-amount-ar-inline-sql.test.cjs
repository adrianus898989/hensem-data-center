// Actual PostgreSQL execution on synthetic native sources only; no network or customer records.
const {test,before,after}=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20261118064346_provider_amount_ar_guarded_inline.sql');
const rollback=read('supabase/maintenance/provider-amount-ar-inline.rollback.sql');
const sig='private.dashboard_admin_live_drilldown_raw(jsonb)',money='private.dashboard_admin_ar_local_amount(text,text,text,smallint,numeric,text,text,numeric)';
const beforeHash='d5c6f989646068bc8ae44e8f9cf7e204',afterHash='c3f1089d451d269f385dab8193ca30ae';
const marker={kind:'custom',view:'drilldown',hourRange:{minHour:0,maxHour:24},providerAmountMatrix:true};
const edges=[100,200,300,400,500,1000,2000,5000,10000,20000,50000];
let db,fixture,baseline,helper;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const metadata=signature=>scalar('select to_jsonb(p) from pg_proc p where oid=$1::regprocedure',[signature]);
const definition=signature=>scalar('select pg_get_functiondef($1::regprocedure)',[signature]);
const clone=(sql,name)=>sql.replace('FUNCTION private.dashboard_admin_live_drilldown_raw(',`FUNCTION private.${name}(`);
const request=(source='ar',extra={})=>fixture.request(source,{currency:source==='lg'?'PHP':'INR',direction:'all',status:'all',amountBands:{charge:edges,withdraw:edges},...marker,successBasis:'created',...extra});
before(async()=>{
 const filename=path.join(__dirname,'admin-provider-amount-drilldown.test.cjs');let initialize;
 const context=vm.createContext({__dirname,process,console,structuredClone,require:n=>n==='node:test'?{test(){},before:fn=>initialize=fn,after(){}}:createRequire(filename)(n)});
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.amountFixture=()=>({db,fixture});',context,{filename});await initialize();({db,fixture}=context.amountFixture());
 await db.exec('create role service_role;');
 await db.exec(read('tests/fixtures/provider-amount-ar-inline-production.sql'));
 const source=read('tests/fixtures/admin-live-ar-amount-inline-production.sql');
 helper=source.slice(source.indexOf('CREATE OR REPLACE FUNCTION private.dashboard_admin_ar_local_amount'),source.lastIndexOf('revoke all'));
 await db.exec(helper+'revoke all on function '+sig+','+money+' from public,anon,authenticated,service_role;');
 assert.equal(await scalar('select md5(prosrc) from pg_proc where oid=$1::regprocedure',[sig]),beforeHash);
 baseline=await definition(sig);await db.exec(clone(baseline,'amount_inline_reference')+';revoke all on function private.amount_inline_reference(jsonb) from public,anon,authenticated,service_role;');
 const samples=[
  ['PRECISE','123456789012345678901234567.12345678',null,null,null,null,'BANK','SelectedPay',null],
  ['ZERO','0',null,null,null,null,'BANK','SelectedPay',null],['NEGATIVE','-0.00000001',null,null,null,null,'BANK','SelectedPay',null],
  ['LOCAL','999',1,'1.23000000','INR',null,'BANK','SelectedPay',null],['LOCAL_ZERO','999',1,'0','INR','LOCAL_AMOUNT_NOT_PROVIDED','BANK','SelectedPay',null],
  ['STALE','999',1,'1','INR','LOCAL_AMOUNT_STALE_FOR_USDT','BANK','SelectedPay',null],['BAD_CURRENCY','999',1,'1','USD',null,'BANK','SelectedPay',null],
  ['BAD_VERSION','999',2,'1','INR',null,'BANK','SelectedPay',null],['NAN_LOCAL','999',1,'NaN','INR',null,'BANK','SelectedPay',null],['INF_LOCAL','999',1,'Infinity','INR',null,'BANK','SelectedPay',null],
  ['MISSING',null,null,null,null,null,'BANK','',null],['MANUAL',null,null,null,null,null,'BANK','人工充值','-12.12345678'],
  ['DUAL',null,null,null,null,null,'BANK','USDT(TRC20)-3','金额：1000\n兑换比例：80\nUSDT：12.5'],['USDT_WITHDRAW','123',null,null,null,null,' usdt ','SelectedPay',null]
 ];
 for(const [id,legacy,version,local,currency,issue,type,provider,text]of samples){await fixture.add('ar',id==='USDT_WITHDRAW'?'withdraw':'charge','INLINE-'+id,legacy,{provider});await db.query('update ar_collected_orders set money_format_version=$1,amount_local=$2,currency_local=$3,money_issue_code=$4,channel_type=$5,amount_text=$6 where order_no=$7',[version,local,currency,issue,type,text,'INLINE-'+id]);}
});
after(()=>db?.close());
async function equal(q){const r=(await db.query('select private.amount_inline_reference($1::jsonb) reference,private.dashboard_admin_live_drilldown_raw($1::jsonb) candidate',[JSON.stringify(q)])).rows[0];assert.deepEqual(r.candidate,r.reference,JSON.stringify(q));return r.candidate;}
function requests(){const qs=[];
 for(const source of ['ar','newar','game66','lg'])for(const direction of ['all','charge','withdraw'])for(const successBasis of ['created',undefined])qs.push(request(source,{direction,successBasis}));
 for(const extra of [{providers:['SelectedPay']},{providers:['PrecisionPay']},{providers:['no-match']},{currency:'USD'},{channelTypes:['BANK']},{amountMin:'0'},{amountMax:'2000'},
  {amountMin:'100',amountMax:'200',amountMaxExclusive:true},{orderNumber:'INLINE-PRECISE'},
  {startAt:'2026-09-19T00:00:00+05:30',endAt:'2026-09-19T06:00:00+05:30'},
  {startAt:'2026-09-19T06:00:00+05:30',endAt:'2026-09-19T12:00:00+05:30'},
  {amountBands:{charge:[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1,1.1],withdraw:edges}}])qs.push(request('ar',extra));
 for(const extra of [{providerAmountMatrix:undefined},{providerAmountMatrix:undefined,providerHourMatrix:true},
  {providerAmountMatrix:undefined,kind:'amount_range',bucket:'band:0',hourRange:undefined},
  {providerAmountMatrix:undefined,kind:'amount_range',bucket:'unknown',hourRange:undefined}])qs.push(request('ar',extra));
 return qs;
}
async function capture(q,original=false){const d=original?baseline:await definition(sig),anchor='  execute v_sql into v_result using';assert.equal(d.split(anchor).length,2);
 await db.exec(clone(d.replace(anchor,"  return jsonb_build_object('source',v_source);\n"+anchor),'amount_inline_capture')+';revoke all on function private.amount_inline_capture(jsonb) from public,anon,authenticated,service_role;');
 return (await scalar('select private.amount_inline_capture($1::jsonb)',[JSON.stringify(q)])).source;
}
test('exact guarded native amount expansion preserves complete replies, clocks, four source adapters and all monetary edge cases',async()=>{
 const old=await metadata(sig),helperMeta=await metadata(money);await db.exec(migration);
 const {prosrc:oldBody,...oldMeta}=old,{prosrc:newBody,...newMeta}=await metadata(sig);assert.deepEqual(newMeta,oldMeta);assert.deepEqual(await metadata(money),helperMeta);
 assert.equal(await scalar('select md5(prosrc) from pg_proc where oid=$1::regprocedure',[sig]),afterHash);
 for(const q of requests())await equal(q);
 assert.doesNotMatch(await capture(request()),/private\.dashboard_admin_ar_local_amount\(/);
 for(const extra of [{providerAmountMatrix:undefined},{providerAmountMatrix:undefined,providerHourMatrix:true}]){
  const q=request('ar',extra);assert.equal(await capture(q),await capture(q,true),'Ordinary/hour sources retain their exact prior source.');
 }
});
test('unknown helper contracts fall back to the original call without masking new monetary rules',async()=>{
 const d=await definition(money);
 const changes=[d.replace('ELSE p_legacy_display','ELSE p_legacy_display * 2'),'alter function '+money+' stable','alter function '+money+' parallel unsafe',
  'alter function '+money+' set search_path=public','grant execute on function '+money+' to authenticated'];
 for(const change of changes){await db.exec('begin');try{await db.exec(change);assert.match(await capture(request()),/private\.dashboard_admin_ar_local_amount\(/);for(const q of requests().filter(q=>q.platformId===request().platformId))await equal(q);}finally{await db.exec('rollback')}}
});
test('replay and exact rollback preserve all metadata; unknown body, ACL or helper changes fail atomically',async()=>{
 const installed=await metadata(sig);await db.exec(migration);assert.deepEqual(await metadata(sig),installed);
 await db.exec(rollback);await db.exec(rollback);assert.equal(await definition(sig),baseline);for(const q of requests())await equal(q);await db.exec(migration);
 const block=sql=>sql.slice(sql.indexOf('do $patch$'),sql.lastIndexOf('commit;'));
 for(const installedState of [false,true]){await db.exec('begin');try{if(!installedState)await db.exec(baseline);const expected=await metadata(sig);
  const changes=[(await definition(sig)).replace('declare\n','declare\n -- unknown reader\n'),'alter function '+sig+' security invoker','alter function '+sig+' set jit=on',
   'grant execute on function '+sig+' to authenticated','alter function '+money+' stable','alter function '+money+' parallel unsafe','alter function '+money+' set search_path=public','grant execute on function '+money+' to anon',
   (await definition(money)).replace(' SELECT CASE',' SELECT CASE /* changed helper */')];
  for(const change of changes){await db.exec('savepoint drift');await db.exec(change);await assert.rejects(()=>db.exec(block(migration)),/PROVIDER_AMOUNT_AR_INLINE_(BODY|METADATA|HELPER)_MISMATCH/);await db.exec('rollback to drift');assert.deepEqual(await metadata(sig),expected);}
 }finally{await db.exec('rollback')}}
 await db.exec('begin');try{await db.exec('grant execute on function '+sig+' to authenticated');await assert.rejects(()=>db.exec(block(rollback)),/PROVIDER_AMOUNT_AR_ROLLBACK_METADATA_MISMATCH/);}finally{await db.exec('rollback')}
});
test('fresh platform and page authorization remain enforced, private readers remain inaccessible',async()=>{
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,sig]),false);
 await fixture.as('');try{await assert.rejects(()=>equal(request()),/login_required/);}finally{await fixture.as('10000000-0000-0000-0000-000000000001')}
 await assert.rejects(()=>equal(request('ar',{platformId:'90000000-0000-0000-0000-000000000022'})),/platform_denied/);
 await db.query("select set_config('hensem.dashboard_role_context',$1,false)",[JSON.stringify({payload:{page:'time'}})]);
 try{await assert.rejects(()=>equal(request()),/page_action_denied/);}finally{await db.exec('reset hensem.dashboard_role_context')}
});
