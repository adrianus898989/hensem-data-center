const assert = require('node:assert/strict');
const {test,before,after} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const {loadTs,root} = require('./load-typescript.cjs');
const edge = loadTs(path.join(root,'BACKEND_CURRENT/workorder-issue-ingest.ts'));
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const migration = read('supabase/migrations/20260919164345_workorder_issue_92blaze_scope.sql');
const baseline = read('tests/fixtures/workorder_issue_live_validators.sql');
const publisher = read('tests/fixtures/workorder_issue_live_publisher.sql');
const scopes = [
  {country_code:'PK',platform:'POPZAR',timezone:'Asia/Karachi'},
  {country_code:'IN',platform:'DhaniWin',timezone:'Asia/Kolkata'},
  {country_code:'PK',platform:'92BLAZE',timezone:'Asia/Karachi'},
];
const token = 'a'.repeat(64), limited = 'b'.repeat(64);
const now = new Date('2026-09-23T01:00:00Z');
const metrics = {submitted_count:2,submitted_amount:50,success_count:1,success_amount:20,
  withdraw_not_received_count:2,withdraw_not_received_amount:70,withdraw_success_count:1,withdraw_success_amount:30};
const clone = x => JSON.parse(JSON.stringify(x));
function snapshot(platform='92BLAZE',date='2026-09-22',at='2026-09-23T00:00:00Z') {
  const scope = scopes.find(x=>x.platform===platform);
  return {schema_version:1,source_system:'AR_WORKORDER',...scope,country:scope.country_code==='PK'?'巴基斯坦':'印度',
    stat_date:date,snapshot_id:randomUUID(),snapshot_at:at,
    coverage:{complete:true,expected_count:5,fetched_count:5,unique_count:5,target_count:4,ignored_count:1,unmapped_count:0},
    totals:{...metrics},groups:[{third_party:'SamplePay',channel_type:'EWALLET',...metrics,
      status_counts:{'存款/待处理':1,'存款/已处理':1,'提款/处理中':1,'提款/已处理':1}}]};
}
let db;
const sqlValidate = async s => db.query('select public.workorder_issue_assert_snapshot($1)',[s]);
const sqlScopes = async s => (await db.query('select public.workorder_issue_scopes_are_allowed($1) ok',[s])).rows[0].ok;
const publish = async (s,t=token) => (await db.query('select public.publish_workorder_issue_snapshot($1,$2) ack',[t,s])).rows[0].ack;
// Only the test database's clock is substituted. Production migration always uses clock_timestamp().
const testClock = sql => sql.replaceAll('pg_catalog.clock_timestamp()','public.test_clock()');
before(async()=>{
  db = new PGlite();
  await db.exec(`create function public.test_clock() returns timestamptz language sql as $$select current_setting('test.now')::timestamptz$$;`);
  await db.query("select set_config('test.now',$1,false)",[now.toISOString()]);
  await db.exec(testClock(baseline));
  await db.exec(`
    create table public.workorder_issue_credentials (
      token_hash text primary key, source_system text not null check(source_system='AR_WORKORDER'),
      allowed_source_systems text[] not null default array['AR_WORKORDER'] check(cardinality(allowed_source_systems)=1 and allowed_source_systems=array['AR_WORKORDER']),
      allowed_scopes jsonb not null check(public.workorder_issue_scopes_are_allowed(allowed_scopes)),
      expires_at timestamptz not null, revoked boolean not null default false);
    create table public.workorder_issue_snapshot_receipts(snapshot_id uuid primary key,payload_hash text not null);
    create table public.workorder_issue_snapshot_heads (
      source_system text not null check(source_system='AR_WORKORDER'),country_code text not null,platform text not null,
      timezone text not null,stat_date date not null,current_snapshot_id uuid not null references public.workorder_issue_snapshot_receipts,
      snapshot_at timestamptz not null,updated_at timestamptz not null default now(),
      primary key(source_system,country_code,platform,stat_date),
      constraint workorder_issue_snapshot_heads_check check(
        (country_code='PK' and platform='POPZAR' and timezone='Asia/Karachi') or
        (country_code='IN' and platform='DhaniWin' and timezone='Asia/Kolkata')));
    create table public.workorder_deposit_daily (
      system_name text not null,source_system text not null,stat_date date not null,country_code text not null,
      country text not null,platform text not null,third_party text not null,channel_type text not null,
      submitted_count bigint not null,submitted_amount numeric(24,2) not null,success_count bigint not null,success_amount numeric(24,2) not null,
      withdraw_not_received_count bigint not null,withdraw_not_received_amount numeric(24,2) not null,
      withdraw_success_count bigint not null,withdraw_success_amount numeric(24,2) not null,status_counts jsonb not null,
      source_updated_at timestamptz not null,updated_at timestamptz not null,
      primary key(system_name,stat_date,country_code,platform,third_party,channel_type));
  `);
  await db.exec(testClock(publisher));
  assert.equal(await sqlScopes(scopes),false,'live baseline rejects 3 scopes');
  assert.equal(await sqlScopes([scopes[2]]),false,'live baseline rejects 92 alone');
  await assert.rejects(()=>sqlValidate(snapshot()),/WOI_INVALID_SCOPE/);
  await db.exec(testClock(migration));
  await db.query("insert into public.workorder_issue_credentials(token_hash,source_system,allowed_scopes,expires_at) values($1,'AR_WORKORDER',$2,'2026-10-01'),($3,'AR_WORKORDER',$4,'2026-10-01')",[token,scopes,limited,[scopes[0]]]);
});
after(async()=>{if(db) await db.close();});
test('exact 3 tuples pass SQL and Edge, including all existing subsets',async()=>{
  for(let mask=1;mask<8;mask++){
    const selected=scopes.filter((_,i)=>mask&(1<<i));assert.equal(await sqlScopes(selected),true);
    assert.ok(selected.every(edge.allowedWorkorderIssueScope));
  }
  for(const s of scopes) {const body=snapshot(s.platform);edge.validateWorkorderIssueSnapshot(body,now);await sqlValidate(body);}
});
test('scope expansion stays closed to duplicates, extra keys, wrong casing/country/timezone and fourth platforms',async()=>{
  const invalid=[[],null,{},[null],[{...scopes[2],country_code:'IN'}],[{...scopes[2],platform:'92Blaze'}],
    [{...scopes[2],timezone:'UTC'}],[{...scopes[2],extra:true}],[{...scopes[2],platform:'OTHER'}],[{...scopes[2],platform:['92BLAZE']}],
    [scopes[2],scopes[2]],[...scopes,scopes[2]]];
  for(const value of invalid)assert.equal(await sqlScopes(value),false);
  for(const value of invalid.filter(x=>Array.isArray(x)&&x.length===1))assert.equal(edge.allowedWorkorderIssueScope(value[0]),false);
});
test('first 92 complete report is September 23 for September 22; no prior-day or early activation',async()=>{
  for(const date of ['2026-09-01','2026-09-21']){
    const s=snapshot('92BLAZE',date);assert.throws(()=>edge.validateWorkorderIssueSnapshot(s,now),/launch/);
    await assert.rejects(()=>sqlValidate(s),/WOI_INVALID_LAUNCH_DATE/);
  }
  const first=snapshot();edge.validateWorkorderIssueSnapshot(first,now);await sqlValidate(first);
  const opening=new Date('2026-09-21T19:00:00Z');
  const early=snapshot('92BLAZE','2026-09-22',opening.toISOString());
  assert.throws(()=>edge.validateWorkorderIssueSnapshot(early,opening),/incomplete_day/);
  await db.query("select set_config('test.now',$1,false)",[opening.toISOString()]);
  try{await assert.rejects(()=>sqlValidate(early),/WOI_INVALID_DATE/);}finally{await db.query("select set_config('test.now',$1,false)",[now.toISOString()]);}
  // Old platform history remains valid even before the new platform opening date.
  for(const platform of ['POPZAR','DhaniWin'])await sqlValidate(edge.validateWorkorderIssueSnapshot(snapshot(platform,'2026-09-01'),now));
});
test('source and canonical country remain AR_WORKORDER/AR, never reclassified as NEWAR',async()=>{
  for(const source of ['NEWAR','NEW_AR','WORKORDER']){
    const s={...snapshot(),source_system:source};assert.throws(()=>edge.validateWorkorderIssueSnapshot(s,now));await assert.rejects(()=>sqlValidate(s),/WOI_INVALID_SCOPE/);
  }
  const s=snapshot();assert.equal((await publish(s)).status,'accepted');
  const row=(await db.query("select system_name,source_system,country,country_code,platform,submitted_count::int,withdraw_not_received_count::int from public.workorder_deposit_daily where platform='92BLAZE'")).rows[0];
  assert.deepEqual(row,{system_name:'AR',source_system:'AR_WORKORDER',country:'巴基斯坦',country_code:'PK',platform:'92BLAZE',submitted_count:2,withdraw_not_received_count:2});
});
test('existing publisher accepts 3 platforms through table CHECK and exact replay does not add counts',async()=>{
  for(const scope of scopes){
    const s=snapshot(scope.platform,'2026-09-22','2026-09-23T00:01:00Z');
    assert.equal((await publish(s)).status,'accepted');assert.equal((await publish(s)).status,'unchanged');
    s.groups[0].third_party='ChangedPay';await assert.rejects(()=>publish(s),/WOI_ID_CONFLICT/);
  }
  assert.equal((await db.query('select count(*)::int n from public.workorder_deposit_daily')).rows[0].n,3);
  assert.equal((await db.query('select sum(submitted_count)::int n from public.workorder_deposit_daily')).rows[0].n,6);
});
test('authorization still blocks a POPZAR-only credential from 92, and revoked keys',async()=>{
  await assert.rejects(()=>publish(snapshot(),limited),/WOI_SCOPE_DENIED/);
  await db.query('update public.workorder_issue_credentials set revoked=true where token_hash=$1',[limited]);
  await assert.rejects(()=>publish(snapshot('POPZAR'),limited),/WOI_AUTH_INVALID/);
});
test('92 stale snapshot cannot overwrite; complete empty day clears only exact source/platform scope',async()=>{
  assert.equal((await publish(snapshot())).status,'stale');
  const empty=snapshot('92BLAZE','2026-09-22','2026-09-23T00:02:00Z');empty.groups=[];
  empty.totals=Object.fromEntries(Object.keys(metrics).map(k=>[k,0]));
  for(const k of Object.keys(empty.coverage))if(k!=='complete')empty.coverage[k]=0;
  edge.validateWorkorderIssueSnapshot(empty,now);assert.equal((await publish(empty)).status,'accepted');
  assert.deepEqual((await db.query('select platform from public.workorder_deposit_daily order by platform')).rows.map(r=>r.platform),['DhaniWin','POPZAR']);
});
test('existing coverage, groups, amounts, status counts and PII rejection are unchanged',async()=>{
  for(const mutate of [s=>s.country='印度',s=>s.timezone='UTC',s=>s.coverage.complete=false,s=>s.coverage.unique_count=4,
    s=>s.coverage.unmapped_count=1,s=>s.totals.success_count=3,s=>s.groups[0].status_counts['存款/已处理']=2,
    s=>s.groups.push(clone(s.groups[0])),s=>s.groups[0].third_party='member_id 123456789',s=>s.groups[0].submitted_amount=-1,
    s=>s.customer_name='private',s=>s.groups[0].account='private']){
    const s=snapshot();mutate(s);assert.throws(()=>edge.validateWorkorderIssueSnapshot(s,now));await assert.rejects(()=>sqlValidate(s));
  }
});
test('table heads CHECK still rejects unauthorized exact tuples independent of snapshot validator',async()=>{
  const id=randomUUID();await db.query('insert into public.workorder_issue_snapshot_receipts values($1,$2)',[id,'a'.repeat(64)]);
  for(const scope of [{...scopes[2],country_code:'IN'},{...scopes[2],timezone:'UTC'},{...scopes[2],platform:'OTHER'}])
    await assert.rejects(()=>db.query("insert into public.workorder_issue_snapshot_heads(source_system,country_code,platform,timezone,stat_date,current_snapshot_id,snapshot_at) values('AR_WORKORDER',$1,$2,$3,'2026-09-22',$4,'2026-09-23')",[scope.country_code,scope.platform,scope.timezone,id]),/workorder_issue_snapshot_heads_check/);
});
function handlerWith(credential,fetchLog=[]){
  return edge.createWorkorderIssueHandler({env:{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server-key'},now:()=>now,
    fetch:async(url,options)=>{fetchLog.push({url,options});
      if(url.includes('workorder_issue_credentials?'))return Response.json([credential]);
      const body=JSON.parse(options.body);return Response.json({ok:true,status:'accepted',snapshot_id:body.p_snapshot.snapshot_id,current_snapshot_id:body.p_snapshot.snapshot_id});}});
}
const request = body => new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json','X-Workorder-Issue-Key':'k'.repeat(32)},body:JSON.stringify(body)});
const credential = () => ({source_system:'AR_WORKORDER',allowed_source_systems:['AR_WORKORDER'],allowed_scopes:clone(scopes),expires_at:'2026-10-01T00:00:00Z',revoked:false});
test('Edge routes 92 through original scoped publisher with dedicated hash, preserves all metrics',async()=>{
  const calls=[],s=snapshot();const response=await handlerWith(credential(),calls)(request({action:'ingest',snapshot:s}));assert.equal(response.status,200);
  assert.equal(calls.length,2);assert.match(calls[0].url,/token_hash=eq\.[a-f0-9]{64}/);
  assert.ok(calls[1].url.endsWith('/rpc/publish_workorder_issue_snapshot'));
  const body=JSON.parse(calls[1].options.body);assert.deepEqual(body.p_snapshot,s);assert.equal(body.p_token_hash.length,64);
  assert.ok(!JSON.stringify(calls).includes('k'.repeat(32)));assert.equal(calls[1].options.redirect,'error');
});
test('Edge credentials cannot broaden source, duplicate scope or authorize fourth platform',async()=>{
  for(const mutate of [c=>c.allowed_source_systems.push('NEWAR'),c=>c.allowed_scopes.push(scopes[2]),
    c=>c.allowed_scopes=[{...scopes[2],platform:'OTHER'}],c=>c.allowed_scopes=[{...scopes[2],extra:true}],c=>c.revoked=true]){
    const c=credential();mutate(c);assert.equal((await handlerWith(c)(request({action:'check'}))).status,401);
  }
  const c=credential();c.allowed_scopes=[scopes[0]];
  assert.equal((await handlerWith(c)(request({action:'ingest',snapshot:snapshot()}))).status,403);
  const check=await handlerWith(credential())(request({action:'check'}));assert.deepEqual(await check.json(),{ok:true,source_system:'AR_WORKORDER',scope_count:3});
});
test('migration leaves publisher, credentials, source checks, ACL and RLS unchanged; Edge deploy mirrors tested code',()=>{
  assert.ok(!/create or replace function public\.publish_workorder_issue_snapshot/i.test(migration));
  assert.ok(!/\b(insert into|update|delete from)\s+public\.workorder_issue_credentials/i.test(migration));
  assert.ok(!/\b(grant|revoke|policy|disable row level|security definer)\b/i.test(migration));
  assert.ok(!migration.includes('public.test_clock()'));
  const deploy=read('supabase/functions/workorder-issue-ingest/index.ts');
  assert.ok(deploy.includes(read('BACKEND_CURRENT/workorder-issue-ingest.ts').trim()));
});
