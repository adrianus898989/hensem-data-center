// Synthetic remarks/aggregates only. No production notes or order/member identities.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const baseline=read('tests/fixtures/withdraw-blocking-taxonomy-baseline.sql');
const migration=read('supabase/migrations/20261010114700_withdraw_blocking_shared_taxonomy.sql');
const cleaned='private.dashboard_admin_live_blocking_details_cleaned(text)',reader='private.dashboard_admin_live_withdraw_reasons(jsonb)';
const meta=async(db,sig)=>(await db.query("select to_jsonb(p)-'prosrc' metadata,md5(prosrc) hash from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
async function fixture(){
 const db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select case when current_setting('test.denied',true)='yes' then '{"denied":true}'::jsonb else '{}'::jsonb end$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select not coalesce((s->>'denied')::boolean,false) and p in('SYNTHETIC-AR','SYNTHETIC-PANDA') and c in('印度','巴西','IN','BR')$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
 create function private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb) returns jsonb language sql stable as $$select null::jsonb$$;
 create function private.dashboard_admin_live_platforms() returns table(name text,source_name text,country text,scope_group text,source text) language sql stable as $$values('SYNTHETIC-AR','SYNTHETIC-AR','印度','IN','ar'),('SYNTHETIC-PANDA','SYNTHETIC-PANDA','巴西','BR','withdraw')$$;
 create function private.dashboard_admin_live_withdraw_platforms() returns table(id uuid,name text,source_name text,country text,scope_group text,source text) language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid,p.* from private.dashboard_admin_live_platforms()p$$;
 create function private.dashboard_admin_ar_local_amount(text,text,text,integer,numeric,text,text,numeric) returns numeric language sql immutable as $$select $8$$;
 create function private.dashboard_admin_live_rejection_exact_note(text) returns text language sql immutable as $$select case when $1~'[^[:space:]]' then $1 end$$;
 create function private.dashboard_admin_live_rejection_exact_key(text) returns text language sql immutable as $$select md5(jsonb_build_array('source_rejection_note_v1',private.dashboard_admin_live_rejection_exact_note($1))::text)$$;
 create table public.ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,amount numeric,status text,operator text,applied_at timestamp,completed_at timestamp,manual_remark text,remark text,raw_channel text,updated_at timestamptz,channel_type text,money_format_version integer,amount_local numeric,currency_local text,money_issue_code text);
 create table public.auto_withdraw_daily(country text,platform text,data_date date,total bigint,updated_at timestamptz);
 create table public.dashboard_platform_team_map(country_name text,country_code text,active boolean);
 create table public.withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create table public.synthetic_grouped_reasons(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create view public.withdraw_reasons_daily_grouped as select * from public.synthetic_grouped_reasons;
 grant usage on schema private to anon,authenticated,service_role;`);
 const norm=read('supabase/admin-live-withdraw-note-normalization.sql'),a=norm.indexOf('create or replace function private.dashboard_admin_live_decode_note'),b=norm.indexOf('revoke all on function private.dashboard_admin_live_decode_note',a);await db.exec(norm.slice(a,b));
 await db.exec('set check_function_bodies=off');await db.exec(baseline);await db.exec('set check_function_bodies=on');
 for(const name of['dashboard_admin_live_blocking_category','dashboard_admin_live_blocking_details','dashboard_admin_live_blocking_details_cleaned','dashboard_admin_live_clean_note'])await db.exec(`revoke all on function private.${name}(text) from public,anon,authenticated,service_role;`);
 await db.exec(`revoke all on function ${reader} from public,anon,authenticated,service_role;grant execute on function ${reader} to authenticated;`);
 assert.equal((await meta(db,cleaned)).hash,'dc7e5800d3afc9113d3b3664530a9013');assert.equal((await meta(db,reader)).hash,'47d5a425eebe03f4150f6b9657f0dac6');return db;
}
const details=async(db,n)=>(await db.query('select private.dashboard_admin_live_blocking_details($1) value',[n])).rows[0].value;
const call=async(db,extra={})=>(await db.query('select private.dashboard_admin_live_withdraw_reasons($1::jsonb) value',[JSON.stringify({country:'印度',platform:'SYNTHETIC-AR',date:'2026-10-09',kind:'blocking',...extra})])).rows[0].value;
const primary='免审未通过：用户充提差额不满足自动提现要求:';
async function order(db,id,n,extra={}){await db.query("insert into ar_collected_orders values('AR','IN','SYNTHETIC-AR','withdraw',$1,100,$2,$3,'2026-10-09 12:00','2026-10-09 12:01',$4,$5,'',now(),null,null,null,null,null)",[id,extra.status||'已支付',extra.operator||'synthetic-agent',n,extra.rejection||'Synthetic rejection 501']);}
test('signed observations and successful provider tails share one canonical rule; source details remain available',async()=>{
 const db=await fixture();try{await db.exec(migration);
  for(const [amount,provider]of[['-10000','QQ代付V3'],['-126900','TRANSAFE代付-3%'],['0','OtherProvider'],['+500.125','NativeProvider']]){
   assert.deepEqual(await details(db,primary+amount+'，渠道:'+provider+'【代付成功】'),{reason:'充提差额未达免审要求',actualValue:amount,actualField:'充提差额',threshold:null});
  }
  assert.equal((await details(db,'免审未通过：充提差额不满足自动提现要求')).reason,'充提差额未达免审要求');
 }finally{await db.close()}
});
test('independent and compound gateway failures keep distinct root causes and do not interpret range values as rules',async()=>{
 const db=await fixture();try{await db.exec(migration);
  const suffixes=[['失败信息:No Available Channels','无可用代付通道'],['失败信息:"No Available Channels"','无可用代付通道'],['失败信息:The amount is not within the range of 999999-15000.','提现金额超出通道范围'],['代付异常:代付异常:"Insufficient balance"','代付余额不足']];
  for(const [text,reason]of suffixes){assert.equal((await details(db,text)).reason,reason);assert.equal((await details(db,primary+'-10000；'+text+'，渠道:QQ代付V3【代付成功】')).reason,'充提差额未达免审要求；'+reason)}
  assert.equal((await details(db,primary+'-10000；失败信息:The amount is not within the range of 10-200.')).reason,'充提差额未达免审要求；提现金额超出通道范围');
  assert.equal((await details(db,primary+'-10000；失败信息:No Available Channels；代付异常:"Insufficient balance"')).reason,'充提差额未达免审要求；无可用代付通道；代付余额不足');
  assert.equal((await details(db,primary+'-10000代付异常:代付异常:"Insufficient balance"Olá,solicite a retirada novamente.')).reason,'充提差额未达免审要求；代付余额不足；Olá；solicite a retirada novamente.');
 }finally{await db.close()}
});
test('complete source eligibility families unify, while malformed or unknown clauses and numeric codes stay distinct',async()=>{
 const db=await fixture();try{await db.exec(migration);
  for(const [text,reason]of[['免审未通过:用户等级不在自动提现等级范围内,6921,autoWithdrawalLimitLevel:[6921,7227]','会员层级不在免审范围（允许等级：[6921,7227]）'],['免审未通过:用户未完成首充会员:123,null','会员未完成首充'],['免审未通过:用户不满足第一次提现流水要求:isFirstWithdrawal:true,userFlow:10,historicalValidBetting:20','首次提现流水未达要求'],['免审条件不过:用户领取助力领现金或者代理宝箱活动奖励(多次)','领取助力现金或代理宝箱奖励（多次）']])assert.equal((await details(db,text)).reason,reason);
  const range='免审未通过:用户等级不在自动提现等级范围内,';
  assert.deepEqual(await details(db,range+'9000,autoWithdrawalLimitLevel:[6921,7227]'),{reason:'会员层级不在免审范围（允许等级：[6921,7227]）',actualValue:'9000',actualField:'会员等级',threshold:'[6921,7227]'});
  assert.notEqual((await details(db,range+'9000,autoWithdrawalLimitLevel:[6921,7227]')).reason,(await details(db,range+'9000,autoWithdrawalLimitLevel:[9001,9002]')).reason);
  assert.equal((await details(db,range+'9000,autoWithdrawalLimitLevel:[6921,7227]')).reason,(await details(db,range+'9001,autoWithdrawalLimitLevel:[6921,7227]')).reason);
  for(const text of['银行失败501','银行失败503','No Available Channels tomorrow','The amount is not within the range of unknown','免审未通过:用户等级不在自动提现等级范围内,6921,autoWithdrawalLimitLevel:[6921,,7227]','免审未通过:用户不满足第一次提现流水要求:isFirstWithdrawal:false,userFlow:10,historicalValidBetting:20',primary+'-10000其他错误501',primary+'1'.repeat(25)])assert.equal((await details(db,text)).reason,text);
  assert.equal((await details(db,primary+'-10000；其他规则:用户ID501')).reason,'充提差额未达免审要求；其他规则:用户ID501');
 }finally{await db.close()}
});
test('legacy configured thresholds, comparators and all rejection response fields retain their exact semantics',async()=>{
 const db=await fixture();try{
  const inputs=['首存金额大于19999.00,首存金额:20000','用户余额大于50000,用户余额:60000','首存金额大于等于29999,首存金额:35000','累计提款次数不能小于3次,当前累计提现次数:0次','打码倍数小于2,不能自动出款,上次提现后的有效投注(sumLotteryAmount):0,上次提现后的成功充值总额:100,当前用户打码倍数(userBetTurnoverMultiple):0','Unknown exact 501'];
  const before=await Promise.all(inputs.map(x=>details(db,x)));
  await order(db,'REJECTION-A',primary+'-10000',{status:'未通过',rejection:'[Native exact] 501'});await order(db,'REJECTION-B',primary+'-20000',{status:'未通过',rejection:'[Native exact] 503'});
  const kinds=['categories','rejection','operators','orders'];const responses=[];for(const kind of kinds)responses.push(await call(db,{kind}));
  await db.exec(migration);for(let i=0;i<inputs.length;i++)assert.deepEqual(await details(db,inputs[i]),before[i]);for(let i=0;i<kinds.length;i++)assert.deepEqual(await call(db,{kind:kinds[i]}),responses[i]);
 }finally{await db.close()}
});
test('native groups/variants/order pages use one stable key and conserve all raw notes across successful/rejected/pending status',async()=>{
 const db=await fixture();try{
  const texts=[primary+'-10000，渠道:QQ代付V3【代付成功】',primary+'-20000，渠道:TRANSAFE代付-3%【代付成功】'];let i=0;
  for(const [n,count]of [[texts[0],4],[texts[1],3]])for(let j=0;j<count;j++)await order(db,'SYNTHETIC-'+(++i),n,{status:['已支付','未通过','待审核'][j%3]});
  await order(db,'EMPTY',null);await order(db,'AUTO',texts[0],{operator:'system'});await order(db,'SECONDARY',primary+'-500；失败信息:No Available Channels');await db.exec(migration);
  const all=await call(db);assert.equal(all.noteCount,9);assert.equal(all.rows.reduce((s,r)=>s+r.count,0),9);assert.equal(all.rows.find(r=>r.reason==='检测没备注').count,1);
  const row=all.rows.find(r=>r.reason==='充提差额未达免审要求');assert.equal(row.count,7);assert.equal(row.sourceVariantCount,2);assert.equal(row.success+row.rejected+row.other,7);
  const variants=await call(db,{kind:'blockingVariants',reasonKey:row.reasonKey});assert.equal(variants.rows.reduce((s,r)=>s+r.count,0),7);assert.deepEqual(new Set(variants.rows.map(r=>r.sourceReason)),new Set(texts));assert(variants.rows.every(r=>r.canonicalReason===row.reason&&r.reasonKey===row.reasonKey));
  const orders=await call(db,{kind:'blockingOrders',reasonKey:row.reasonKey});assert.equal(orders.total,7);assert.equal(new Set(orders.rows.map(r=>r.orderNumber)).size,7);assert(orders.rows.every(r=>texts.includes(r.rawManualRemark)&&r.blockingReason===row.reason&&r.reasonKey===row.reasonKey));
  assert.equal((await call(db,{kind:'blockingOrders',reasonKey:row.reasonKey,query:'SYNTHETIC-1'})).total,1);
 }finally{await db.close()}
});
test('PANDA classifies original notes directly and never lets a coarse prior category merge unknown source conditions',async()=>{
 const db=await fixture();try{
  const one=primary+'-10000，渠道:QQ代付V3【代付成功】',two=primary+'-20000，渠道:TRANSAFE代付-3%【代付成功】',unknown='Unknown source condition 501';
  const unknownTwo='Unknown source condition 503';
  const snapshot={groups:[{reason_label:one,classification:'template',operator_class:'manual',count:4,success:3,reject:1,other:0},{reason_label:two,classification:'template',operator_class:'manual',count:3,success:2,reject:0,other:1},{reason_label:unknown,classification:'template',operator_class:'manual',count:2,success:1,reject:1,other:0},{reason_label:unknownTwo,classification:'template',operator_class:'manual',count:1,success:0,reject:1,other:0},{reason_label:'SOURCE EMPTY PLACEHOLDER',classification:'empty',operator_class:'manual',count:5,success:4,reject:1,other:0},{reason_label:one,classification:'template',operator_class:'auto',count:20,success:20,reject:0,other:0}],coverage:{unique_count:35}};
  await db.query("insert into withdraw_reasons_daily values('BR','SYNTHETIC-PANDA','2026-10-09','PANDA',$1,now())",[snapshot]);
  await db.query("insert into synthetic_grouped_reasons values('BR','SYNTHETIC-PANDA','2026-10-09','PANDA',$1,now())",[{groups:[{reason_label:'Legacy lossy primary',operator_class:'manual',variants:[{reason_label:one},{reason_label:two}]},{reason_label:'Established fallback condition',operator_class:'manual',variants:[{reason_label:unknown},{reason_label:unknownTwo}]}]}]);
  await db.exec(migration);const req={country:'巴西',platform:'SYNTHETIC-PANDA'};const d=await call(db,req);assert.equal(d.noteCount,15);assert.equal(d.rows.reduce((s,r)=>s+r.count,0),15);assert.equal(d.rows.find(r=>r.reason==='检测没备注').count,5);assert.equal(d.rows.find(r=>r.reason==='检测没备注').sourceReason,null);assert.equal(d.rows.find(r=>r.reason===unknown).count,2);assert.equal(d.rows.find(r=>r.reason===unknownTwo).count,1);assert(!d.rows.some(r=>r.reason==='Established fallback condition'));
  const row=d.rows.find(r=>r.reason==='充提差额未达免审要求');assert.equal(row.count,7);assert.equal(row.sourceVariantCount,2);
  const v=await call(db,{...req,kind:'blockingVariants',reasonKey:row.reasonKey});assert.equal(v.rows.reduce((s,r)=>s+r.count,0),7);assert.deepEqual(new Set(v.rows.map(r=>r.sourceReason)),new Set([one,two]));
  const empty=await call(db,{...req,kind:'blockingVariants',reasonKey:d.rows.find(r=>r.reason==='检测没备注').reasonKey});assert.equal(empty.rows[0].sourceReason,null);assert.equal(empty.rows[0].count,5);
  const orders=await call(db,{...req,kind:'blockingOrders',reasonKey:row.reasonKey});assert.equal(orders.available,false);assert.equal(orders.canViewBlockingOrders,false);
  assert.deepEqual((await db.query('select snapshot from withdraw_reasons_daily')).rows[0].snapshot,snapshot);
 }finally{await db.close()}
});
test('scope, helper/reader metadata, ACL and replay remain intact, with atomic drift rejection',async()=>{
 const db=await fixture();try{
  const before=[await meta(db,cleaned),await meta(db,reader)];await db.exec(migration);const after=[await meta(db,cleaned),await meta(db,reader)];for(let i=0;i<2;i++)assert.deepEqual(after[i].metadata,before[i].metadata);await db.exec(migration);assert.deepEqual([await meta(db,cleaned),await meta(db,reader)],after);
  await db.exec("set test.denied='yes'");await assert.rejects(call(db),/scope_denied/);await db.exec("set test.denied='no'");await assert.rejects(call(db,{platform:'FOREIGN'}),/scope_denied/);
  for(const role of['anon','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,reader])).rows[0].ok,false);
  assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') ok",[reader])).rows[0].ok,true);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g,''),/\b(?:create table|alter table|insert into|delete from|grant execute|create index)\b/i);
 }finally{await db.close()}
 for(const drift of['body','acl','config','owner']){const db=await fixture();try{
  if(drift==='body')await db.exec(baseline.replace('declare\n v_scope','declare\n -- unreviewed reader\n v_scope'));
  if(drift==='acl')await db.exec(`grant execute on function ${reader} to anon`);
  if(drift==='config')await db.exec(`alter function ${reader} set search_path=public`);
  if(drift==='owner')await db.exec(`create role unexpected_owner;alter function ${reader} owner to unexpected_owner`);
  const before=await meta(db,cleaned);await assert.rejects(db.exec(migration),/withdraw_blocking_taxonomy_(definition|metadata)_drift/);await db.exec('rollback');assert.deepEqual(await meta(db,cleaned),before);
 }finally{await db.close()}}
});
test('snapshot rejection remains exact and truncated blocking source text cannot become a confident family',async()=>{
 const db=await fixture();try{
  const req={country:'巴西',platform:'SYNTHETIC-PANDA'};
  const snapshot={note_field:'remark',groups:[{reason_label:'Native rejection 501',classification:'template',operator_class:'manual',count:2,success:1,reject:1,other:0},{reason_label:'Native rejection 503',classification:'template',operator_class:'manual',count:2,success:0,reject:2,other:0}]};
  await db.query("insert into withdraw_reasons_daily values('BR','SYNTHETIC-PANDA','2026-10-09','PANDA',$1,now())",[snapshot]);
  const before=[];for(const kind of['categories','rejection','orders'])before.push(await call(db,{...req,kind}));
  await db.exec(migration);for(const [i,kind]of ['categories','rejection','orders'].entries())assert.deepEqual(await call(db,{...req,kind}),before[i]);
  const truncated=primary+'-10000';await db.query('update withdraw_reasons_daily set snapshot=$1::jsonb',[JSON.stringify({groups:[{reason_label:truncated,classification:'truncated',operator_class:'manual',count:2,success:1,reject:1,other:0}]})]);
  const r=await call(db,req);assert.equal(r.rows[0].reason,truncated);assert.equal(r.rows[0].sourceReason,truncated);assert.equal(r.rows[0].count,2);
 }finally{await db.close()}
});
