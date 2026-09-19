const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const fs=require('node:fs');
const {loadTs,root}=require('./load-typescript.cjs');
const q=loadTs(path.join(root,'src/lib/orderTimeQuery.ts'));
const base={platform:'00000000-0000-0000-0000-000000000001',basis:'success',start:'2026-09-18T00:00:00',end:'2026-09-18T23:59:59',direction:'all',createdStart:'',createdEnd:''};
test('India wall clock does not use computer timezone and inclusive end includes fractions',()=>{
  const result=q.orderTimeRequest(base);
  assert.equal(result.p_start_at,'2026-09-17T18:30:00.000Z');
  assert.equal(result.p_end_at,'2026-09-18T18:30:00.000Z');
  assert.equal(result.p_created_start,null);
  assert.throws(()=>q.indiaInstant('2026-02-30T00:00:00'));
  assert.throws(()=>q.orderTimeRequest({...base,end:'2026-09-17T00:00:00'}));
  assert.throws(()=>q.orderTimeRequest({...base,start:'2026-08-01T00:00:00'}));
});
test('creation limits independent of completion interval; cleared in created mode',()=>{
  const result=q.orderTimeRequest({...base,createdStart:'2026-09-01T00:00:00',createdEnd:'2026-09-17T23:59:59'});
  assert.equal(result.p_start_at,'2026-09-17T18:30:00.000Z');
  assert.equal(result.p_created_start,'2026-08-31T18:30:00.000Z');
  assert.equal(q.orderTimeRequest({...base,basis:'created',createdStart:'2026-09-01T00:00:00'}).p_created_start,null);
});
test('provider amounts and counts stay distinct across creation cohorts',()=>{
  const rows=[{direction:'charge',provider:'A',success_amount:100,success_count:1,cross_day_amount:100,cross_day_count:1},
    {direction:'charge',provider:'A',success_amount:200,success_count:2,cross_day_amount:0,cross_day_count:0},
    {direction:'withdraw',provider:'A',success_amount:80,success_count:1,actual_amount:78,withdraw_fee:2}];
  const groups=q.orderTimeGroups(rows);
  assert.equal(groups.length,2);assert.equal(groups[0].success_amount,300);assert.equal(groups[0].success_count,3);
  assert.equal(groups[0].cross_day_count,1);assert.equal(groups[1].actual_amount,78);
});

