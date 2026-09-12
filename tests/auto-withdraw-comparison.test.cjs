const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTs, root } = require("./load-typescript.cjs");

const {
  aggregateAutoWithdrawByPlatform, summarizePreviousDay,
  percentagePointChange, formatPercentagePointChange,
} = loadTs(path.join(root, "src/lib/autoWithdrawComparison.ts"));
const { readSupabaseAutoWithdraw } = loadTs(path.join(root, "src/lib/supabaseDashboardServer.ts"));

function daily(date, seconds, overrides = {}) {
  return {
    id: date, data_date: date, country: "印尼", platform: "55FIVE",
    total: 100, success: 95, rejected: 5, auto_count: 60, manual_count: 40,
    avg_seconds: seconds, avg_time_text: `${seconds}秒`, source_sheet: `raw_daily_${date.slice(0, 7)}`,
    updated_at: `${date}T12:00:00Z`, ...overrides,
  };
}

async function withDatabase(rows, run) {
  const oldFetch = global.fetch;
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://comparison-test.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";
  const queries = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "test-user" });
    if (url.pathname.endsWith("/dashboard_profiles")) {
      return Response.json([{ auth_user_id: "test-user", username: "tester", role: "owner", active: true }]);
    }
    queries.push(url);
    const [gte, lte] = url.searchParams.getAll("data_date");
    assert.ok(gte.startsWith("gte."));
    assert.ok(lte.startsWith("lte."));
    const filtered = url.pathname.endsWith("/auto_withdraw_daily")
      ? rows.filter((row) => row.data_date >= gte.slice(4) && row.data_date <= lte.slice(4)) : [];
    return Response.json(filtered);
  };
  try {
    const request = new Request("https://dashboard.invalid/api/auto-withdraw", {
      headers: { Authorization: "Bearer test-token" },
    });
    await run(request, queries);
  } finally {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey;
  }
}

for (const [previous, current] of [["2026-09-08", "2026-09-09"], ["2026-08-31", "2026-09-01"], ["2026-12-31", "2027-01-01"]]) {
  test(`single-day ${current}: preserve yesterday comparison through the display aggregation`, async () => {
    await withDatabase([daily(previous, 120, { total: 900 }), daily(current, 150)], async (request, queries) => {
      const payload = await readSupabaseAutoWithdraw(request, current, current);
      assert.equal(payload.dailyRows.length, 1);
      assert.equal(payload.dailyRows[0].date, current);
      assert.equal(payload.meta.rawDailyRows, 1);
      assert.equal(payload.monthlyRows.reduce((sum, row) => sum + row.total, 0), 100);
      assert.deepEqual(queries[0].searchParams.getAll("data_date"), [`gte.${previous}`, `lte.${current}`]);
      const [display] = aggregateAutoWithdrawByPlatform(payload.dailyRows);
      assert.equal(display.total, 100, "comparison-day totals must never enter the selected-day totals");
      assert.equal(display.yesterdayAvgTime, "2分0秒");
      assert.equal(display.comparePercent, "+25.00%");
      assert.deepEqual(display.previousDay, {
        date: previous, total: 900, success: 95, rejected: 5, autoCount: 60, manualCount: 40,
      });
      assert.deepEqual(payload.monthlyRows[0].previousDay, display.previousDay);
    });
  });
}

test("a cross-month aggregate keeps range totals and does not borrow one day's yesterday", async () => {
  await withDatabase([daily("2026-08-30", 100), daily("2026-08-31", 120), daily("2026-09-01", 180)], async (request) => {
    const payload = await readSupabaseAutoWithdraw(request, "2026-08-31", "2026-09-01");
    const displayRows = aggregateAutoWithdrawByPlatform(payload.dailyRows);
    assert.equal(displayRows.length, 1, "a new source sheet in September must not split one platform");
    const [display] = displayRows;
    assert.equal(display.total, 200);
    assert.equal(display.avgTime, "2分30秒");
    assert.equal(display.yesterdayAvgTime, "-");
    assert.equal(display.comparePercent, "-");
    assert.equal(display.previousDay, null);
    assert.equal(payload.monthlyRows[0].previousDay, null);
    assert.equal(payload.dailyRows[0].total, 100, "aggregation must not mutate the source daily rows");
    assert.equal(payload.dailyRows[1].comparePercent, "+50.00%");
  });
});

