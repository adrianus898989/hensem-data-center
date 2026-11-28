const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const R=path.resolve(__dirname,'..'),main=path.resolve(process.env.ATOMIC_RULES_REPO||path.resolve(R,'../../..')),read=n=>fs.readFileSync(path.join(R,n),'utf8');
const h=require(path.join(main,'tests/fixtures/withdraw-reasons-query-harness.cjs'));
const A='总打码倍数1.3720(有效投注137.2/总充值100)小于配置4',B='累计提款次数0小于配置1次',C='首存金额5000大于等于配置4999';
const names=['dashboard_admin_live_blocking_core','dashboard_admin_live_blocking_details_cleaned','dashboard_admin_live_blocking_members','withdraw_reason_wg_atomic','dashboard_admin_newar_withdraw_reasons','withdraw_reason_newar_all','withdraw_reason_newar_detail_page','withdraw_reason_newar_index_valid','withdraw_reason_ar_all','dashboard_admin_live_withdraw_reasons'];
async function setup(){const db=await h.setup();try{await db.exec("set check_function_bodies=off;create function private.dashboard_admin_wg_sites()returns table(country text,country_code text,platform text,site_code text,currency text,timezone text)language sql stable as $$select null::text,null::text,null::text,null::text,null::text,null::text where false$$");for(const n of names)await db.exec(read('sql/'+n+'.sql'));await db.exec(`create or replace function private.withdraw_reason_read(jsonb,jsonb,jsonb,jsonb,boolean)returns jsonb language sql stable as $$select null::jsonb$$;create or replace function private.withdraw_prepared_reason_last_complete(jsonb,jsonb,jsonb,jsonb,boolean,jsonb)returns jsonb language sql stable as $$select null::jsonb$$;`);return db;}catch(e){await db.close();throw e;}}
const q={country:'印度',platform:'MAAN.WIN',date:'2026-10-17',kind:'blocking',limit:500,offset:0};const native={source:'newar',country:'印度',name:'MAAN.WIN',source_name:'MAANWIN',timezone:'Asia/Kolkata'};
const scalar=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0].v;
async function seed(db){await db.exec('delete from public.newar_detail_records;delete from private.newar_withdraw_facts;delete from private.newar_withdraw_reason_facts');for(const [i,n,status]of [[1,`${A};${B}`,'success'],[2,`${A};${C}`,'rejected'],[3,B,'pending'],[4,`${A};${A};${B}`,'success']])await h.newar.order(db,'SYNTH-ATOM-'+i,n,{platform:'MAANWIN',created:'2026-10-17T00:00:00Z',captured:'2026-10-18T00:00:00Z',handled:'2026-10-17T00:01:00Z',status});}
test('NEWAR raw/prepared/member variants/order details conserve original manual universe',async()=>{const db=await setup();try{await seed(db);const raw=await scalar(db,'select private.dashboard_admin_newar_withdraw_reasons($1,$2,$3)v',[q,{mode:"all",countries:[]},native]);const full=await scalar(db,'select private.withdraw_reason_newar_all($1,$2,$3)v',[q,{mode:"all",countries:[]},native]);assert.equal(raw.reasonGrouping,'atomic_rules_v1');assert.equal(raw.noteCount,4);assert.equal(raw.summary.selectedCount,4);assert.equal(raw.summary.ruleMembership.hitCount,7);assert.deepEqual(raw.rows,full.rows);assert.equal(await scalar(db,'select private.withdraw_reason_newar_index_valid($1)v',[full]),true);const a=raw.rows.find(x=>x.reason==='总打码倍数小于配置倍数');assert.equal(a.count,3);for(const kind of ['blockingVariants','blockingOrders']){const req={...q,kind,reasonKey:a.reasonKey};const direct=await scalar(db,'select private.dashboard_admin_newar_withdraw_reasons($1,$2,$3)v',[req,{mode:"all",countries:[]},native]);const prepared=await scalar(db,'select private.withdraw_reason_newar_detail_page($1,$2,$3,$4)v',[full,req,{mode:"all",countries:[]},native]);assert.deepEqual(direct.rows,prepared.rows);assert.equal(prepared.summary.selectedCount,3);if(kind==='blockingOrders')for(const row of direct.rows)assert.equal(row.blockingActualValue,'1.3720');}for(const mutation of [p=>{p._newarLabelIndex.rows[0][4].actualValue='BAD'},p=>{p._newarLabelIndex.rows[0][3].push(p._newarLabelIndex.rows[0][3][0])},p=>{p.rows[0].count++},p=>{delete p.reasonGrouping}]){const bad=structuredClone(full);mutation(bad);assert.equal(await scalar(db,'select private.withdraw_reason_newar_index_valid($1)v',[bad]),false);}}finally{await db.close();}});
test('AR manual totals do not expand with rules and exact rejection stays unchanged',async()=>{const db=await setup();try{await db.exec('delete from public.ar_collected_orders');for(const [i,n]of [[1,`${A};${B}`],[2,`${A};${C}`],[3,B],[4,`${A};${A};${B}`]])await h.ar.add(db,'ATOM-AR-'+i,'synthetic-agent',{applied_at:'2026-10-17 12:00:00',completed_at:'2026-10-17 12:03:00',manual_remark:n});const req={...q,platform:'91CLUB'};const raw=await scalar(db,'select private.dashboard_admin_live_withdraw_reasons($1)v',[req]);assert.equal(raw.reasonGrouping,'atomic_rules_v1');assert.equal(raw.noteCount,4);assert.equal(raw.summary.operatorCounts.manual,4);assert.equal(raw.summary.selectedCount,4);assert.equal(raw.summary.ruleMembership.hitCount,7);assert.equal(raw.rows.find(x=>x.reason==='总打码倍数小于配置倍数').count,3);}finally{await db.close();}});
module.exports={setup,seed,q,native,scalar,A,B,C};

