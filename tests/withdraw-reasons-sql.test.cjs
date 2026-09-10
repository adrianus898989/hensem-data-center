// In-memory Postgres integration tests. No network or production configuration.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { PGlite } = require(process.env.PGLITE_PATH || "@electric-sql/pglite");
const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260910073836_withdraw_reasons_snapshots.sql"), "utf8");
const key = "a".repeat(64);

function makeSnapshot(overrides = {}) {
  return {
    schema_version: 1, source_system: "AR", country_code: "IN", platform: "SHREE.WIN", stat_date: "2026-01-01", timezone: "Asia/Kolkata",
    snapshot_id: randomUUID(), snapshot_at: new Date(Date.now() - 60000).toISOString(), classifier_version: "note-template-v1",
    coverage: { complete: true, expected_count: 2, fetched_count: 2, unique_count: 2, missing_order_ids: 0, note_header_found: true, incomplete_note_count: 0 },
    totals: { total: 2, auto: 1, manual: 1, unknown: 0, success: 1, reject: 1, other: 0 },
    groups: [
      { operator_class: "auto", reason_key: "1".repeat(64), reason_label: "自动成功", classification: "template", count: 1, success: 1, reject: 0, other: 0, samples: [] },
      { operator_class: "manual", reason_key: "2".repeat(64), reason_label: "人工驳回", classification: "template", count: 1, success: 0, reject: 1, other: 0, samples: [] },
    ], ...overrides,
  };
}

