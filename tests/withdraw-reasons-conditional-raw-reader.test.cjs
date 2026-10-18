// Synthetic source labels and sessions only; no production data, SQL calls or secrets.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{test}=require('node:test');
const repo=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(repo,'supabase/operations',f),'utf8');
const {setup,ar,newar}=require('./fixtures/withdraw-reasons-query-harness.cjs');
test('reason access-plan repairs preserve complete JSON/precision/nulls and caller settings',async()=>{
 const db=await setup();try{
  await db.exec('revoke all on function private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)from public,anon,authenticated,service_role');
  for(const [i,label]of ['棋牌有效投注1000>阈值100','真人视讯有效投注2000>阈值200','体育有效投注3000>阈值300',null].entries())await ar.add(db,'AR-PLAN-'+i,'Synthetic_manual',{applied_at:'2026-10-17 12:00:00',completed_at:null,manual_remark:label,amount:'999999999999999.12345678'});
  const ids=[];for(const [i,label]of [null,'Unknown raw','体育有效投注3000>阈值300','棋牌有效投注1000>阈值100'].entries())ids.push(await newar.order(db,'NEWAR-PLAN-'+i,label,{platform:'MAANWIN',created:'2026-10-17T01:00:00Z',captured:'2026-10-18T00:00:00Z',handled:null,raw:{sourceSubmittedAt:null},amount:'999999999999999.12345678'}));
  await db.query('update private.newar_withdraw_reason_facts set source_label=null where record_id=$1',[ids[1]]);
  await db.query("update private.newar_withdraw_reason_facts set received_at=received_at-interval'1second'where record_id=$1",[ids[2]]);
  await db.query('delete from private.newar_withdraw_reason_facts where record_id=$1',[ids[3]]);
  await db.exec('create temp table oracle(q jsonb,d jsonb,t text)');
  for(const platform of ['91CLUB','MAAN.WIN']){
   const q={country:'印度',platform,date:'2026-10-17',kind:'blocking',offset:0,limit:20};
   const result=(await db.query('select public.dashboard_admin_live_withdraw_reasons($1)r',[q])).rows[0].r;
   const requests=[q,{...q,date:'2026-10-16'}];for(const row of result.rows)requests.push({...q,kind:'blockingOrders',reasonKey:row.reasonKey});
   for(const r of requests)await db.query('insert into oracle select $1,d,d::text from(select public.dashboard_admin_live_withdraw_reasons($1)d)x',[r]);
  }
  const snapshot=()=>db.query("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p))m from pg_proc p where oid in('private.dashboard_admin_live_withdraw_reasons(jsonb)'::regprocedure,'private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)'::regprocedure)").then(r=>r.rows[0].m);
  const baseline=await snapshot();await db.exec(read('withdraw-reasons-conditional-raw-reader.sql'));
  await db.exec(read('withdraw-reasons-function-custom-plan.sql'));
  await db.exec(read('withdraw-reasons-narrow-note-projection.sql'));
  const match=(await db.query('select count(*)n,bool_and(d=public.dashboard_admin_live_withdraw_reasons(q))j,bool_and(t=public.dashboard_admin_live_withdraw_reasons(q)::text)t from oracle')).rows[0];assert(match.n>=10&&match.j&&match.t);
  for(const mode of ['auto','force_generic_plan']){
   await db.exec('set plan_cache_mode='+mode);
   for(const platform of ['91CLUB','MAAN.WIN']){
    const q={country:'印度',platform,date:'2026-10-17',kind:'blocking',offset:0,limit:20};
    const r=(await db.query('select public.dashboard_admin_live_withdraw_reasons($1)r',[q])).rows[0].r;assert(r.available&&r.rows.length);
    await assert.rejects(db.query('select public.dashboard_admin_live_withdraw_reasons($1)',[{...q,limit:21}]),e=>e.code==='22023');
    assert.equal((await db.query("select current_setting('plan_cache_mode')m")).rows[0].m,mode);
   }
  }
  await db.exec('set plan_cache_mode=auto');
  await db.exec(read('withdraw-reasons-narrow-note-projection.rollback.sql'));
  await db.exec(read('withdraw-reasons-function-custom-plan.rollback.sql'));
  await db.exec(read('withdraw-reasons-conditional-raw-reader.rollback.sql'));
  assert.deepEqual(await snapshot(),baseline);
 }finally{await db.close()}
});