test("missing previous-day data does not become zero seconds or another platform's comparison", async () => {
  await withDatabase([
    daily("2026-09-08", 30, { country: "印度" }),
    daily("2026-09-08", 40, { platform: "OTHER" }),
    daily("2026-09-09", 150),
  ], async (request) => {
    const payload = await readSupabaseAutoWithdraw(request, "2026-09-09", "2026-09-09");
    const [display] = aggregateAutoWithdrawByPlatform(payload.dailyRows);
    assert.equal(display.yesterdayAvgTime, "-");
    assert.equal(display.comparePercent, "-");
    assert.equal(display.previousDay, null);
  });
});

test("a present zero-total day is distinct from a missing day", async () => {
  await withDatabase([
    daily("2026-09-09", 0, { total: 0, success: 0, rejected: 0, auto_count: 0, manual_count: 0 }),
    daily("2026-09-10", 90),
  ], async (request) => {
    const payload = await readSupabaseAutoWithdraw(request, "2026-09-10", "2026-09-10");
    const rows = aggregateAutoWithdrawByPlatform(payload.dailyRows);
    assert.deepEqual(rows[0].previousDay, {
      date: "2026-09-09", total: 0, success: 0, rejected: 0, autoCount: 0, manualCount: 0,
    });
    const summary = summarizePreviousDay(rows);
    assert.equal(summary.matchedPlatforms, 1);
    assert.equal(summary.totals.total, 0);
    assert.equal(percentagePointChange(60, 100, 0, 0), null);
  });
});

test("explicit zero manual and automatic counts remain zero for both dates", async () => {
  await withDatabase([
    daily("2026-09-09", 90, { manual_count: 0, auto_count: 0 }),
    daily("2026-09-10", 90, { manual_count: "0", auto_count: "0" }),
  ], async (request) => {
    const payload = await readSupabaseAutoWithdraw(request, "2026-09-10", "2026-09-10");
    const [row] = payload.dailyRows;
    assert.equal(row.manualCount, 0);
    assert.equal(row.autoCount, 0);
    assert.equal(row.previousDay.manualCount, 0);
    assert.equal(row.previousDay.autoCount, 0);
    assert.equal(row.manualRate, 0);
  });
});

test("only a missing manual count uses the legacy total-minus-auto fallback", async () => {
  await withDatabase([daily("2026-09-10", 90, { manual_count: null })], async (request) => {
    const payload = await readSupabaseAutoWithdraw(request, "2026-09-10", "2026-09-10");
    assert.equal(payload.dailyRows[0].manualCount, 40);
  });
});

test("the previous-day comparison uses the latest deduplicated row, not an older source revision", async () => {
  await withDatabase([
    daily("2026-09-09", 90, { updated_at: "2026-09-10T10:00:00Z", auto_count: 20 }),
    daily("2026-09-09", 90, { updated_at: "2026-09-10T11:00:00Z", auto_count: 70 }),
    daily("2026-09-10", 90),
  ], async (request) => {
    const payload = await readSupabaseAutoWithdraw(request, "2026-09-10", "2026-09-10");
    assert.equal(payload.dailyRows[0].previousDay.autoCount, 70);
    assert.equal(payload.dailyRows[0].total, 100);
  });
});

test("multi-day selection clears every platform comparison, including sparse platforms", async () => {
  await withDatabase([
    daily("2026-09-08", 90), daily("2026-09-09", 90), daily("2026-09-10", 90),
    daily("2026-09-09", 90, { platform: "SPARSE" }),
  ], async (request) => {
    const payload = await readSupabaseAutoWithdraw(request, "2026-09-09", "2026-09-10");
    const rows = aggregateAutoWithdrawByPlatform(payload.dailyRows);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.previousDay, null);
      assert.equal(row.comparePercent, "-");
    }
    assert.ok(payload.monthlyRows.every((row) => row.previousDay === null));
  });
});

function previous(overrides = {}) {
  return { date: "2026-09-09", total: 100, success: 90, rejected: 10, autoCount: 60, manualCount: 40, ...overrides };
}

