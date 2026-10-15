const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {readerFixture} = require('./fixtures/maan-submission-auth-rpc-harness.cjs');
const {readArtifact} = require('./fixtures/maan-submission-projection-harness.cjs');
const baseline = readArtifact('reader-candidate.sql');
const install = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015044337_maan_submission_proven_summary_reader.sql'), 'utf8');
const fragment = install.slice(install.indexOf('do $install$'), install.lastIndexOf('commit;'));
const [anchor, replacement] = install.match(/definition:=replace\(definition,\$anchor\$([\s\S]*?)\$anchor\$,\$replacement\$([\s\S]*?)\$replacement\$\);/).slice(1);
assert.equal(baseline.split(anchor).length, 2);
const candidate = baseline.replace(anchor, replacement);
let comparisons = 0;
async function compare(f, queries, projected = true) {
  await f.db.exec("begin isolation level repeatable read;set local statement_timeout='3s';set local lock_timeout='1s';set local timezone='UTC';set local search_path=''");
  try {
    await f.db.exec(baseline);
    const expected = [];
    for (const q of queries) expected.push(await f.call(q));
    await f.db.exec(fragment);
    for (let i = 0; i < queries.length; i++) {
      assert.deepEqual(await f.call(queries[i]), expected[i], JSON.stringify(queries[i]));
      comparisons++;
    }
    if (projected !== null) assert.equal((await f.capture(queries[0])).projected, projected);
    return expected;
  } finally { await f.db.exec('rollback'); }
}
async function seedMixed(f) {
  for (const member of ['VALID','PAID','PRIOR','LATER','UNKNOWN','DUP','0001','1','RAW','BAD','EMPTY','FUNDED']) await f.seedMaan(member);
  for (const n of [10,11,15,16,20,21,30,31,50,51,100,101]) await f.seedMaan('THRESHOLD'+n,n);
  await f.seedMaan('NEXT',20,{day:'2026-10-11'});
  await f.db.exec(`
    update newar_detail_records set status_group='success',success_at='2026-10-10T14:00:00+05:30' where source_id='PAID-20';
    update newar_detail_records set status_group='success',success_at='2026-10-11T14:00:00+05:30' where source_id='LATER-20';
    update newar_detail_records set status_group='unknown',provider='Unselected' where source_id='UNKNOWN-20';
    update newar_detail_records set order_number='DUPLICATE' where member_id='DUP';
    update newar_detail_records set raw='{"memberLevel":"L0","rechargeCount":"0"}' where member_id='RAW';
    update newar_detail_records set raw='{"rechargeLevel":{},"rechargeCount":-1}' where member_id='BAD';
    update newar_detail_records set raw='{"rechargeLevel":"","memberLevel":"LV0","rechargeCount":null}' where member_id='EMPTY';
    update newar_detail_records set raw='{"rechargeLevel":"LV1","rechargeCount":5}' where member_id='FUNDED';
    insert into newar_detail_records(platform,dataset,source_id,order_number,member_id,provider,currency,amount,status_group,created_at,success_at,raw,captured_at) values
    ('MAANWIN','charge','OLDPAID','OLDPAID','PRIOR','Unselected','USD',1,'success','2026-10-09T10:00:00+05:30','2026-10-10T14:00:00+05:30','{}',now()),
    ('MAANWIN','charge','NO-MEMBER','',null,'Unselected','INR',0,'unknown','2026-10-10T00:00:00+05:30',null,'{}',now()),
    ('MAANWIN','charge','RIGHTBOUND','R','VALID','route-a','INR',0,'pending','2026-10-11T00:00:00+05:30',null,'{}',now());
  `);
  await f.approve();
}
test('MAAN charts=false uses proved compact facts and preserves the entire authenticated DTO across thresholds, filters, cohorts and money', async () => {
  const f = await readerFixture();
  try {
    await seedMixed(f);
    const qs = [];
    for (const threshold of [10,15,20,30,50,100]) for (const providers of [undefined, ['CombinedPay'], ['Other Pay'], ['ABSENT'], []]) {
      for (const window of [{}, {startAt:'2026-10-10T00:00:01+05:30',endAt:'2026-10-10T00:00:07+05:30'}, {endAt:'2026-10-12T00:00:00+05:30'}]) {
        qs.push({charts:false,threshold,...(providers===undefined?{}:{providers}),...window});
      }
    }
    qs.push({charts:false,amountBands:{charge:[0,100,200,300,400,500,1000,2000,5000,10000,50000]}});
    const old = await compare(f,qs);
    assert.equal(old[0].dashboard,null);
    assert.equal(old[0].coverage.sourceCompletenessVerified,false);
    assert(old[0].coverage.orderSequenceUncertainCount>0);
    await f.db.exec(candidate);
    assert.equal((await f.capture({charts:false})).projected,true);
    await assert.rejects(()=>f.call({charts:false,currency:'USD'}),/invalid_currency/);
    for (const launch of ['2026-10-10T00:00:05+05:30',null]) {
      await f.db.query('update newar_detail_platforms set launch_at=$1 where platform=$2',[launch,'MAANWIN']);
      await compare(f,[{charts:false},{charts:false,providers:['CombinedPay']}]);
    }
  } finally { await f.close(); }
});
test('MAAN summary proof and metadata failures still fall back without misreporting a complete zero', async () => {
  const f = await readerFixture();
  try {
    await seedMixed(f);
    const states = [
      "delete from private.maan_submission_ready where data_date='2026-10-10'",
      'alter table newar_detail_records alter column created_at drop not null',
      'alter table newar_detail_records alter column amount drop not null',
      'alter table private.maan_submission_facts disable row level security',
      'alter function private.maan_submission_generation() strict',
      'alter function private.maan_submission_can_read(date,date) security definer',
      'alter function private.verify_maan_submission_hour(date,integer) strict',
      'grant execute on function private.maan_submission_generation() to authenticated',
      "update private.maan_submission_facts set amount=999 where source_id='VALID-1'",
      "alter table newar_detail_records alter column amount drop not null;alter table newar_detail_records disable trigger user;update newar_detail_records set amount=null where source_id='VALID-1'",
    ];
    for (const state of states) {
      await f.db.exec('begin');
      try {
        await f.db.exec(state);
        await f.db.exec(baseline);
        const old = await f.call({charts:false});
        await f.db.exec(candidate);
        assert.equal((await f.capture({charts:false})).projected,false,state);
        assert.deepEqual(await f.call({charts:false}),old,state);
        comparisons++;
      } finally { await f.db.exec('rollback'); }
    }
    for (const zone of ['Asia/Calcutta','UTC','Europe/Berlin']) {
      await f.db.query('update fixture_platforms set timezone=$1 where id=$2',[zone,f.f.ids.newar]);
      await compare(f,[{charts:false},{charts:false,startAt:'2026-10-10T04:30:02Z',endAt:'2026-10-10T04:30:03Z'}],zone==='Asia/Calcutta');
    }
    await f.db.query("update fixture_platforms set timezone='Asia/Kolkata',scope_group='PK',country='巴基斯坦'where id=$1",[f.f.ids.newar]);
    await compare(f,[{charts:false}],false);
    await f.db.query("update fixture_platforms set scope_group='IN',country='印度',source_name='OTHER'where id=$1",[f.f.ids.newar]);
    await compare(f,[{charts:false}],false);
  } finally { await f.close(); }
});
test('MAAN empty, future-proved and unverified days retain their original coverage contract', async () => {
  const f = await readerFixture();
  try {
    await compare(f,[{charts:false}],false);
    await f.approve();
    await compare(f,[{charts:false},{charts:false,endAt:'2026-10-11T12:00:00+05:30'}]);
    await f.seedMaan('FUTURE',21,{day:'2026-10-14'});
    await compare(f,[{charts:false,startAt:'2026-10-14T00:00:00+05:30',endAt:'2026-10-15T00:00:00+05:30'}]);
    await f.db.exec(candidate);
    const empty=await f.call({charts:false});
    assert.equal(empty.coverage.orderCount,0);
    assert.equal(empty.coverage.sourceCompletenessVerified,false);
  } finally { await f.close(); }
});
test('charts, member operations, other platforms, native authorization and 91 kernels are unchanged', async () => {
  const f = await readerFixture();
  try {
    await seedMixed(f);
    await compare(f,[{charts:true},{charts:true,providers:['CombinedPay']}]);
    await compare(f,['all','new','funded','unknown','l0'].map(level=>({charts:false,operation:'members',level})),false);
    await compare(f,['VALID','PAID','PRIOR','LATER','UNKNOWN','DUP'].map(memberId=>({charts:false,operation:'memberOrders',memberId,day:'2026-10-10',limit:100})),false);
    await f.seed('NATIVE',20);
    await f.db.exec("begin isolation level repeatable read;select private.approve_ar_91club_submission_day('2026-10-10');select private.approve_ar_91club_submission_day('2026-10-11');select private.approve_ar_91club_submission_null();select private.approve_ar_91club_submission_future();commit");
    await compare(f,[{platformId:f.f.ids.ar,charts:false},{platformId:f.f.ids.ar,charts:true}],false);
    await f.db.exec(candidate);
    assert.equal((await f.capture({platformId:f.f.ids.ar,charts:false})).facts91,true);
    for (const kind of ['lg','game','yash']) await f.seedOther(kind,'OTHER');
    await f.receipts();
    for(const [platformId,zone,currency] of [[f.f.ids.lg,'+08:00','PHP'],[f.f.ids.game,'+05:30','INR'],[f.yash,'+05:30','INR']]) {
      await compare(f,[{platformId,currency,charts:false,startAt:'2026-10-02T00:00:00'+zone,endAt:'2026-10-03T00:00:00'+zone}],false);
    }
    await f.db.exec(candidate);
    await f.f.as(f.f.viewer);
    await assert.rejects(()=>f.call({charts:false}),/platform_denied/);
    await assert.rejects(()=>f.call({platformId:f.f.ids.hidden,charts:false}),/platform_denied/);
    await f.f.as(f.f.owner);
    for (const role of ['anon','service_role']) {
      await f.db.exec('set role '+role);
      await assert.rejects(()=>f.db.query('select private.dashboard_admin_live_submission_analysis($1::jsonb)',[JSON.stringify(f.f.request({...f.base,charts:false}))]),/permission denied/);
      await f.db.exec('reset role');
    }
  } finally { await f.close(); }
});
test('summary installer changes one selector, is idempotent, preserves full metadata and rejects drift atomically', async () => {
  const f = await readerFixture();
  const sig='private.dashboard_admin_live_submission_analysis(jsonb)';
  try {
    await f.db.exec(readArtifact('stage3-install.sql'));
    const original=(await f.db.query("select md5(prosrc) h,to_jsonb(p)-'prosrc' m from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
    assert.equal(original.h,'cd7a262ccf7398acd43d5c18d43e627a');
    await f.db.exec(install);
    await f.db.exec(install);
    const after=(await f.db.query("select md5(prosrc) h,to_jsonb(p)-'prosrc' m from pg_proc p where oid=$1::regprocedure",[sig])).rows[0];
    assert.equal(after.h,'3a8012390d65b3a698c749bee099d0d0');
    assert.deepEqual(after.m,original.m);
    assert.equal(candidate.replace(replacement,anchor),baseline);
    for (const state of ["alter function "+sig+" set jit=on",'grant execute on function '+sig+' to anon', 'alter function '+sig+' strict']) {
      await f.db.exec("begin;set local search_path=''");
      await f.db.exec(state);
      await assert.rejects(()=>f.db.exec(fragment),/metadata_drift/);
      await f.db.exec('rollback');
    }
    await f.db.exec('begin');
    await f.db.exec(baseline.replace('perform private.dashboard_admin_live_scope();','perform private.dashboard_admin_live_scope(); -- unknown'));
    await f.db.exec("set local search_path=''");
    await assert.rejects(()=>f.db.exec(fragment),/definition_drift/);
    await f.db.exec('rollback');
    const def=(await f.db.query('select pg_get_functiondef($1::regprocedure)d',[sig])).rows[0].d;
    await f.db.exec(def.replace(replacement,anchor));
    assert.equal((await f.db.query('select md5(prosrc) h from pg_proc where oid=$1::regprocedure',[sig])).rows[0].h,original.h);
    console.log(JSON.stringify({fullAuthenticatedDtoComparisons:comparisons,before:original.h,after:after.h,productionExecuted:false}));
  } finally { await f.close(); }
});
