const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTs, root } = require("./load-typescript.cjs");
const { listAutoWithdrawNotes, saveAutoWithdrawNote } = loadTs(path.join(root, "src/lib/autoWithdrawNotesClient.ts"));
const session = { access_token: "test-token" };
const input = { date: "2026-09-09", country: "印尼", platform: "LG111", reason: "通道维护" };
const note = { data_date: input.date, country: input.country, platform: input.platform, reason: input.reason,
  updated_by: "server-user", updated_by_name: "管理员", updated_at: "2026-09-10T08:00:00Z" };

async function withApi(respond, run) {
  const previousFetch = global.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://notes-test.invalid/";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";
  const calls = [];
  global.fetch = async (url, options) => {
    const call = { url: new URL(String(url)), options };
    calls.push(call);
    assert.equal(call.url.origin, "https://notes-test.invalid", "tests must not contact live Supabase");
    return respond(call, calls.length);
  };
  try { await run(calls); }
  finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
}

test("list reads all pages with the same date bounds and deterministic ordering", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ ...note, platform: `PLATFORM-${String(i).padStart(4, "0")}` }));
  await withApi(({ url }) => {
    const offset = Number(url.searchParams.get("offset"));
    return Response.json(rows.slice(offset, offset + 500));
  }, async (calls) => {
    assert.deepEqual(await listAutoWithdrawNotes(session, "2026-08-31", "2026-09-09"), rows);
    assert.deepEqual(calls.map(({ url }) => url.searchParams.get("offset")), ["0", "500", "1000"]);
    for (const { url, options } of calls) {
      assert.equal(url.pathname, "/rest/v1/auto_withdraw_notes");
      assert.deepEqual(url.searchParams.getAll("data_date"), ["gte.2026-08-31", "lte.2026-09-09"]);
      assert.equal(url.searchParams.get("order"), "data_date.asc,country.asc,platform.asc");
      assert.equal(options.cache, "no-store");
      assert.equal(options.headers.Authorization, "Bearer test-token");
    }
  });
});

test("date validation rejects impossible/reversed dates before requesting; leap day remains valid", async () => {
  await withApi(() => Response.json([]), async (calls) => {
    for (const [start, end] of [["2026-02-30", "2026-03-01"], ["2026-09-10", "2026-09-09"], ["2026/09/09", "2026-09-09"], ["", "2026-09-09"]]) {
      await assert.rejects(listAutoWithdrawNotes(session, start, end), /有效的备注日期区间/);
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(await listAutoWithdrawNotes(session, "2028-02-29", "2028-02-29"), []);
    assert.equal(calls.length, 1);
  });
});

test("save targets one date/country/platform and never trusts supplied author or timestamp", async () => {
  await withApi(({ url, options }) => {
    assert.equal(options.method, "POST");
    assert.equal(url.searchParams.get("on_conflict"), "data_date,country,platform");
    assert.equal(options.headers.Prefer, "resolution=merge-duplicates,return=representation");
    assert.deepEqual(JSON.parse(options.body), { data_date: "2026-09-09", country: "印尼", platform: "LG111", reason: "通道维护\n转人工处理" });
    return Response.json([note]);
  }, async () => {
    const result = await saveAutoWithdrawNote(session, { ...input, country: " 印尼 ", platform: " LG111 ",
      reason: "  通道维护\n转人工处理  ", updated_by: "forged-user", updated_at: "1999-01-01" });
    assert.deepEqual(result, note);
  });
});

test("clearing a note sends an empty reason to the same record, not a delete or a new date", async () => {
  await withApi(({ options }) => {
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { data_date: input.date, country: input.country, platform: input.platform, reason: "" });
    return Response.json([{ ...note, reason: "" }]);
  }, async () => assert.equal((await saveAutoWithdrawNote(session, { ...input, reason: " \n\t " })).reason, ""));
});

test("invalid save input and missing session fail before any request", async () => {
  await withApi(() => assert.fail("invalid input must not make an HTTP request"), async () => {
    for (const patch of [{ date: "2026-02-29" }, { country: " " }, { platform: "" }]) {
      await assert.rejects(saveAutoWithdrawNote(session, { ...input, ...patch }), /请指定备注日期、国家和平台/);
    }
    await assert.rejects(saveAutoWithdrawNote(session, { ...input, reason: "字".repeat(1001) }), /不能超过 1000 字/);
    await assert.rejects(saveAutoWithdrawNote({}, input), /请先登录/);
  });
});

for (const [status, expected] of [[401, /登录已过期/], [403, /没有备注编辑权限/], [500, /测试服务错误/]]) {
  test(`${status} responses surface a save/list failure instead of reporting success`, async () => {
    await withApi(() => Response.json({ message: "测试服务错误" }, { status }), async () => {
      await assert.rejects(listAutoWithdrawNotes(session, input.date, input.date), expected);
      await assert.rejects(saveAutoWithdrawNote(session, input), expected);
    });
  });
}

test("a later page failing does not return an apparently complete partial note list", async () => {
  await withApi((_, count) => count === 1 ? Response.json(Array(500).fill(note))
    : Response.json({ message: "权限被撤销" }, { status: 403 }), async (calls) => {
    await assert.rejects(listAutoWithdrawNotes(session, input.date, input.date), /没有备注编辑权限/);
    assert.equal(calls.length, 2);
  });
});

test("malformed or empty save representations are never treated as a successful save", async () => {
  for (const body of [[], [note, note], { data: [note] }]) {
    await withApi(() => Response.json(body), async () => {
      await assert.rejects(saveAutoWithdrawNote(session, input), /没有保存成功|返回格式异常/);
    });
  }
});
