const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');

// Load the fixture that runs real report SQL against synthetic source receipts.
const previousFile = path.join(__dirname, 'withdraw-npg-current-window.test.cjs');
const fixture = new Function('require', '__dirname', fs.readFileSync(previousFile, 'utf8').split(/\ntest\(/)[0]
  + '; return {setup,h,q,scope};')(createRequire(previousFile), __dirname);
const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const install = read('supabase/migrations/20261113090437_withdraw_npg_created_day.sql');
const rollback = read('supabase/maintenance/withdraw-npg-created-day.rollback.sql');

async function setup() {
  const f = await fixture.setup();
  // Apply the actual October YASH change to both renderers used by NPG serving.
  await f.db.exec(read('tests/fixtures/duoli-daily-fallback/sql/dashboard_admin_live_auto_withdraw.sql'));
  await f.db.exec(read('tests/fixtures/yash-auto-review/withdraw_prepared_dependency.before.sql'));
  await f.db.exec('revoke all on function private.dashboard_admin_live_auto_withdraw(jsonb) from public,anon,authenticated,service_role; grant execute on function private.dashboard_admin_live_auto_withdraw(jsonb) to authenticated;');
  await f.db.exec(read('supabase/maintenance/yash-auto-review.install.sql'));
  return f;
}

test('single NPG country loads the verified creation day from the prewarmed legacy country shell with the exact requested DTO', async () => {
  const f = await setup();
  try {
    const request = fixture.q({country:'哥伦比亚',platforms:['NPG-COLOMBIA'],includeSecondary:false});
    const {includeSecondary, ...oldRequest} = request;
    const {h} = fixture;
    await h.report('2026-10-19',197,150,'CO','NPG-COLOMBIA');
    await h.report('2026-10-20',222,166,'CO','NPG-COLOMBIA');
    const t = await h.template(oldRequest);
    const publication = async () => f.value("select jsonb_build_array((select count(*) from private.withdraw_prepared_jobs),(select jsonb_agg(to_jsonb(a)) from private.withdraw_prepared_artifacts a),(select jsonb_agg(to_jsonb(h)) from private.withdraw_prepared_heads h),private.withdraw_prepared_dependency())v");
    const before = await publication();
    assert.equal(await f.helper(request),null);
    await f.db.exec(install);
    const exact = await f.value('select private.withdraw_prepared_canonical($1)v',[request]);
    const expectedBundle = await f.value('select private.withdraw_prepared_compute($1,$2,$3)v',[exact,fixture.scope,[]]);
    const expected = await f.direct(request,{r:exact,payload:expectedBundle});
    const {prepared,...actual} = await h.call(request);
    assert.equal(prepared.generation,t.artifact);
    assert.deepEqual(actual,expected);
    assert.equal(actual.totals.total,222);
    assert.equal(actual.previousTotals.total,197);
    assert.equal(actual.secondary.state,'not_requested');
    assert.equal(actual.windows.includeSecondary,false);
    assert.deepEqual(await publication(),before);
    assert.equal(await f.helper({...request,successBasis:'source_updated'}),null);
    assert.equal(await f.helper({...request,account:'ANOTHER'}),null);
    assert.equal(await f.helper({...request,successStartAt:'2026-10-18T12:00:00.000Z'}),null);
    assert.equal(await f.helper({...request,platforms:['OTHER']}),null);
    await f.db.exec('alter table private.withdraw_prepared_artifacts disable trigger withdraw_prepared_immutable');
    await f.db.query("update private.withdraw_prepared_artifacts set payload=jsonb_set(payload,'{secondary,state}','\"unexpected\"'::jsonb) where id=$1", [t.artifact]);
    assert.equal(await f.helper(request),null);
    await f.db.query('update private.withdraw_prepared_artifacts set payload=$1 where id=$2',[t.payload,t.artifact]);
    await f.db.exec('alter table private.withdraw_prepared_artifacts enable trigger withdraw_prepared_immutable');
    await f.db.query("delete from private.npg_summary_receipts where country_code='CO' and stat_date='2026-10-20'");
    const missing=await h.call(request);
    assert.equal(missing.npgCoverage.currentComplete,false);
    assert.equal(missing.npgCoverage.previousComplete,true);
    const {prepared:missingPublication,...missingData}=missing;
    assert.deepEqual(missingData,await f.direct(request,{r:exact,payload:expectedBundle}));
    assert.equal(missingPublication.generation,t.artifact);
    const renderDef=await f.value("select pg_get_functiondef('private.withdraw_prepared_render(jsonb,jsonb)'::regprocedure)v");
    await f.db.exec(renderDef.replace(/AS (\$\w*\$)/,'AS $1\n-- synthetic later version'));
    assert.equal(await f.helper(request),null);
    await f.db.exec(renderDef);
    assert.equal(await f.value("select has_function_privilege('authenticated','private.dashboard_withdraw_npg_template_read(jsonb,jsonb,jsonb,jsonb,text)','EXECUTE')v"),false);
    await f.db.query("select set_config('test.scope',$1,false)",[JSON.stringify({mode:'selected',countries:['哥伦比亚']})]);
    const otherScope=await h.call(request);
    assert.notEqual(otherScope.prepared.generation,t.artifact);
    assert.equal(otherScope.rows,null);
    await f.db.query("select set_config('test.scope',$1,false)",[JSON.stringify(fixture.scope)]);
    await f.db.exec(rollback);
    assert.equal(await f.helper(request),null);
    assert.equal((await publication())[1][0].id,t.artifact);
  } finally {await f.db.close();}
});