(async () => {
  const db = new PGlite();
  let checks = 0;
  const run = (sql, params = []) => db.query(sql, params);
  const scalar = async (sql, params = []) => Object.values((await run(sql, params)).rows[0])[0];
  const fail = async (sql, params, message) => {
    await assert.rejects(() => run(sql, params), error => error.message.includes(message)); checks++;
  };
  const publish = value => scalar("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify(value)]);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create function public.dashboard_has_permission(text) returns boolean language sql stable as $$ select coalesce(current_setting('test.auto_withdraw',true),'false') = 'true' $$;`);
    await db.exec(migration);
    checks++;
    const functions = (await run("select proname,prosecdef from pg_proc join pg_namespace ns on ns.oid=pronamespace where ns.nspname='public' and (proname like '%withdraw_reasons%')")).rows;
    assert.equal(functions.length, 4);
    assert(functions.every(fn => fn.prosecdef === false)); checks++;
    for (const role of ["anon", "authenticated"]) {
      assert.equal(await scalar("select has_function_privilege($1,'public.publish_withdraw_reasons_snapshot(text,jsonb)','execute')", [role]), false);
      assert.equal(await scalar("select has_function_privilege($1,'public.report_withdraw_reasons_snapshots(text,date,date,text[])','execute')", [role]), false);
      assert.equal(await scalar("select has_table_privilege($1,'public.withdraw_reasons_credentials','select')", [role]), false);
      assert.equal(await scalar("select has_table_privilege($1,'public.withdraw_reasons_snapshot_receipts','select')", [role]), false);
      assert.equal(await scalar("select has_table_privilege($1,'public.withdraw_reasons_daily','insert,update,delete')", [role]), false);
      checks++;
    }
    await db.exec("set role service_role");
    await run("insert into public.withdraw_reasons_credentials(token_hash,source_system,allowed_scopes,expires_at) values($1,'AR',$2::jsonb,now()+interval '1 day')", [key, JSON.stringify([{ country_code: "IN", platform: "SHREE.WIN" }])]);
    const first = makeSnapshot();
    assert.equal((await publish(first)).status, "accepted");
    assert.equal((await publish(first)).status, "unchanged"); checks++;
    const reordered = Object.fromEntries(Object.entries(first).reverse());
    const reorderedAck = await scalar("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify(reordered, null, 2)]);
    assert.equal(reorderedAck.status, "unchanged", "Whitespace and object key order do not change snapshot identity"); checks++;
    await fail("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify({ ...first, classifier_version: "changed" })], "WR_ID_CONFLICT");
    const second = structuredClone(first);
    second.snapshot_id = randomUUID();
    second.snapshot_at = new Date(Date.parse(first.snapshot_at) + 1000).toISOString();
    second.groups.forEach(group => { group.count *= 2; group.success *= 2; group.reject *= 2; });
    for (const name of Object.keys(second.totals)) second.totals[name] *= 2;
    for (const name of ["expected_count", "fetched_count", "unique_count"]) second.coverage[name] *= 2;
    assert.equal((await publish(second)).status, "accepted");
    assert.equal(Number(await scalar("select snapshot#>>'{totals,total}' from public.withdraw_reasons_daily")), 4, "Replacement must not add 2 + 4"); checks++;
    const replayOld = await publish(first);
    assert.equal(replayOld.status, "stale");
    assert.equal(replayOld.current_snapshot_id, second.snapshot_id); checks++;
    const sameTime = { ...second, snapshot_id: randomUUID() };
    assert.equal((await publish(sameTime)).status, "stale");
    assert.equal((await publish({ ...first, snapshot_id: randomUUID() })).status, "stale"); checks++;
    const corrupt = structuredClone(second); corrupt.snapshot_id = randomUUID(); corrupt.coverage.complete = false;
    await fail("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify(corrupt)], "WR_INVALID_COVERAGE");
    assert.equal(await scalar("select snapshot_id::text from public.withdraw_reasons_daily"), second.snapshot_id);
    assert.equal(await scalar("select count(*)::int from public.withdraw_reasons_snapshot_receipts where snapshot_id=$1", [corrupt.snapshot_id]), 0); checks++;
    const extra = { ...second, snapshot_id: randomUUID(), raw_customer: { should_not_store: true } };
    await fail("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify(extra)], "WR_INVALID_EXTRA_FIELDS");
    for (const field of ["coverage", "totals"]) {
      const nestedExtra = { ...first, snapshot_id: randomUUID(), [field]: { ...first[field], raw_customer: "must not store" } };
      await fail("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify(nestedExtra)], "WR_INVALID_EXTRA_FIELDS");
    }
    await fail("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify({ ...first, snapshot_id: randomUUID(), groups: [{ ...first.groups[0], bank_card: "must not store" }, first.groups[1]] })], "WR_INVALID_EXTRA_FIELDS");
    for (const patch of [{ source_system: "WG" }, { country_code: "VN" }, { platform: "OTHER" }]) {
      await fail("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify({ ...first, snapshot_id: randomUUID(), ...patch })], "WR_SCOPE_DENIED");
    }
    for (const patch of [
      { totals: { ...first.totals, manual: 0 } },
      { coverage: { ...first.coverage, fetched_count: 1 } },
      { coverage: { ...first.coverage, incomplete_note_count: 1 } },
      { stat_date: "2026-02-30" },
      { stat_date: "2999-01-01" },
      { snapshot_at: "2999-01-01T00:00:00Z" },
      { timezone: "invalid-timezone" },
      { groups: [{ ...first.groups[0], count: -1 }, first.groups[1]] },
      { groups: [{ ...first.groups[0], samples: ["x".repeat(501)] }, first.groups[1]] },
      { platform: " SHREE.WIN " },
      { groups: [{ ...first.groups[0], reason_label: " padded label " }, first.groups[1]] },
    ]) await fail("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify({ ...first, snapshot_id: randomUUID(), ...patch })], "WR_INVALID");
    await run("update public.withdraw_reasons_credentials set revoked=true where token_hash=$1", [key]);
    await fail("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify(first)], "WR_AUTH_INVALID");
    await run("update public.withdraw_reasons_credentials set revoked=false,expires_at=now()-interval '1 second' where token_hash=$1", [key]);
    await fail("select public.report_withdraw_reasons_snapshots($1,'2026-01-01','2026-01-31','{}')", [key], "WR_AUTH_INVALID");
    await run("update public.withdraw_reasons_credentials set expires_at=now()+interval '1 day' where token_hash=$1", [key]);
    await fail("select public.report_withdraw_reasons_snapshots($1,'2026-01-01','2026-02-01','{}')", [key], "WR_INVALID_REPORT");
    await fail("select public.report_withdraw_reasons_snapshots($1,'2026-01-01','2026-01-31',array['OTHER'])", [key], "WR_SCOPE_DENIED");
    const report = await scalar("select public.report_withdraw_reasons_snapshots($1,'2026-01-01','2026-01-31','{}')", [key]);
    assert.equal(report.snapshots.length, 1);
    assert.deepEqual(report.snapshots[0], second); checks++;

    await db.exec("reset role; set role anon");
    await fail("select * from public.withdraw_reasons_daily", [], "permission denied");
    await db.exec("reset role; set role authenticated; set test.auto_withdraw='false'");
    assert.equal(await scalar("select count(*)::int from public.withdraw_reasons_daily"), 0); checks++;
    await db.exec("set test.auto_withdraw='true'");
    assert.equal(await scalar("select count(*)::int from public.withdraw_reasons_daily"), 1); checks++;
    await fail("select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)", [key, JSON.stringify(first)], "permission denied");
    await fail("select * from public.withdraw_reasons_credentials", [], "permission denied");

    // Populate 40 platform scopes x 28 days with zero-order snapshots in two batched inserts.
    await db.exec("reset role; set role service_role");
    const platforms = Array.from({ length: 40 }, (_, i) => `P${String(i).padStart(2, "0")}`);
    const scopes = platforms.map(platform => ({ country_code: "IN", platform }));
    await run("insert into public.withdraw_reasons_credentials(token_hash,source_system,allowed_scopes,expires_at) values($1,'AR',$2::jsonb,now()+interval '1 day')", ["b".repeat(64), JSON.stringify(scopes)]);
    const emptyRows = platforms.flatMap(platform => Array.from({ length: 28 }, (_, i) => {
      const value = makeSnapshot({ platform, stat_date: `2026-01-${String(i + 1).padStart(2, "0")}`, groups: [], totals: { total: 0, auto: 0, manual: 0, unknown: 0, success: 0, reject: 0, other: 0 }, coverage: { complete: true, expected_count: 0, fetched_count: 0, unique_count: 0, missing_order_ids: 0, note_header_found: true, incomplete_note_count: 0 } });
      return { ...value, snapshot: value, payload_hash: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
    }));
    await run(`insert into public.withdraw_reasons_snapshot_receipts(snapshot_id,payload_hash,source_system,country_code,platform,stat_date)
      select snapshot_id,payload_hash,source_system,country_code,platform,stat_date from jsonb_to_recordset($1::jsonb)
      as x(snapshot_id uuid,payload_hash text,source_system text,country_code text,platform text,stat_date date)`, [JSON.stringify(emptyRows)]);
    await run(`insert into public.withdraw_reasons_daily(snapshot_id,source_system,country_code,platform,stat_date,snapshot_at,snapshot)
      select snapshot_id,source_system,country_code,platform,stat_date,snapshot_at,snapshot from jsonb_to_recordset($1::jsonb)
      as x(snapshot_id uuid,source_system text,country_code text,platform text,stat_date date,snapshot_at timestamptz,snapshot jsonb)`, [JSON.stringify(emptyRows)]);
    const largeReport = await scalar("select public.report_withdraw_reasons_snapshots($1,'2026-01-01','2026-01-31','{}')", ["b".repeat(64)]);
    assert.equal(largeReport.snapshots.length, 1120, "Aggregate report must not truncate at 1000 rows");
    assert(!largeReport.snapshots.some(value => value.platform === "SHREE.WIN"), "Report only returns exact credential scopes"); checks++;
    console.log(JSON.stringify({ result: "passed", checks, aggregateReportRows: largeReport.snapshots.length, database: "PGlite in-memory Postgres", productionAccess: false }, null, 2));
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
