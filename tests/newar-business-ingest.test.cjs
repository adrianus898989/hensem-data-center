const assert=require('node:assert/strict');
const {test,before,after}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs,root}=require('./load-typescript.cjs');
const edge=loadTs(path.join(root,'BACKEND_CURRENT/newar-business-ingest.ts'));
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/newar_business_payloads.json'),'utf8'));
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260919162721_newar_business_snapshots.sql'),'utf8');
const token='a'.repeat(64),otherToken='b'.repeat(64),at='2026-09-19T01:00:00Z',now=Date.parse('2026-09-19T05:00:00Z');
let db;
const clone=v=>JSON.parse(JSON.stringify(v));
const batch=(kind='auto_withdraw_bundle',extra={})=>({action:'ingest',kind,platform:'POPZAR',batch_id:randomUUID(),captured_at:at,payload:clone(fixtures[kind]),...extra});
const ingest=async(b,t=token)=>(await db.query('select public.ingest_newar_business_batch($1,$2) as result',[t,b])).rows[0].result;
const read=async(kind='auto_withdraw_bundle',start='2026-09-01',end='2026-09-30',country='')=>(await db.query('select public.dashboard_newar_business_snapshots($1,$2,$3,$4) as result',[kind,start,end,country])).rows[0].result;
async function identity(uid='10000000-0000-0000-0000-000000000001',permission='all'){await db.query("select set_config('test.uid',$1,false),set_config('test.permission',$2,false)",[uid,permission]);}
before(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
    grant usage on schema auth,private to authenticated;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function public.dashboard_has_permission(text) returns boolean language sql as $$select case current_setting('test.permission',true) when 'null' then null else current_setting('test.permission',true) in ('all',$1) end$$;
    create function private.dashboard_current_data_scope() returns jsonb language sql as $$select '{}'::jsonb$$;
    create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql as $$select $2='PK' and $3='POPZAR'$$;`);
  await db.exec(migration);
  const scopes=['POPZAR','DhaniWin','92BLAZE'].flatMap(platform=>Object.keys(fixtures).map(kind=>({platform,kind})));
  await db.query(`insert into private.newar_business_credentials(token_hash,allowed_scopes,expires_at) values($1,$2,now()+interval '1 day'),($3,'[{"platform":"DhaniWin","kind":"auto_withdraw_bundle"}]',now()+interval '1 day')`,[token,scopes,otherToken]);
  await identity();
});
after(async()=>{if(db)await db.close();});
test('all original synthetic business fixture fields survive the Edge and atomic SQL path',async()=>{
  for(const kind of Object.keys(fixtures)){
    const b=batch(kind), safe=edge.validateNewarBusinessBatch(b,now), ack=await ingest(safe);
    assert.equal(ack.ok,true);assert.equal(ack.batch_id,b.batch_id);assert.equal(ack.platform,'POPZAR');assert.equal(ack.kind,kind);
    for(const field of edge.NEWAR_BUSINESS_FIELDS[kind])assert.equal(ack.counts[field],b.payload[field].length);
    const snapshots=(await read(kind)).snapshots;assert.equal(snapshots.length,1);
    for(const field of edge.NEWAR_BUSINESS_FIELDS[kind])assert.deepEqual(snapshots[0].payload[field],b.payload[field]);
    assert.equal(snapshots[0].country_code,'PK');assert.equal(snapshots[0].country,'巴基斯坦');
  }
});
test('Edge/SQL field whitelists agree for daily, operator, employee, type and mapping aliases',async()=>{
  for(const [kind,fields] of Object.entries(edge.NEWAR_BUSINESS_FIELDS))for(const field of fields){
    const sql=(await db.query('select private.newar_business_row_keys($1,$2) as keys',[kind,field])).rows[0].keys;
    assert.deepEqual(sql.sort(),edge.newarBusinessRowKeys(kind,field).sort());
  }
});
test('idempotent replay acknowledges exact counts and changed payload under same UUID is rejected',async()=>{
  const b=batch('auto_withdraw_bundle',{captured_at:'2026-09-19T01:10:00Z'});
  const first=await ingest(b),again=await ingest(b);assert.equal(first.status,'accepted');assert.equal(again.status,'unchanged');
  assert.deepEqual(first.counts,again.counts);
  b.payload.rows[0].total_count=4;await assert.rejects(()=>ingest(b),/BATCH_CONFLICT/);
  assert.equal((await read()).snapshots[0].payload.rows[0].total_count,3);
});
test('batch replay receipts are immutable and the ingest RPC is callable only through service role',async()=>{
  await assert.rejects(()=>db.query("update private.newar_business_batches set receipt='{}'"),/RECEIPT_IMMUTABLE/);
  await assert.rejects(()=>db.query('delete from private.newar_business_batches'),/RECEIPT_IMMUTABLE/);
  const b=batch('auto_withdraw_bundle',{captured_at:'2026-09-19T01:20:00Z'});
  await db.exec('set role service_role');
  try{assert.equal((await ingest(b)).ok,true);await assert.rejects(()=>db.query('select * from private.newar_business_credentials'),/permission denied/);}
  finally{await db.exec('reset role');}
});
test('late retries cannot revert newer data, equal timestamp conflicting bodies fail atomically',async()=>{
  const newer=batch('auto_withdraw_bundle',{captured_at:'2026-09-19T02:00:00Z'});newer.payload.rows[0].total_count=5;
  await ingest(newer);
  const old=batch('auto_withdraw_bundle',{captured_at:'2026-09-19T00:00:00Z'});assert.equal((await ingest(old)).status,'unchanged');
  assert.equal((await read()).snapshots[0].payload.rows[0].total_count,5);
  const equal=batch('auto_withdraw_bundle',{captured_at:newer.captured_at});await assert.rejects(()=>ingest(equal),/SNAPSHOT_CONFLICT/);
});
test('operator-only repair preserves daily totals and component clocks prevent later stale operator rollback',async()=>{
  const repair=batch('auto_withdraw_bundle',{captured_at:'2026-09-19T03:00:00Z'});repair.payload.rows=[];repair.payload.operator_rows[0].processed_count=7;
  await ingest(repair);
  let row=(await read()).snapshots[0];assert.equal(row.payload.rows[0].total_count,5);assert.equal(row.payload.operator_rows[0].processed_count,7);
  const middle=batch('auto_withdraw_bundle',{captured_at:'2026-09-19T02:30:00Z'});middle.payload.rows[0].total_count=6;
  await ingest(middle);row=(await read()).snapshots[0];assert.equal(row.payload.rows[0].total_count,6);assert.equal(row.payload.operator_rows[0].processed_count,7);
  const zero=batch('auto_withdraw_bundle',{captured_at:'2026-09-19T04:00:00Z'});zero.payload.rows[0].manual_count=0;zero.payload.operator_rows=[];
  await ingest(zero);assert.deepEqual((await read()).snapshots[0].payload.operator_rows,[]);
});
test('first operator-only day does not fabricate empty primary rows, and day scopes are separate',async()=>{
  const b=batch('auto_withdraw_bundle',{captured_at:'2026-09-19T04:00:00Z'});b.payload.rows=[];b.payload.operator_rows[0].stat_date='2026-09-17';
  await ingest(b);const row=(await read(undefined,'2026-09-17','2026-09-17')).snapshots[0];
  assert.equal('rows' in row.payload,false);assert.equal(row.payload.operator_rows.length,1);
});
test('third-party recharge/withdraw split and compatibility alias never add a duplicate row',async()=>{
  const b=batch('third_party_volume',{captured_at:'2026-09-19T04:00:00Z'});
  b.payload.rows.push({...b.payload.rows[0],biz_type:'withdraw',biz_label:'出款',type:'出款'});b.payload.third_party_rows=clone(b.payload.rows);
  const ack=await ingest(b);assert.equal(ack.counts.rows,2);
  const rows=(await read('third_party_volume')).snapshots;assert.deepEqual(rows.map(r=>r.direction).sort(),['charge','withdraw']);
  assert.ok(rows.every(r=>r.payload.rows.length===1&&r.payload.third_party_rows.length===1));
  assert.equal(rows.reduce((n,r)=>n+r.payload.rows.length,0),2);
});
test('invalid later row rejects whole batch without receipt or partial date writes',async()=>{
  const b=batch('auto_withdraw_bundle',{captured_at:'2026-09-19T04:10:00Z'});
  b.payload.rows[0].stat_date='2026-09-16';b.payload.operator_rows[0].stat_date='2026-09-16';
  b.payload.rows.push({...b.payload.rows[0],stat_date:'2026-09-15',total_count:-1});
  await assert.rejects(()=>ingest(b),/INVALID_NUMBER/);
  assert.equal((await read(undefined,'2026-09-15','2026-09-16')).snapshots.length,0);
  assert.equal((await db.query('select count(*)::int n from private.newar_business_batches where batch_id=$1',[b.batch_id])).rows[0].n,0);
});
test('credentials are platform/kind scoped, expiring/revocable, and checked again on replay',async()=>{
  const b=batch();await assert.rejects(()=>ingest(b,otherToken),/SCOPE_DENIED/);await assert.rejects(()=>ingest(b,'c'.repeat(64)),/AUTH_INVALID/);
  await db.query('update private.newar_business_credentials set revoked=true where token_hash=$1',[token]);
  await assert.rejects(()=>ingest(b),/AUTH_INVALID/);
  await db.query("update private.newar_business_credentials set revoked=false,expires_at=now()-interval '1 minute' where token_hash=$1",[token]);
  await assert.rejects(()=>ingest(b),/AUTH_INVALID/);
  await db.query("update private.newar_business_credentials set expires_at=now()+interval '1 day' where token_hash=$1",[token]);
});
test('viewer cannot read/write raw tables or ingest; RPC requires module and country/platform scope',async()=>{
  const dhani=batch('workorder_daily_bundle',{platform:'DhaniWin'});
  for(const f of edge.NEWAR_BUSINESS_FIELDS[dhani.kind])for(const r of dhani.payload[f]){r.platform='DhaniWin';r.country='印度';}
  await ingest(dhani);assert.ok((await read('workorder_daily_bundle')).snapshots.every(s=>s.platform==='POPZAR'));
  await db.exec('set role authenticated');
  try{assert.ok((await read()).snapshots.length);await assert.rejects(()=>ingest(batch()),/permission denied/);await assert.rejects(()=>db.query('select * from newar_business_snapshots'),/permission denied/);await assert.rejects(()=>db.query('select * from private.newar_business_credentials'),/permission denied/);}
  finally{await db.exec('reset role');}
  await db.exec('set role anon');try{await assert.rejects(()=>read(),/permission denied/);}finally{await db.exec('reset role');}
  for(const p of ['none','null','work_orders']){await identity(undefined,p);await assert.rejects(()=>read(),/没有查询权限/);}
  await identity('');await assert.rejects(()=>read(),/请先登录/);await identity();
  assert.equal((await read(undefined,undefined,undefined,'IN')).snapshots.length,0);
});
test('read bounds allow 366 days but reject wider/infinite/null dates and wrong kind',async()=>{
  assert.equal((await read(undefined,'2025-10-01','2026-09-30')).source,'newar_direct');
  for(const args of [['invalid'],[undefined,'2025-09-01','2026-09-30'],[undefined,'infinity','infinity'],[undefined,null,'2026-09-18'],[undefined,'2026-09-19','2026-09-18']]) await assert.rejects(()=>read(...args),/无效业务日期范围/);
});
test('92BLAZE rejects all prelaunch dates/captures and cannot be activated early via future captured_at',async()=>{
  const b=batch('auto_withdraw_bundle',{platform:'92BLAZE'});
  for(const field of edge.NEWAR_BUSINESS_FIELDS[b.kind])for(const r of b.payload[field])r.platform='92BLAZE';
  assert.throws(()=>edge.validateNewarBusinessBatch(b,now));await assert.rejects(()=>ingest(b),/LAUNCH/);
  b.captured_at='2026-09-22T00:00:00Z';for(const field of edge.NEWAR_BUSINESS_FIELDS[b.kind])for(const r of b.payload[field])r.stat_date='2026-09-22';
  assert.throws(()=>edge.validateNewarBusinessBatch(b,now));
  assert.equal(edge.validateNewarBusinessBatch(b,Date.parse('2026-09-22T01:00:00Z')).platform,'92BLAZE');
});
test('strict descriptors, finite numbers, duplicate rows, aliases and PII fields fail closed',async()=>{
  for(const mutate of [b=>b.payload.rows[0].password='secret',b=>b.payload.rows[0].total_count=1.5,b=>b.payload.rows[0].platform='DhaniWin',
    b=>b.payload.rows[0].country='印度',b=>b.payload.rows[0].stat_date='2026-02-30',b=>b.payload.rows.push(clone(b.payload.rows[0])),
    b=>b.captured_at='2026-02-30T00:00:00Z',b=>b.snapshot_at='2026-09-18T00:00:00Z',b=>b.payload.extra='x']){
    const b=batch();mutate(b);assert.throws(()=>edge.validateNewarBusinessBatch(b,now));await assert.rejects(()=>ingest(b));
  }
  const badAlias=batch('third_party_volume');badAlias.payload.third_party_rows=[];assert.throws(()=>edge.validateNewarBusinessBatch(badAlias,now));await assert.rejects(()=>ingest(badAlias),/INVALID_PAYLOAD/);
  const infinity=batch();infinity.payload.rows[0].total_count=Infinity;assert.throws(()=>edge.validateNewarBusinessBatch(infinity,now));
});
test('workorder conversation/employee/type fields cannot silently disappear from an authoritative snapshot',async()=>{
  for(const field of ['rows','employee_rows','type_rows']){
    const b=batch('workorder_daily_bundle');delete b.payload[field][0].total_conversation_count;
    assert.throws(()=>edge.validateNewarBusinessBatch(b,now));await assert.rejects(()=>ingest(b),/WORKORDER_FIELDS/);
  }
});
test('Edge hashes dedicated key and verifies all four exact counts; returns sanitized acknowledgement',async()=>{
  const b=batch();let call;const expectedCounts={rows:1,operator_rows:1,employee_rows:0,type_rows:0};
  const deps={env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only'},now:()=>now,
    fetch:async(url,options)=>{call={url,options,body:JSON.parse(options.body)};return Response.json({ok:true,batch_id:b.batch_id,kind:b.kind,platform:b.platform,status:'accepted',counts:expectedCounts,operator_insert:0,operator_update:1,secret:'hidden'});}};
  const request=()=>new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json','X-Newar-Business-Key':'k'.repeat(32)},body:JSON.stringify(b)});
  const response=await edge.createNewarBusinessHandler(deps)(request());assert.equal(response.status,200);
  const ack=await response.json();assert.ok(!('secret' in ack));assert.equal(call.body.p_token_hash.length,64);
  assert.ok(!JSON.stringify(call.body).includes('k'.repeat(32)));assert.equal(call.options.redirect,'error');
  for(const overrides of [{platform:'Wrong'},{kind:'wrong'},{counts:{...expectedCounts,rows:2}},{operator_update:9}]){
    const handler=edge.createNewarBusinessHandler({...deps,fetch:async()=>Response.json({...ack,...overrides})});assert.equal((await handler(request())).status,503);
  }
});
test('Edge method/auth/stream size/DB errors do not leak credential or server payload',async()=>{
  const b=batch(),env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only'};
  const handler=edge.createNewarBusinessHandler({env,now:()=>now,fetch:async()=>Response.json({message:'NEWAR_BUSINESS_SCOPE_DENIED',details:'private'},{status:403})});
  assert.equal((await handler(new Request('https://edge.test'))).status,405);
  assert.equal((await handler(new Request('https://edge.test',{method:'POST'}))).status,401);
  const response=await handler(new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json','X-Newar-Business-Key':'k'.repeat(32)},body:JSON.stringify(b)}));
  assert.equal(response.status,403);assert.deepEqual(await response.json(),{ok:false,error:'scope_denied'});
  const oversized=await handler(new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json','X-Newar-Business-Key':'k'.repeat(32)},body:' '.repeat(2000001)}));assert.equal(oversized.status,413);
});
