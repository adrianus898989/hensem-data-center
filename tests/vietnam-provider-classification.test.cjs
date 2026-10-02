const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,scalar,canon,source,ids,migration}=require('./fixtures/vietnam-provider-classification-harness.cjs');
test('source WG BR also has exact transfer exemption; same label/type in AR stays chargeable',async()=>{
 const db=await setup();try{
 await db.exec("insert into private.test_platforms values('10000000-0000-0000-0000-000000000005','26BET','巴西','BR','wg','26BET','America/Sao_Paulo','BRL');insert into public.wg_recharge_details(country,platform,site_code,business,order_number,provider,channel,status_code,status_group,created_at,success_at,member_currency,member_amount) values('BR','26BET','278','recharge','SYNTHETIC-BR',null,'提现转充值',2,'success','2026-10-01T12:00Z','2026-10-01T12:01Z','BRL',300);insert into public.ar_collected_orders values('AR','VN','92LOTTERY','recharge','SYNTHETIC-AR',null,'提现转充值','提现转充值','已支付',100,null,'2026-10-01 12:00','2026-10-01 12:01','2026-10-02Z');insert into public.ar_config_targets values('AR','VN','92LOTTERY','VND');insert into private.fee_rate_generations values('10000000-0000-0000-0000-000000000010','synthetic','2026-10-01Z','2026-10-01Z','synthetic','{}');insert into private.fee_rate_versions(rule_key,source_key,sheet_id,sheet_name,country,provider,category,direction,currency,effective_from,percent_rate,fixed_fee,pricing_state,semantic_rule,provenance,generation_id) values('rule','synthetic',1,'synthetic','VN','提现转充值','BANK','charge','VND','2026-09-01Z',0.3,20,'ready','{}','{}','10000000-0000-0000-0000-000000000010');insert into public.third_party_rates values('fee','VN','BANK','提现转充值','2026-10-01Z');insert into private.fee_rate_current_evidence select 'fee','charge','rule','ready',id,effective_from,'{}',generation_id from private.fee_rate_versions;");
 await db.exec(migration);
 const q={action:'aggregate',platformId:'10000000-0000-0000-0000-000000000005',startAt:'2026-10-01T03:00:00Z',endAt:'2026-10-02T03:00:00Z',direction:'charge',status:'all',view:'providers'};
 const br=await scalar(db,'select private.dashboard_admin_live_query_raw($1::jsonb)',[JSON.stringify(q)]);assert.equal(br.groups.provider[0].provider,'提现转充值');assert.equal(br.groups.provider[0].fee_exempt_count,1);assert.equal(Number(br.groups.provider[0].fee_version_estimated_amount),0);assert.equal(br.groups.provider[0].currency,'BRL');
 for(const view of ['full','providers']){const ar=await scalar(db,'select private.dashboard_admin_live_query_raw($1::jsonb)',[JSON.stringify({...q,platformId:ids.ar,startAt:'2026-09-30T17:00:00Z',endAt:'2026-10-01T17:00:00Z',view})]);const g=ar.groups.provider[0];assert.equal(g.fee_exempt_count,0);assert.equal(Number(g.fee_version_estimated_amount),50);}
 }finally{await db.close();}
});
test('canonical group merging sums exemption counts and known zero subtotals without losing conservation',async()=>{
 const db=await setup();try{await db.exec(migration);
 const rows=[{provider:'Tron-USDT',direction:'charge',currency:'VND',success_count:10,fee_exempt_count:10,fee_version_matched_count:10,fee_version_unmatched_count:0,fee_version_state:'complete',fee_version_estimated_amount:'0'},{provider:'TronPayUSDT',direction:'charge',currency:'VND',success_count:3,fee_exempt_count:3,fee_version_matched_count:3,fee_version_unmatched_count:0,fee_version_state:'complete',fee_version_estimated_amount:'0'}];
 const merged=await scalar(db,"select private.dashboard_admin_live_remap_groups($1::jsonb,'越南','92LOTTERY',false)",[JSON.stringify(rows)]);assert.equal(merged.length,1);assert.equal(merged[0].fee_exempt_count,13);assert.equal(merged[0].fee_version_matched_count,13);assert.equal(merged[0].fee_version_unmatched_count,0);assert.equal(Number(merged[0].fee_version_estimated_amount),0);
 }finally{await db.close();}
});
test('exact four confirmed AR VN native tuples share TronPayUSDT, keep raw/type and manual priorities',async()=>{
 const db=await setup();try{
 const before=(await db.query('select to_jsonb(r) value from private.dashboard_admin_provider_registry r order by platform')).rows;
 await db.exec(migration);
 for(const p of ['66CLUB','82VN','92LOTTERY','VN168'])assert.equal(await canon(db,'越南',p,'Tron-USDT'),'TronPayUSDT');
 assert.equal(await canon(db,'越南','OTHER','Tron-USDT'),'USDT');
 assert.equal(await canon(db,'印度','92LOTTERY','Tron-USDT'),'Tron-USDT');
 assert.equal(await scalar(db,"select private.dashboard_admin_live_confirmed_provider('印度','91CLUB','USDT(TRC20)-3')"),'TronPayUSDT');
 assert.equal(await canon(db,'越南','92LOTTERY','Unknown-USDT'),'Unknown-USDT');
 assert.deepEqual((await db.query('select to_jsonb(r) value from private.dashboard_admin_provider_registry r order by platform')).rows,before);
 await db.exec("insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider) values('越南','92LOTTERY','Tron-USDT','UserChosen');");
 assert.equal(await canon(db,'越南','92LOTTERY','Tron-USDT'),'UserChosen');
 }finally{await db.close();}
});
test('provider options, configuration rows, filter expansion and workorder batch agree on exact identity',async()=>{
 const db=await setup();try{await db.exec(migration);
 const request={action:'details',platformId:ids.ar,providers:['TronPayUSDT'],direction:'charge',offset:20,limit:20};
 const expanded=await scalar(db,'select private.dashboard_admin_live_expand_provider_filter($1::jsonb)',[JSON.stringify(request)]);assert.deepEqual(expanded.providers,['Tron-USDT','TronPayUSDT']);assert.equal(expanded.offset,20);
 const options=await scalar(db,'select private.dashboard_admin_live_provider_options($1::jsonb)',[JSON.stringify({platformIds:[ids.ar],direction:'charge'})]);assert.deepEqual(options.providers,['TronPayUSDT']);
 const config=(await db.query("select * from private.dashboard_admin_live_provider_rows() where country='越南' and platform='92LOTTERY' and raw_provider='Tron-USDT'")).rows[0];assert.equal(config.canonical_provider,'TronPayUSDT');assert.deepEqual(config.canonical_values,['TronPayUSDT']);
 const input=[{country:'越南',platform:'92LOTTERY',raw_provider:'Tron-USDT',channel_type:'USDT-TRC20'}];assert.equal((await db.query('select * from private.dashboard_admin_live_workorder_provider_batch($1::jsonb)',[JSON.stringify(input)])).rows[0].provider,'TronPayUSDT');
 await db.exec("insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider) values('越南','92LOTTERY','Tron-USDT','UserChosen');");
 assert.deepEqual((await scalar(db,'select private.dashboard_admin_live_provider_options($1::jsonb)',[JSON.stringify({platformIds:[ids.ar],direction:'charge'})])).providers,['UserChosen']);
 assert.equal((await db.query('select * from private.dashboard_admin_live_workorder_provider_batch($1::jsonb)',[JSON.stringify(input)])).rows[0].provider,'UserChosen');
 }finally{await db.close();}
});
test('native transfer business category retains thirteen created/success rows and raw NULL evidence across details and aggregates',async()=>{
 const db=await setup();try{
 const before=(await db.query('select to_jsonb(r) value from public.wg_recharge_details r order by order_number')).rows;
 await db.exec(migration);
 for(const action of ['details','aggregate'])for(const [platform,count]of [['98VV',10],['XX98',3]]){
 const s=await source(db,{platform,action});
 const groups=(await db.query("with orders as("+s+") select provider,channel_type,currency,count(*) n,sum(amount)::text amount,count(raw_provider) raw_nonnull,count(*) filter(where success_at>='2026-09-30T17:00Z' and success_at<'2026-10-01T17:00Z') success_count from orders group by provider,channel_type,currency")).rows;
 assert.equal(groups.length,1);assert.equal(groups[0].provider,'提现转充值');assert.equal(groups[0].channel_type,'提现转充值');assert.equal(Number(groups[0].n),count);assert.equal(Number(groups[0].success_count),count);assert.equal(Number(groups[0].amount),count*100);assert.equal(Number(groups[0].raw_nonnull),0);
 }
 const opts=await scalar(db,'select private.dashboard_admin_live_provider_options($1::jsonb)',[JSON.stringify({platformIds:[ids.wg,ids.xx],direction:'charge'})]);assert(opts.providers.includes('提现转充值'));
 const req={action:'details',platformId:ids.wg,providers:['提现转充值'],direction:'charge'};assert.deepEqual((await scalar(db,'select private.dashboard_admin_live_expand_provider_filter($1::jsonb)',[JSON.stringify(req)])).providers,['提现转充值']);
 assert.deepEqual((await db.query('select to_jsonb(r) value from public.wg_recharge_details r order by order_number')).rows,before);
 }finally{await db.close();}
});
test('same type with real provider, other type, direction, native country and tuple stay unchanged; manual assignment wins',async()=>{
 const db=await setup();try{
 await db.exec("insert into public.wg_recharge_details(country,platform,site_code,business,order_number,provider,channel,status_code,status_group,created_at,success_at) values('VN','98VV','3257','recharge','Nonempty','RealPay','提现转充值',2,'success','2026-10-01T12:00Z','2026-10-01T12:01Z'),('VN','98VV','3257','recharge','OtherType',null,'其他类型',2,'success','2026-10-01T12:00Z','2026-10-01T12:01Z'),('BR','98VV','3257','recharge','WrongCountry',null,'提现转充值',2,'success','2026-10-01T12:00Z','2026-10-01T12:01Z'),('VN','OTHER','3257','recharge','WrongPlatform',null,'提现转充值',2,'success','2026-10-01T12:00Z','2026-10-01T12:01Z');insert into public.wg_withdraw_details(country,platform,site_code,business,order_number,provider,channel,status_group,created_at) values('VN','98VV','3257','withdraw','Withdraw',null,'提现转充值','pending','2026-10-01T12:00Z');");
 await db.exec(migration);let s=await source(db,{direction:'all',status:'all'});
 const rows=(await db.query('select order_number,provider,raw_provider,channel_type from('+s+') orders where order_number not like \'SYNTHETIC%\' order by order_number')).rows;
 for(const r of rows)assert.equal(r.provider,['Nonempty','WrongCountry','WrongPlatform'].includes(r.order_number)?'提现转充值':'未识别通道',r.order_number);
 await db.exec("insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider) values('越南','98VV','','ExplicitUserAssignment');");
 s=await source(db);assert.equal(await scalar(db,"select count(*) from("+s+") orders where provider='提现转充值'"),1,'empty-raw assignment retains its display; separate unassigned nonempty transfer still uses its business class');
 assert.equal(await canon(db,'越南','98VV','未识别通道'),'ExplicitUserAssignment');
 const opts=await scalar(db,'select private.dashboard_admin_live_provider_options($1::jsonb)',[JSON.stringify({platformIds:[ids.wg],direction:'charge'})]);assert(opts.providers.includes('ExplicitUserAssignment'));
 }finally{await db.close();}
});
test('internal transfer business category cannot match an external version even if a price or override shares its name',async()=>{
 const db=await setup();try{
 await db.exec("insert into private.fee_rate_generations values('10000000-0000-0000-0000-000000000010','synthetic','2026-10-01Z','2026-10-01Z','synthetic','{}');insert into private.fee_rate_versions(rule_key,source_key,sheet_id,sheet_name,country,provider,category,direction,currency,effective_from,percent_rate,fixed_fee,pricing_state,semantic_rule,provenance,generation_id) values('rule','synthetic',1,'synthetic','VN','提现转充值','BANK','charge','VND','2026-09-01Z',0.3,20,'ready','{}','{}','10000000-0000-0000-0000-000000000010');insert into public.third_party_rates values('fee','VN','BANK','提现转充值','2026-10-01Z');insert into private.fee_rate_current_evidence select 'fee','charge','rule','ready',id,effective_from,'{}',generation_id from private.fee_rate_versions;");
 const old=await scalar(db,"select private.dashboard_admin_fee_quote('VN','98VV','提现转充值','charge','VND','2026-10-01Z',100,'BANK')");assert.equal(old.fee_version_state,'complete');
 await db.exec(migration);
 for(const view of ['full','providers']){
  const value=await scalar(db,'select private.dashboard_admin_live_query_raw($1::jsonb)',[JSON.stringify({action:'aggregate',platformId:ids.wg,startAt:'2026-09-30T17:00:00Z',endAt:'2026-10-01T17:00:00Z',direction:'charge',status:'all',view,providers:['提现转充值']})]);
  const group=value.groups.provider[0];assert.equal(group.fee_version_state,'complete');assert.equal(Number(group.fee_version_estimated_amount),0);assert.equal(Number(group.fee_exempt_count),10);assert.equal(Number(group.fee_version_matched_count),10);assert.equal(Number(group.fee_version_unmatched_count),0);
 }
 const detail=await scalar(db,'select private.dashboard_admin_live_query_raw($1::jsonb)',[JSON.stringify({action:'details',platformId:ids.wg,startAt:'2026-09-30T17:00:00Z',endAt:'2026-10-01T17:00:00Z',direction:'charge',status:'success',providers:['提现转充值']})]);
 assert.equal(detail.rows.length,10);assert(detail.rows.every(r=>r.fee_exempt&&r.fee_version_estimated_amount==='0'&&r.raw_provider===null));
 assert.equal((await scalar(db,"select private.dashboard_admin_fee_quote('VN','OTHER','提现转充值','charge','VND','2026-10-01Z',100,'BANK')")).fee_version_state,'complete','unconfirmed other tuple behavior retained');
 }finally{await db.close();}
});
test('all existing PostgreSQL metadata and authorization are preserved; new identity helper is private and drift fails closed',async()=>{
 const db=await setup();try{
 const before=(await db.query("select oid::regprocedure::text signature,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid in('private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure,'private.dashboard_admin_live_provider_options(jsonb)'::regprocedure,'private.dashboard_admin_wg_order_source(text,boolean)'::regprocedure,'private.dashboard_admin_fee_intervals(text,text,text,text,text,text)'::regprocedure) order by signature")).rows;
 await db.exec(migration);assert.deepEqual((await db.query("select oid::regprocedure::text signature,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid in('private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure,'private.dashboard_admin_live_provider_options(jsonb)'::regprocedure,'private.dashboard_admin_wg_order_source(text,boolean)'::regprocedure,'private.dashboard_admin_fee_intervals(text,text,text,text,text,text)'::regprocedure) order by signature")).rows,before);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar(db,"select has_function_privilege($1,'private.dashboard_admin_live_confirmed_provider(text,text,text)','execute')",[role]),false);
 await db.exec("select set_config('test.platform','XX98',false)");const options=await scalar(db,'select private.dashboard_admin_live_provider_options($1::jsonb)',[JSON.stringify({platformIds:[ids.ar],direction:'charge'})]);assert.deepEqual(options.providers,[]);
 await db.exec("select set_config('test.denied','yes',false)");await assert.rejects(scalar(db,'select private.dashboard_admin_live_provider_options($1::jsonb)',[JSON.stringify({platformIds:[ids.xx],direction:'charge'})]),/access_denied/);
 }finally{await db.close();}
 const bad=await setup();try{await bad.exec('grant execute on function private.dashboard_admin_wg_order_source(text,boolean) to authenticated');await assert.rejects(bad.exec(migration),/vn_provider_metadata_drift/);await bad.exec('rollback');assert.equal(await scalar(bad,"select to_regprocedure('private.dashboard_admin_live_confirmed_provider(text,text,text)')"),null);}finally{await bad.close();}
});