function display(platform, previousDay, overrides = {}) {
  return {
    country: "巴西", platform, date: "2026-09-10", total: 100, success: 95, rejected: 5,
    autoCount: 60, manualCount: 40, successRate: 0.95, rejectRate: 0.05, autoRate: 0.6, manualRate: 0.4,
    avgTime: "1分30秒", yesterdayAvgTime: "1分20秒", comparePercent: "+12.50%",
    sourceSheet: "test", previousDay, ...overrides,
  };
}

test("summary uses weighted count totals rather than averaging platform rates", () => {
  const rows = [
    display("SMALL", previous({ total: 10, success: 1, rejected: 9, autoCount: 2, manualCount: 8 })),
    display("LARGE", previous({ total: 90, success: 81, rejected: 9, autoCount: 72, manualCount: 18 })),
  ];
  const before = JSON.stringify(rows);
  assert.deepEqual(summarizePreviousDay(rows), {
    totals: { total: 100, success: 82, rejected: 18, autoCount: 74, manualCount: 26 },
    matchedPlatforms: 2, totalPlatforms: 2, date: "2026-09-09",
  });
  const delta = percentagePointChange(90, 100, 82, 100);
  assert.ok(Math.abs(delta - 8) < 1e-10);
  assert.equal(formatPercentagePointChange(delta), "+8.00 pp");
  assert.equal(JSON.stringify(rows), before, "summary must not mutate current or previous counts");
});

test("a missing filtered platform does not get a zero-filled summary", () => {
  const rows = [display("A", previous()), display("B", null)];
  assert.deepEqual(summarizePreviousDay(rows), {
    totals: null, matchedPlatforms: 1, totalPlatforms: 2, date: "2026-09-09",
  });
  assert.equal(summarizePreviousDay(rows.slice(0, 1)).totals.total, 100, "only selected platforms determine coverage");
});

test("same platform name in another country is a separate comparison population", () => {
  const summary = summarizePreviousDay([
    display("A", previous()), display("A", null, { country: "印度" }),
  ]);
  assert.equal(summary.totalPlatforms, 2);
  assert.equal(summary.matchedPlatforms, 1);
  assert.equal(summary.totals, null);
});

test("different previous dates never combine into one comparison day", () => {
  assert.deepEqual(summarizePreviousDay([
    display("A", previous()), display("B", previous({ date: "2026-09-08" })),
  ]), { totals: null, matchedPlatforms: 2, totalPlatforms: 2, date: null });
});

test("summary counts repeated identical platforms once and rejects conflicting revisions", () => {
  const first = display("A", previous());
  assert.equal(summarizePreviousDay([first, { ...first }]).totals.total, 100);
  assert.deepEqual(summarizePreviousDay([first, display("A", previous({ autoCount: 61 }))]), {
    totals: null, matchedPlatforms: 0, totalPlatforms: 1, date: null,
  });
});

test("an empty or undated selection cannot invent a comparison", () => {
  assert.deepEqual(summarizePreviousDay([]), { totals: null, matchedPlatforms: 0, totalPlatforms: 0, date: null });
  assert.equal(aggregateAutoWithdrawByPlatform([display("A", previous(), { date: undefined })])[0].previousDay, null);
});

test("pp calculation retains signs, handles zero and rejects unavailable denominators", () => {
  assert.equal(formatPercentagePointChange(percentagePointChange(75, 100, 50, 100)), "+25.00 pp");
  assert.equal(formatPercentagePointChange(percentagePointChange(25, 100, 50, 100)), "-25.00 pp");
  assert.equal(formatPercentagePointChange(percentagePointChange(0, 100, 0, 100)), "0.00 pp");
  for (const counts of [[0, 0, 1, 10], [1, 10, 0, 0], [1, -1, 1, 10], [NaN, 10, 1, 10], [1, Infinity, 1, 10]]) {
    assert.equal(percentagePointChange(...counts), null);
  }
  assert.equal(formatPercentagePointChange(null), "—");
  assert.equal(formatPercentagePointChange(NaN), "—");
  assert.equal(formatPercentagePointChange(-0.000001), "0.00 pp");
  assert.equal(formatPercentagePointChange(0.000001), "0.00 pp");
});