test('SQL returns earlier-created successes, exact time windows, scoped platforms and correct money',async()=>{
  const {PGlite}=require('@electric-sql/pglite');
  const db=new PGlite();
  try{
    await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function public.dashboard_has_permission(text) returns boolean language sql as $$select current_setting('test.allowed',true)='yes'$$;
      create function private.dashboard_current_data_scope() returns jsonb language sql as $$select '{}'::jsonb$$;
      create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select $3='EK7'$$;
      create table game66_platforms(id uuid primary key,platform_name text,team_name text,team_code text);
      create table game66_charge_orders(id uuid primary key default gen_random_uuid(),platform_id uuid,uid text,order_num text,out_trade_no text,pay_time timestamptz,create_time timestamptz,status_code text,status_text text,pay_method_name text,pay_mode text,amount_display numeric,amount_minor numeric,last_seen_at timestamptz);
      create table game66_withdraw_orders(id uuid primary key default gen_random_uuid(),platform_id uuid,uid text,order_num text,out_trade_no text,update_time timestamptz,create_time timestamptz,status_code text,status_text text,pay_channel text,pay_method_name text,payout_mode text,amount_display numeric,amount_minor numeric,real_amount_display numeric,real_amount_minor numeric,fee_display numeric,fee_minor numeric,last_seen_at timestamptz);
      insert into game66_platforms values('${base.platform}','EK7','香港','hong_kong'),('00000000-0000-0000-0000-000000000002','66GAME','红膏蟹','red_crab');
      set test.uid='10000000-0000-0000-0000-000000000001';set test.allowed='yes';`);
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260919083628_order_time_query.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260919085244_order_time_details.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260919095550_order_time_reference_start.sql'),'utf8'));
    const signatures=(await db.query("select n.nspname,proname,pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace where proname in ('dashboard_order_time_query','dashboard_order_time_details') order by n.nspname,proname")).rows;
    assert.deepEqual(signatures.map(r=>Number(r.pronargs)),[15,12,15,12], 'only one signature per schema/RPC; no ambiguous overloads and detail API is unchanged');
    const charge=[['2026-09-17T10:00:00+05:30','2026-09-18T10:00:00+05:30','1',100],
      ['2026-09-18T10:00:00+05:30','2026-09-18T23:59:59.999+05:30','1',200],
      ['2026-09-16T10:00:00+05:30','2026-09-17T10:00:00+05:30','1',300],
      ['2026-09-18T10:00:00+05:30',null,'0',400],
      ['2026-08-30T10:00:00+05:30','2026-09-18T11:00:00+05:30','1',50]];
    for(const [i,[created,paid,status,amount]] of charge.entries())await db.query(`insert into game66_charge_orders(platform_id,pay_time,create_time,status_code,pay_method_name,pay_mode,amount_display,amount_minor,last_seen_at,uid,order_num,out_trade_no) values($1,$2,$3,$4,'PayA','UPI',$5::numeric,$5::numeric*100,now(),$6,$7,$8)`,[base.platform,paid,created,status,amount,i===1?'1':'00123',`ORDER-${i}`,`THIRD-${i}`]);
    await db.query(`insert into game66_withdraw_orders(platform_id,update_time,create_time,status_code,pay_channel,payout_mode,amount_display,amount_minor,real_amount_display,real_amount_minor,fee_display,fee_minor,last_seen_at,uid,order_num,out_trade_no) values($1,'2026-09-18T10:00:00+05:30','2026-09-17T10:00:00+05:30','3','PayB','BANK',80,8000,78,7800,2,200,now(),'00123','WITHDRAW-0','WTHIRD-0'),($1,null,'2026-09-18T10:00:00+05:30','1','PayB','BANK',90,9000,88,8800,2,200,now(),'00123','WITHDRAW-1','WTHIRD-1')`,[base.platform]);
    function params(filters){const r=q.orderTimeRequest(filters);return [r.p_platform,r.p_start_at,r.p_end_at,r.p_basis,r.p_direction,r.p_created_start,r.p_created_end];}
    async function query(filters,extra={}){return (await db.query('select public.dashboard_order_time_query($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as data',[...params(filters),extra.member??null,extra.order??null,extra.status??'all',extra.crossDay??false])).rows[0].data;}
    async function referenceQuery(filters,reference,extra={}){return (await db.query('select public.dashboard_order_time_query($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as data',[...params(filters),extra.member??null,extra.order??null,extra.status??'all',extra.crossDay??false,reference])).rows[0].data;}
    async function details(filters,extra={}){return (await db.query('select public.dashboard_order_time_details($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as data',[...params(filters),extra.providers??null,extra.types??null,extra.cursor??null,extra.limit??50,extra.member??null,extra.order??null,extra.status??'all',extra.crossDay??false])).rows[0].data;}
    let payload=await query(base);assert.equal(payload.platforms.length,1);
    let sums=q.timeTotals(payload.rows.filter(r=>r.direction==='charge'));
    assert.equal(sums.success_amount,350);assert.equal(sums.success_count,3);assert.equal(sums.cross_day_amount,150);
    sums=q.timeTotals(payload.rows.filter(r=>r.direction==='withdraw'));
    assert.equal(sums.success_amount,80);assert.equal(sums.actual_amount,78);assert.equal(sums.withdraw_fee,2);
    payload=await query({...base,basis:'created'});sums=q.timeTotals(payload.rows.filter(r=>r.direction==='charge'));
    assert.equal(sums.submitted_count,2);assert.equal(sums.success_count,1);assert.equal(sums.success_amount,200);
    assert.equal(sums.pending_count,1);assert.equal(sums.pending_amount,400);
    assert.equal(q.timeTotals(payload.rows.filter(r=>r.direction==='withdraw')).pending_count,1);
    payload=await query({...base,createdStart:'2026-09-01T00:00:00',createdEnd:'2026-09-17T23:59:59'});
    assert.equal(q.timeTotals(payload.rows.filter(r=>r.direction==='charge')).success_amount,100);
    payload=await query({...base,start:'2026-09-18T10:00:00',end:'2026-09-18T10:59:59'});
    assert.equal(q.timeTotals(payload.rows.filter(r=>r.direction==='charge')).success_amount,100);
    payload=await query(base,{member:' 00123 '});
    assert.equal(q.timeTotals(payload.rows).success_amount,230, 'UID exact text preserves leading zeros');
    assert.equal((await query(base,{member:'123'})).rows.length,0);
    assert.equal(q.timeTotals((await query(base,{member:'1'})).rows).success_amount,200);
    for(const order of ['ORDER-0',' THIRD-0 '])assert.equal(q.timeTotals((await query(base,{order})).rows).success_amount,100);
    assert.equal((await query(base,{order:'ORDER-'})).rows.length,0,'order match is exact, never prefix/wildcard');
    payload=await query(base,{crossDay:true});
    assert.equal(q.timeTotals(payload.rows).success_count,3);assert.equal(q.timeTotals(payload.rows).success_amount,230);
    assert.equal((await query(base,{status:'pending'})).rows.length,0,'success-time axis cannot include pending orders');
    payload=await query({...base,basis:'created'},{status:'pending'});
    assert.equal(q.timeTotals(payload.rows).submitted_amount,490);assert.equal(q.timeTotals(payload.rows).success_count,0);

    let page=await details(base,{member:'00123',limit:2});
    assert.equal(page.rows.length,2);assert.equal(page.hasMore,true);
    assert.ok(page.rows.every(r=>r.member_id==='00123'&&r.cross_day===true&&r.status_group==='success'));
    assert.ok(page.rows.every(r=>r.third_party_order_number));
    assert.ok(page.rows.every(r=>!('raw_payload' in r)&&!('bank_account' in r)&&!('phone' in r)));
    const firstIds=page.rows.map(r=>r.id);
    const page2=await details(base,{member:'00123',cursor:page.nextCursor,limit:2});
    assert.equal(page2.rows.length,1);assert.equal(page2.hasMore,false);assert.equal(page2.nextCursor,null);
    assert.ok(page2.rows.every(r=>!firstIds.includes(r.id)), 'equal timestamps in different directions do not repeat');
    assert.equal((await details(base,{order:'WTHIRD-0'})).rows[0].actual_amount,78);
    assert.equal((await details(base,{order:'WTHIRD-0'})).rows[0].withdraw_fee,2);
    assert.equal((await details(base,{order:'ORDER-0'})).rows[0].actual_amount,null,'collection has no withdrawal amount');
    assert.equal((await details(base,{providers:['PayB'],types:['BANK']})).rows.length,1);
    assert.equal((await details(base,{providers:['PayB'],types:['UPI']})).rows.length,0);
    assert.equal((await details(base,{crossDay:true})).rows.length,3);
    const pendingPage=await details({...base,basis:'created'},{status:'pending'});
    assert.equal(pendingPage.rows.length,2);assert.ok(pendingPage.rows.every(r=>!r.cross_day&&!r.succeeded));
    await db.query(`insert into game66_withdraw_orders(platform_id,create_time,status_code,amount_display,uid,order_num) values($1,'2026-09-18T10:00:00+05:30','2',13,'00123','FAIL'),($1,'2026-09-18T10:00:00+05:30','-1',17,'00123','REJECT'),($1,'2026-09-18T10:00:00+05:30','future',19,'00123','UNKNOWN')`,[base.platform]);
    for(const [status,amount] of [['failed',13],['rejected',17],['unknown',19]]){
      const filtered=await query({...base,basis:'created'},{status});
      assert.equal(q.timeTotals(filtered.rows).submitted_amount,amount);
      assert.equal(q.timeTotals(filtered.rows).success_amount,0);
      const detail=await details({...base,basis:'created'},{status});
      assert.equal(detail.rows.length,1);assert.equal(detail.rows[0].status_group,status);
    }

    // Legacy eleven-argument calls remain byte-for-byte equivalent to an
    // explicit null/reference equal to start. No PostgREST overload survives.
    assert.deepEqual(await referenceQuery(base,null),await query(base));
    assert.deepEqual(await referenceQuery(base,q.indiaInstant(base.start)),await query(base));
    const fullRange={...base,start:'2026-09-17T00:00:00'};
    const reference=q.indiaInstant(fullRange.start);
    const slices=[['2026-09-17T00:00:00','2026-09-17T23:59:59'],
      ['2026-09-18T00:00:00','2026-09-18T11:59:59'],['2026-09-18T12:00:00','2026-09-18T23:59:59']];
    const slicedRows=[],legacySliceRows=[];
    for(const [start,end] of slices){
      slicedRows.push(...(await referenceQuery({...base,start,end},reference)).rows);
      legacySliceRows.push(...(await query({...base,start,end})).rows);
    }
    const whole=q.timeTotals((await query(fullRange)).rows),sliced=q.timeTotals(slicedRows);
    assert.deepEqual(sliced,whole,'three day/hour slices retain every aggregate metric using the global reference');
    assert.equal(whole.earlier_count,2);assert.equal(whole.earlier_amount,350);
    assert.equal(whole.cross_day_count,4);assert.equal(whole.cross_day_amount,530);
    assert.ok(q.timeTotals(legacySliceRows).earlier_count>whole.earlier_count,'slice-local starts would falsely count later-in-range creation as earlier');
    const filteredSlices=[];
    for(const [start,end] of slices)filteredSlices.push(...(await referenceQuery({...base,start,end},reference,{member:' 00123 '})).rows);
    assert.deepEqual(q.timeTotals(filteredSlices),q.timeTotals((await query(fullRange,{member:'00123'})).rows),'leading-zero member identity remains exact across slices');
    assert.equal((await referenceQuery(base,reference,{member:'123'})).rows.length,0);
    assert.equal(q.timeTotals((await referenceQuery(base,reference,{order:' THIRD-0 '})).rows).success_amount,100);
    assert.equal(q.timeTotals((await referenceQuery({...base,basis:'created'},reference)).rows).earlier_count,0,'reference does not broaden creation filters');
    await assert.rejects(()=>referenceQuery(base,'infinity'),/范围无效/);
    await assert.rejects(()=>referenceQuery(base,'-infinity'),/范围无效/);
    await assert.rejects(()=>referenceQuery(base,'2026-09-18T00:00:01+05:30'),/范围无效/,'reference cannot be after the slice start');
    await assert.rejects(()=>referenceQuery(base,'2026-08-01T00:00:00+05:30'),/范围无效/,'whole selected range remains bounded to31days');
    await assert.rejects(()=>query(base,{status:'anything'}),/范围无效/);
    await assert.rejects(()=>details(base,{status:'anything'}),/无效查询/);
    await assert.rejects(()=>details(base,{limit:201}),/无效查询/);
    await assert.rejects(()=>details(base,{cursor:{at:'not-a-date',direction:'charge',id:firstIds[0]}}),/无效分页/);
    await assert.rejects(()=>details(base,{cursor:{at:'infinity',direction:'charge',id:firstIds[0]}}),/无效分页/);
    await assert.rejects(()=>details(base,{cursor:{at:base.start,direction:'charge',id:'bad-uuid'}}),/无效分页/);
    await assert.rejects(()=>query({...base,platform:'00000000-0000-0000-0000-000000000002'}),/无权查看/);
    await assert.rejects(()=>referenceQuery({...base,platform:'00000000-0000-0000-0000-000000000002'},reference),/无权查看/);
    await assert.rejects(()=>details({...base,platform:'00000000-0000-0000-0000-000000000002'}),/无权查看/);
    const privileges=(await db.query("select has_function_privilege('anon','public.dashboard_order_time_query(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text,text,text,boolean,timestamptz)','execute') as anon,has_function_privilege('authenticated','public.dashboard_order_time_details(uuid,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text[],text[],jsonb,integer,text,text,text,boolean)','execute') as authenticated")).rows[0];
    assert.equal(privileges.anon,false);assert.equal(privileges.authenticated,true);
    await db.exec("set test.allowed='no'");await assert.rejects(()=>query(base),/没有三方查询权限/);
    await assert.rejects(()=>referenceQuery(base,reference),/没有三方查询权限/);
    await assert.rejects(()=>details(base),/没有三方查询权限/);
    await db.exec("set test.uid=''");await assert.rejects(()=>query(base),/请先登录/);
    await assert.rejects(()=>referenceQuery(base,reference),/请先登录/);
    await assert.rejects(()=>details(base),/请先登录/);
  }finally{await db.close();}
});
