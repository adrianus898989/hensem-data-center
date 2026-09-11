const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTs, root } = require("./load-typescript.cjs");
const { canReadWithdrawReasons, getAutoWithdrawReasons, validateReasonsDay, reasonPercent, reasonCountryCode, reasonSourceTarget } = loadTs(path.join(root, "src/lib/autoWithdrawReasonsClient.ts"));
const target = { country: "印度", platform: "TPPLAY", date: "2026-09-09" };
const session = { access_token: "test-session-token" };
function fixture() {
  const group = (operator_class, reason_key, classification, count, success, reject) => ({
    operator_class, reason_key, classification, reason_label: reason_key, count, success, reject, other: 0, samples: [],
  });
  return { source_system: "AR", country_code: "IN", platform: "TPPLAY", stat_date: target.date, updated_at: "2026-09-10T10:12:24Z",
    snapshot: { schema_version: 1, classifier_version: "note-template-v1", timezone: "Asia/Kolkata", snapshot_at: "2026-09-10T10:12:15Z",
      coverage: { complete: true, expected_count: 606, unique_count: 606, incomplete_note_count: 183 },
      totals: { total: 606, auto: 176, manual: 428, unknown: 2, success: 518, reject: 88, other: 0 },
      groups: [group("auto", "autoempty", "empty", 176, 176, 0), group("manual", "incomplete", "truncated", 183, 183, 0),
        group("manual", "empty", "empty", 4, 4, 0), group("manual", "reason", "template", 241, 153, 88), group("unknown", "unknown", "template", 2, 2, 0)],
    } };
}
async function withApi(respond, run) {
  const oldFetch = global.fetch;
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://reason-test.invalid/";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  const calls = [];
  global.fetch = async (url, options) => { const call = { url: new URL(url), options }; calls.push(call); assert.equal(call.url.origin, "https://reason-test.invalid"); return respond(call); };
  try { await run(calls); } finally {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey;
  }
}
test("one daily query preserves exact source/country/platform/date and uses authenticated read only", async () => {
  const controller = new AbortController();
  await withApi(({ url, options }) => {
    assert.equal(url.pathname, "/rest/v1/withdraw_reasons_daily_grouped");
    assert.equal(url.searchParams.get("source_system"), "eq.AR");
    assert.equal(url.searchParams.get("country_code"), "eq.IN");
    assert.equal(url.searchParams.get("stat_date"), "eq.2026-09-09");
    assert.equal(url.searchParams.get("platform"), "ilike.TPPLAY");
    assert.equal(url.searchParams.get("limit"), "2");
    assert.deepEqual(options.headers, { apikey: "public-test-key", Authorization: "Bearer test-session-token" });
    assert.equal(options.cache, "no-store"); assert.equal(options.signal, controller.signal);
    assert.equal(options.body, undefined); assert.equal(options.method, undefined);
    return Response.json([fixture()]);
  }, async calls => { assert.deepEqual(await getAutoWithdrawReasons(session, target, controller.signal), fixture()); assert.equal(calls.length, 1); });
});
test("zero rows means not collected, not fabricated zero totals", async () => {
  await withApi(() => Response.json([]), async () => assert.equal(await getAutoWithdrawReasons(session, target), null));
});
test("New AR platform routes are explicit and country-bound", () => {
  assert.deepEqual(reasonSourceTarget("PK", "popzar"), { source: "NEWAR", platform: "POPZAR" });
  for (const name of ["DhaniWin", "DHANI.WIN", "dhani.win"])
    assert.deepEqual(reasonSourceTarget("IN", name), { source: "NEWAR", platform: "DHANI.WIN" });
  for (const [country, name] of [["IN", "POPZAR"], ["PK", "DHANI.WIN"], ["IN", "DHANIWIN2"], ["IN", "TPPLAY"]])
    assert.deepEqual(reasonSourceTarget(country, name), { source: "AR", platform: name });
});
test("New AR queries use their own source and canonical platform without old-AR fallback", async () => {
  for (const [country, code, input, platform] of [["巴基斯坦", "PK", "POPZAR", "POPZAR"], ["印度", "IN", "DhaniWin", "DHANI.WIN"]]) {
    const data = { ...fixture(), source_system: "NEWAR", country_code: code, platform };
    await withApi(({ url }) => {
      assert.equal(url.searchParams.get("source_system"), "eq.NEWAR");
      assert.equal(url.searchParams.get("country_code"), `eq.${code}`);
      assert.equal(url.searchParams.get("platform"), `ilike.${platform}`);
      return Response.json([data]);
    }, async calls => {
      assert.deepEqual(await getAutoWithdrawReasons(session, { ...target, country, platform: input }), data);
      assert.equal(calls.length, 1);
    });
    await withApi(() => Response.json([{ ...data, source_system: "AR" }]), async () =>
      assert.rejects(getAutoWithdrawReasons(session, { ...target, country, platform: input }), /不匹配/));
    await withApi(() => Response.json([]), async calls => {
      assert.equal(await getAutoWithdrawReasons(session, { ...target, country, platform: input }), null);
      assert.equal(calls.length, 1);
    });
  }
});
test("case insensitive matching preserves platform punctuation", async () => {
  await withApi(({ url }) => { assert.equal(url.searchParams.get("platform"), "ilike.Shree.Win"); return Response.json([{ ...fixture(), platform: "SHREE.WIN" }]); },
    async () => assert.equal((await getAutoWithdrawReasons(session, { ...target, platform: "Shree.Win" })).platform, "SHREE.WIN"));
});
test("Panda source uses configured output labels only, with country isolation", () => {
  for (const name of ["776F", "SSS55", "PLAYER BR", "FF555", "5V555", "27FF", "222O"])
    assert.deepEqual(reasonSourceTarget("BR", name.toLowerCase()), { source: "PANDA", platform: name });
  assert.deepEqual(reasonSourceTarget("PH", "ph19"), { source: "PANDA", platform: "PH19" });
  for (const [country, name] of [["IN", "776F"], ["PH", "SSS55"], ["BR", "PH19"], ["BR", "POPOTHER"], ["BR", "PLAYERBR"], ["BR", "776F2"]])
    assert.deepEqual(reasonSourceTarget(country, name), { source: "AR", platform: name });
});
test("Panda Brazil, Fat Tiger Brazil and PH19 query only their own snapshots", async () => {
  for (const [country, code, platform] of [["巴西", "BR", "SSS55"], ["胖虎巴西", "BR", "776F"], ["菲律宾", "PH", "PH19"]]) {
    const data = { ...fixture(), source_system: "PANDA", country_code: code, platform };
    await withApi(({ url }) => {
      assert.equal(url.searchParams.get("source_system"), "eq.PANDA");
      assert.equal(url.searchParams.get("country_code"), `eq.${code}`);
      assert.equal(url.searchParams.get("platform"), `ilike.${platform}`);
      return Response.json([data]);
    }, async calls => {
      assert.deepEqual(await getAutoWithdrawReasons(session, { ...target, country, platform }), data);
      assert.equal(calls.length, 1);
    });
    await withApi(() => Response.json([{ ...data, source_system: "AR" }]), async () =>
      assert.rejects(getAutoWithdrawReasons(session, { ...target, country, platform }), /不匹配/));
    await withApi(() => Response.json([]), async calls => {
      assert.equal(await getAutoWithdrawReasons(session, { ...target, country, platform }), null);
      assert.equal(calls.length, 1);
    });
  }
});
test("Baifu only routes its two configured Brazilian platforms", async () => {
  for (const platform of ["5C555", "BET6867"]) {
    assert.deepEqual(reasonSourceTarget("BR", platform.toLowerCase()), { source: "BAIFU", platform });
    const data = { ...fixture(), source_system: "BAIFU", country_code: "BR", platform };
    await withApi(({ url }) => {
      assert.equal(url.searchParams.get("source_system"), "eq.BAIFU");
      assert.equal(url.searchParams.get("country_code"), "eq.BR");
      assert.equal(url.searchParams.get("platform"), `ilike.${platform}`);
      return Response.json([data]);
    }, async calls => {
      assert.deepEqual(await getAutoWithdrawReasons(session, { ...target, country: "胖虎巴西", platform: platform.toLowerCase() }), data);
      assert.equal(calls.length, 1);
    });
    for (const source_system of ["AR", "PANDA", "NEWAR"])
      await withApi(() => Response.json([{ ...data, source_system }]), async () =>
        assert.rejects(getAutoWithdrawReasons(session, { ...target, country: "巴西", platform }), /不匹配/));
    await withApi(() => Response.json([]), async calls => {
      assert.equal(await getAutoWithdrawReasons(session, { ...target, country: "胖虎巴西", platform }), null);
      assert.equal(calls.length, 1);
    });
  }
  for (const [country, platform] of [["IN", "5C555"], ["PH", "BET6867"], ["BR", "5C5552"], ["BR", "BET6867X"]])
    assert.deepEqual(reasonSourceTarget(country, platform), { source: "AR", platform });
  assert.deepEqual(reasonSourceTarget("BR", "5V555"), { source: "PANDA", platform: "5V555" });
});
test("LIKE wildcard inputs cannot match other platforms", async () => {
  await withApi(({ url }) => { assert.equal(url.searchParams.get("platform"), "ilike.A\\_B\\%\\*\\\\"); return Response.json([]); },
    async () => assert.equal(await getAutoWithdrawReasons(session, { ...target, platform: "A_B%*\\" }), null));
});
test("invalid dates, blank platform, missing login or ambiguous region do not issue requests", async () => {
  await withApi(() => assert.fail("invalid input must not access service"), async () => {
    for (const date of ["2026-02-29", "2026-09-31", "", "2026/09/09"]) await assert.rejects(getAutoWithdrawReasons(session, { ...target, date }), /有效/);
    await assert.rejects(getAutoWithdrawReasons(session, { ...target, platform: " " }), /有效/);
    await assert.rejects(getAutoWithdrawReasons({}, target), /登录/);
    await assert.rejects(getAutoWithdrawReasons(session, { ...target, country: "南美" }), /暂未配置/);
  });
});
for (const [status, message] of [[401, /登录已过期/], [403, /没有自动出款查看权限/], [500, /读取失败/]]) {
  test(`HTTP ${status} surfaces error and never turns into empty statistics`, async () => {
    await withApi(() => Response.json({ message: "private upstream response" }, { status }), async () => {
      await assert.rejects(getAutoWithdrawReasons(session, target), message);
    });
  });
}
test("malformed, duplicated and wrong-scope responses are rejected", async () => {
  for (const response of [{}, [fixture(), fixture()], [{ ...fixture(), source_system: "WG" }], [{ ...fixture(), country_code: "ID" }], [{ ...fixture(), platform: "OTHER" }], [{ ...fixture(), stat_date: "2026-09-08" }]]) {
    await withApi(() => Response.json(response), async () => assert.rejects(getAutoWithdrawReasons(session, target), /异常|不匹配/));
  }
});
test("manual denominator includes empty and truncated notes, excludes unknown operator", () => {
  const day = validateReasonsDay(fixture());
  assert.equal(day.snapshot.totals.manual, 428);
  assert.equal(reasonPercent(183, 428), "42.76%");
  assert.equal(reasonPercent(176, 606), "29.04%");
  assert.equal(reasonPercent(0, 0), "—");
  assert.equal(reasonPercent(0, 5), "0.00%");
});
test("coverage and every count partition are checked; no partial day is presented", () => {
  for (const mutate of [
    d => d.snapshot.coverage.complete = false,
    d => d.snapshot.coverage.unique_count = 605,
    d => d.snapshot.coverage.incomplete_note_count = 0,
    d => d.snapshot.totals.total = 607,
    d => d.snapshot.totals.manual = 430,
    d => d.snapshot.groups.pop(),
    d => d.snapshot.groups[0].count = -1,
    d => d.snapshot.groups[0].samples = [42],
    d => d.snapshot.groups[0].count = 176.5,
    d => d.snapshot.groups[0].operator_class = "system",
    d => d.snapshot.groups[1].classification = "other",
    d => d.updated_at = "invalid",
  ]) { const day = fixture(); mutate(day); assert.throws(() => validateReasonsDay(day), /校验失败/); }
});
test("old and new classifier records can both be displayed without reinterpretation", () => {
  for (const version of ["note-template-v1", "note-template-v2"]) {
    const day = fixture(); day.snapshot.classifier_version = version;
    assert.equal(validateReasonsDay(day).snapshot.classifier_version, version);
  }
});
test("a truly empty, completely collected day stays distinct from no record", () => {
  const day = fixture(); day.snapshot.groups = [];
  for (const key of Object.keys(day.snapshot.totals)) day.snapshot.totals[key] = 0;
  day.snapshot.coverage = { complete: true, expected_count: 0, unique_count: 0, incomplete_note_count: 0 };
  assert.equal(validateReasonsDay(day).snapshot.totals.total, 0);
});
test("country mapping is explicit and preserves India vs Indonesia", () => {
  assert.equal(reasonCountryCode("印度"), "IN"); assert.equal(reasonCountryCode("印尼"), "ID");
  assert.equal(reasonCountryCode("vn"), "VN"); assert.equal(reasonCountryCode("胖虎巴西"), "BR");
});
test("frontend permission gate matches database: active owner or explicit module permission", () => {
  assert.equal(canReadWithdrawReasons(null), false);
  assert.equal(canReadWithdrawReasons({ active: false, role: "owner" }), false);
  assert.equal(canReadWithdrawReasons({ active: true, role: "owner" }), true);
  assert.equal(canReadWithdrawReasons({ active: true, role: "admin" }), false);
  assert.equal(canReadWithdrawReasons({ active: true, role: "viewer", permissions: { auto_withdraw: true } }), true);
  assert.equal(canReadWithdrawReasons({ active: true, role: "admin", permissions: { auto_withdraw: false } }), false);
});
test("group variants retain exact counts and reject missing/duplicated-count totals", () => {
  const day = fixture();
  day.grouping_version = "reason-category-v1";
  day.snapshot.groups[3].variants = [{ reason_label: "投注实际数1", count: 100 }, { reason_label: "投注实际数3", count: 141 }];
  assert.equal(validateReasonsDay(day).snapshot.groups[3].count, 241);
  day.snapshot.groups[3].variants[0].count++;
  assert.throws(() => validateReasonsDay(day), /校验失败/);
  day.snapshot.groups[3].variants = [];
  assert.throws(() => validateReasonsDay(day), /校验失败/);
});