test('the user remark operation enriches only authorized, paginated NEWAR orders', async () => {
 const db = await setup();
 try {
  await db.exec('delete from public.newar_detail_records');
  const notes = [
   ['01', {memberNoteLabel:'人工核对 synthetic@example.test https://example.test/note 1234567890'}],
   ['02', {memberNoteLabel:undefined, memberNoteSource:undefined}],
   ['03', {memberNoteLabel:'WRONG SOURCE', memberNoteSource:'remark'}],
   ['04', {memberNoteLabel:{text:'WRONG TYPE'}}],
   ['05', {memberNoteLabel:'   '}],
  ];
  for (const [id, raw] of notes) {
   await h.newar.order(db, 'remark-'+id, A, {platform:'MAANWIN',
    created:'2026-10-17T00:00:00Z', captured:'2026-10-18T00:00:00Z', raw});
  }
  await h.newar.order(db, 'remark-01', A, {platform:'DhaniWin',
   created:'2026-10-17T00:00:00Z', captured:'2026-10-18T00:00:00Z', raw:{memberNoteLabel:'OTHER PLATFORM'}});
  const scope = {mode:'selected', countries:['IN'], platforms:[{country:'IN', platform:'MAANWIN'}]};
  const scopeDenied = {mode:'selected', countries:['IN'], platforms:[{country:'IN', platform:'DHANIWIN'}]};
  const rawRead = (request, claims=scope) => scalar(db,'select private.dashboard_admin_newar_withdraw_reasons($1,$2,$3)v',[request,claims,native]);
  const aggregateRead = () => scalar(db,'select private.withdraw_reason_newar_all($1,$2,$3)v',[q,scope,native]);
  const groupingBefore = await rawRead(q);
  const preparedIndex = await aggregateRead();
  const orderPage = {...q, kind:'blockingOrders', reasonKey:groupingBefore.rows[0].reasonKey, limit:2};
  const preparedRead = (request, claims=scope) => scalar(db,'select private.withdraw_reason_newar_detail_page($1,$2,$3,$4)v',[preparedIndex,request,claims,native]);

  // Only the splice fixture for the online AR wrapper is synthetic. Both NEWAR
  // readers, the installer and the sanitizer come from their maintained SQL.
  await db.exec(fs.readFileSync(path.join(main,'supabase/admin-live-order-business.sql'),'utf8'));
  await db.exec(`
    create function private.dashboard_admin_ar_withdraw_with_user_remarks(p_request jsonb)
    returns jsonb language plpgsql stable set search_path = '' as $fixture$
    declare result jsonb := p_request->'fixtureResult';
    begin
     IF p_request->>'kind' IS DISTINCT FROM 'blockingOrders'
     OR result->>'source' IS DISTINCT FROM 'AR 已采集订单'
     OR result->>'basis' IS DISTINCT FROM 'manual_remark'
     OR result->'canViewBlockingOrders' IS DISTINCT FROM 'true'::jsonb
     THEN return result; END IF;
     return result || jsonb_build_object('userRemark',(select max(m.user_remark)
       from (values ('人工核对 synthetic@example.test')) m(user_remark)));
    end
    $fixture$;`);
  const install = fs.readFileSync(path.join(main,'supabase/operations/withdraw-reasons-user-remarks.sql'),'utf8');
  await db.exec(install);
  await db.exec(install);
  assert.deepEqual(await rawRead(q), groupingBefore);
  assert.deepEqual(await aggregateRead(), preparedIndex);
  const variants = await rawRead({...orderPage, kind:'blockingVariants'});
  assert.equal(variants.rows[0].count, notes.length);
  assert.equal(Object.hasOwn(variants.rows[0], 'userRemark'), false);
  await assert.rejects(() => rawRead(orderPage, scopeDenied), /scope_denied/);
  await assert.rejects(() => preparedRead(orderPage, scopeDenied), /scope_denied/);
  const results = [];
  for (const offset of [0, 2, 4]) {
   const request = {...orderPage, offset};
   const direct = await rawRead(request);
   assert.deepEqual(direct.rows, (await preparedRead(request)).rows);
   assert.equal(direct.total, notes.length);
   results.push(...direct.rows);
  }
  assert.equal(results.length, notes.length);
  assert.equal(results[0].orderNumber, 'SYNTHETIC-remark-01');
  assert.equal(results[0].manualRemark, A);
  assert.equal(results[0].userRemark, '人工核对 [已移除邮箱] [已移除链接] [已移除号码]');
  assert(results.slice(1).every(row => !Object.hasOwn(row, 'userRemark')));
  assert.equal(await scalar(db, "select has_function_privilege('authenticated', 'private.withdraw_reason_newar_user_remark(uuid,text,timestamptz,text)', 'EXECUTE')v"), false);

  const arRead = (kind, result) => scalar(db,'select private.dashboard_admin_ar_withdraw_with_user_remarks($1)v',[{kind,fixtureResult:{source:'AR 已采集订单',...result}}]);
  assert.equal((await arRead('blockingOrders',{basis:'manual_remark',canViewBlockingOrders:true})).userRemark,'人工核对 [已移除邮箱]');
  assert.equal((await arRead('orders',{basis:'remark',canViewOrders:true})).userRemark,'人工核对 [已移除邮箱]');
  assert.equal((await arRead('orders',{basis:'remark',canViewOrders:false})).userRemark,undefined);
  assert.equal((await arRead('rejection',{basis:'remark',canViewOrders:true})).userRemark,undefined);
 } finally {
  await db.close();
 }
});

