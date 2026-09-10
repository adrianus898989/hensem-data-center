const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTs, root } = require("./load-typescript.cjs");

const { aggregateAutoWithdrawByPlatform } = loadTs(path.join(root, "src/lib/autoWithdrawComparison.ts"));
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
  });
});
