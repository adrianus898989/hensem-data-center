const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261006065254_maan_workorder_head_identity.sql'),'utf8');
const beforeHash='1e4e6ddac7b2a5fa3e41c03082673c4d';
const afterHash='364c8fe11ea369b8ea74cdd1358f9288';
async function fixture(run){
  const db=new PGlite();
  try {
    await db.exec(`
      create role service_role;
      create role authenticated;
      create table public.workorder_issue_snapshot_heads(
        source_system text not null,country_code text not null,platform text not null,
        timezone text not null,stat_date date not null,current_snapshot_id uuid not null,
        snapshot_at timestamptz not null,updated_at timestamptz not null,
        constraint workorder_issue_snapshot_heads_check check (
          (country_code='PK' and platform in ('POPZAR','92BLAZE') and timezone='Asia/Karachi')
          or (country_code='IN' and platform='DhaniWin' and timezone='Asia/Kolkata')));
      alter table public.workorder_issue_snapshot_heads enable row level security;
      alter table public.workorder_issue_snapshot_heads force row level security;
      grant select,insert,update on public.workorder_issue_snapshot_heads to service_role;
      create policy deny_authenticated on public.workorder_issue_snapshot_heads
        for select to authenticated using(false);
    `);
    await run(db);
  } finally {await db.close()}
}
async function insert(db,country,platform,timezone){
  await db.query(`insert into public.workorder_issue_snapshot_heads values
    ('AR_WORKORDER',$1,$2,$3,'2026-10-06','11111111-1111-4111-8111-111111111111',
     '2026-10-07T00:00:00Z','2026-10-07T00:00:00Z')`,[country,platform,timezone]);
}
async function metadata(db){
  return (await db.query(`select c.oid,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,
    (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p
      where p.schemaname='public' and p.tablename='workorder_issue_snapshot_heads') policies
    from pg_class c where c.oid='public.workorder_issue_snapshot_heads'::regclass`)).rows;
}
async function check(db){
  return (await db.query(`select oid,convalidated,md5(pg_get_constraintdef(oid)) hash
    from pg_constraint where conrelid='public.workorder_issue_snapshot_heads'::regclass
      and conname='workorder_issue_snapshot_heads_check'`)).rows[0];
}

test('MAAN canonical head is admitted without rewriting existing heads or access controls',()=>fixture(async db=>{
  assert.equal((await check(db)).hash,beforeHash);
  await insert(db,'PK','POPZAR','Asia/Karachi');
  await insert(db,'PK','92BLAZE','Asia/Karachi');
  await insert(db,'IN','DhaniWin','Asia/Kolkata');
  await assert.rejects(()=>insert(db,'IN','MAANWIN','Asia/Kolkata'),/workorder_issue_snapshot_heads_check/);
  const security=await metadata(db);
  const oldRows=(await db.query('select * from public.workorder_issue_snapshot_heads order by platform')).rows;
  await db.exec(migration);
  assert.deepEqual(await metadata(db),security);
  assert.deepEqual((await db.query('select * from public.workorder_issue_snapshot_heads order by platform')).rows,oldRows);
  await insert(db,'IN','MAANWIN','Asia/Kolkata');
  assert.equal((await check(db)).hash,afterHash);
  assert.equal((await check(db)).convalidated,true);
  assert.equal((await db.query('select count(*)::int n from public.workorder_issue_snapshot_heads')).rows[0].n,4);
  const first=await check(db);
  await db.exec(migration);
  assert.deepEqual(await check(db),first,'reapplying keeps the same validated constraint identity');
  assert.deepEqual(await metadata(db),security);
}));

test('only the canonical India MAAN scope is added; aliases, foreign scopes and unrelated platforms remain rejected',()=>fixture(async db=>{
  await db.exec(migration);
  const accepted=new Set(['PK|POPZAR|Asia/Karachi','PK|92BLAZE|Asia/Karachi','IN|DhaniWin|Asia/Kolkata','IN|MAANWIN|Asia/Kolkata']);
  for(const country of ['IN','PK','VN'])
    for(const platform of ['POPZAR','92BLAZE','DhaniWin','MAANWIN','MAAN.WIN','MaanWin','92NOVA','OTHER'])
      for(const zone of ['Asia/Kolkata','Asia/Karachi','UTC']){
        const action=()=>insert(db,country,platform,zone);
        if(accepted.has([country,platform,zone].join('|'))) await action();
        else await assert.rejects(action,/workorder_issue_snapshot_heads_check/);
      }
  await assert.rejects(()=>insert(db,'IN',null,'Asia/Kolkata'),/not-null constraint/);
}));

test('unexpected or missing baseline constraints fail closed',()=>fixture(async db=>{
  await db.exec('alter table public.workorder_issue_snapshot_heads drop constraint workorder_issue_snapshot_heads_check');
  await assert.rejects(()=>db.exec(migration),/MAAN_WORKORDER_HEAD_CHECK_DRIFT/);
  await db.exec('rollback');
  await db.exec(`alter table public.workorder_issue_snapshot_heads add constraint workorder_issue_snapshot_heads_check check (country_code='IN')`);
  const before=await check(db);
  await assert.rejects(()=>db.exec(migration),/MAAN_WORKORDER_HEAD_CHECK_DRIFT/);
  await db.exec('rollback');
  assert.deepEqual(await check(db),before);
}));

test('an unvalidated baseline is not silently accepted or replaced',()=>fixture(async db=>{
  await db.exec(`alter table public.workorder_issue_snapshot_heads drop constraint workorder_issue_snapshot_heads_check;
    alter table public.workorder_issue_snapshot_heads add constraint workorder_issue_snapshot_heads_check check (
      (country_code='PK' and platform in ('POPZAR','92BLAZE') and timezone='Asia/Karachi')
      or (country_code='IN' and platform='DhaniWin' and timezone='Asia/Kolkata')) not valid;`);
  const before=await check(db);
  await assert.rejects(()=>db.exec(migration),/MAAN_WORKORDER_HEAD_CHECK_DRIFT/);
  await db.exec('rollback');
  assert.deepEqual(await check(db),before);
}));