test('AR literal missing-label and true missing remark are distinct atomic states',async()=>{const db=await setup();try{await db.exec('delete from public.ar_collected_orders');await h.ar.add(db,'AR-LITERAL','synthetic-agent',{applied_at:'2026-10-17 12:00:00',manual_remark:'检测没备注'});await h.ar.add(db,'AR-MISSING','synthetic-agent',{applied_at:'2026-10-17 12:00:00',manual_remark:null});const r=await scalar(db,'select private.dashboard_admin_live_withdraw_reasons($1)v',[{...q,platform:'91CLUB'}]);assert.equal(r.rows.length,2);assert.deepEqual(r.rows.map(x=>x.noteState).sort(),['present','unknown']);assert.equal(new Set(r.rows.map(x=>x.reasonKey)).size,2);}finally{await db.close();}});
test('PANDA source aggregates use weighted memberships while preserving unknown completeness and no order capability',async()=>{const db=await setup();try{await db.exec("insert into public.synthetic_catalog values('10000000-0000-4000-8000-000000000099','SYNTHETIC-PANDA','M8','巴西','BR','withdraw','America/Sao_Paulo','BRL','SYNTHETIC-PANDA')");const snap={groups:[{reason_label:`${A};${B}`,operator_class:'manual',count:2,success:1,reject:1,other:0},{reason_label:`${A};${C}`,operator_class:'manual',count:3,success:2,reject:0,other:1},{reason_label:'检测没备注',operator_class:'manual',count:1,success:1,reject:0,other:0},{reason_label:null,classification:'empty',operator_class:'manual',count:1,success:0,reject:1,other:0},{reason_label:A,operator_class:'auto',count:10,success:10,reject:0,other:0}],coverage:{complete:false,unique_count:17},totals:{reject:3}};await db.query("insert into public.withdraw_reasons_daily values('BR','SYNTHETIC-PANDA','2026-10-17','PANDA',$1,now())",[snap]);const req={...q,country:'巴西',platform:'SYNTHETIC-PANDA'};const r=await scalar(db,'select private.dashboard_admin_live_withdraw_reasons($1)v',[req]);assert.equal(r.noteCount,7);assert.equal(r.summary.operatorCounts.manual,null);assert.equal(r.summary.selectedCount,7);assert.equal(r.summary.ruleMembership.unit,'source_group_count_per_rule');assert.equal(r.summary.ruleMembership.hitCount,12);assert.equal(r.canViewBlockingOrders,false);assert.equal(r.coverage.complete,false);const a=r.rows.find(x=>x.reason==='总打码倍数小于配置倍数');assert.equal(a.count,5);assert.deepEqual(r.rows.filter(x=>x.reason==='检测没备注').map(x=>x.noteState).sort(),['present','unknown']);const v=await scalar(db,'select private.dashboard_admin_live_withdraw_reasons($1)v',[{...req,kind:'blockingVariants',reasonKey:a.reasonKey}]);assert.equal(v.rows.reduce((a,b)=>a+b.count,0),5);assert.equal((await scalar(db,'select snapshot v from public.withdraw_reasons_daily')).groups.length,5);}finally{await db.close();}});
test('zero-row index still requires a valid overlap contract whenever available',async()=>{const db=await setup();try{await db.exec('delete from public.newar_detail_records');const p=await scalar(db,'select private.withdraw_reason_newar_all($1,$2,$3)v',[q,{mode:'all',countries:[]},native]);assert.equal(p.available,false);assert.equal(await scalar(db,'select private.withdraw_reason_newar_index_valid($1)v',[p]),true);p.available=true;p.noteCount=0;assert.equal(await scalar(db,'select private.withdraw_reason_newar_index_valid($1)v',[p]),false);p.summary.ruleMembership={unit:'distinct_order_per_rule',overlapping:true,hitCount:0};assert.equal(await scalar(db,'select private.withdraw_reason_newar_index_valid($1)v',[p]),true);p.summary.ruleMembership.hitCount=1;assert.equal(await scalar(db,'select private.withdraw_reason_newar_index_valid($1)v',[p]),false);}finally{await db.close();}});