test('mixed WG business classes preserve the entire success denominator with unknown or priced ordinary channels',async()=>{
 for(const variant of ['no_versions','other_type_version','priced']) {
  const db=await setup();try{
   // Identical provider label is insufficient for exemption. Native type alone decides.
   await db.exec("insert into public.wg_recharge_details(country,platform,site_code,business,order_number,provider,channel,status_code,status_group,created_at,success_at,member_currency,member_amount) values('VN','98VV','3257','recharge','SYNTHETIC-ORDINARY','提现转充值','MOMO',2,'success','2026-10-01T12:00Z','2026-10-01T12:01Z','VND',100)");
   if(variant!=='no_versions')await db.exec("insert into private.fee_rate_generations values('10000000-0000-0000-0000-000000000010','synthetic','2026-10-01Z','2026-10-01Z','synthetic','{}');insert into private.fee_rate_versions(rule_key,source_key,sheet_id,sheet_name,country,provider,category,direction,currency,effective_from,percent_rate,fixed_fee,pricing_state,semantic_rule,provenance,generation_id) values('rule','synthetic',1,'synthetic','VN','提现转充值','"+(variant==='priced'?'MOMO':'BANK')+"','charge','VND','2026-09-01Z',0.3,20,'ready','{}','{}','10000000-0000-0000-0000-000000000010');insert into public.third_party_rates values('fee','VN','"+(variant==='priced'?'MOMO':'BANK')+"','提现转充值','2026-10-01Z');insert into private.fee_rate_current_evidence select 'fee','charge','rule','ready',id,effective_from,'{}',generation_id from private.fee_rate_versions;");
   await db.exec(migration);
   const request={action:'aggregate',platformId:ids.wg,startAt:'2026-09-30T17:00:00Z',endAt:'2026-10-01T17:00:00Z',direction:'charge',status:'all'};
   for(const view of ['full','providers']){
    const result=await scalar(db,'select private.dashboard_admin_live_query_raw($1::jsonb)',[JSON.stringify({...request,view})]);const g=result.groups.provider[0];
    assert.equal(g.success_count,11);assert.equal(g.fee_exempt_count,10);
    assert.equal(g.fee_version_matched_count,variant==='priced'?11:10);assert.equal(g.fee_version_unmatched_count,variant==='priced'?0:1);
    assert.equal(g.fee_version_matched_count+g.fee_version_unmatched_count,g.success_count);
    assert.equal(g.fee_version_state,variant==='priced'?'complete':'partial');assert.equal(Number(g.fee_version_estimated_amount),variant==='priced'?50:0);
   }
   const details=await scalar(db,'select private.dashboard_admin_live_query_raw($1::jsonb)',[JSON.stringify({...request,action:'details',status:'success'})]);const ordinary=details.rows.find(r=>r.channel_type==='MOMO');assert(ordinary);assert.notEqual(ordinary.fee_exempt,true);
   assert.equal(ordinary.fee_version_state,variant==='priced'?'complete':'unknown');if(variant==='priced')assert.equal(Number(ordinary.fee_version_estimated_amount),50);
  }finally{await db.close();}
 }
});
test('manual raw-name assignment and NULL ordinary type do not hide unknown successful rows from fee accounting',async()=>{
 const db=await setup();try{
 await db.exec("insert into public.wg_recharge_details(country,platform,site_code,business,order_number,provider,channel,status_code,status_group,created_at,success_at,member_currency,member_amount) values('VN','98VV','3257','recharge','SYNTHETIC-NULL-TYPE',null,null,2,'success','2026-10-01T12:00Z','2026-10-01T12:01Z','VND',100);insert into private.dashboard_admin_provider_overrides(country,platform,raw_provider,canonical_provider) values('越南','98VV','','ExplicitUserAssignment');");
 await db.exec(migration);
 for(const view of ['full','providers']){const result=await scalar(db,'select private.dashboard_admin_live_query_raw($1::jsonb)',[JSON.stringify({action:'aggregate',platformId:ids.wg,startAt:'2026-09-30T17:00:00Z',endAt:'2026-10-01T17:00:00Z',direction:'charge',status:'all',view})]);const g=result.groups.provider[0];
 assert.equal(g.provider,'未识别通道');assert.equal(g.success_count,11);assert.equal(g.fee_exempt_count,10);assert.equal(g.fee_version_matched_count,10);assert.equal(g.fee_version_unmatched_count,1);assert.equal(g.fee_version_state,'partial');assert.equal(Number(g.fee_version_estimated_amount),0);}
 assert.equal(await canon(db,'越南','98VV','未识别通道'),'ExplicitUserAssignment');
 }finally{await db.close();}
});
