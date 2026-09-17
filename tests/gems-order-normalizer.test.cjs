const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTs, root } = require("./load-typescript.cjs");

const normalizer = loadTs(path.join(root, "BACKEND_CURRENT/gems-order-normalizer.ts"));

function envelope(pathname, items, pageInfo = { total: items.length, currentPage: 1, totalPage: 1 }) {
  return { requestId: "synthetic", path: pathname, success: true, message: "ok", code: 200, data: { items, pageInfo } };
}

function charge(patch = {}) {
  return {
    id: 101,
    uid: "member-secret",
    order_num: "charge-order-101",
    account: "member-account-secret",
    ip: "192.0.2.8",
    nick_name: "member-name-secret",
    amount: 100,
    extra: 5,
    balance: 105,
    status: 0,
    notified: 0,
    charge_id: 1001,
    pay_method: 1018,
    pay_channel_name: 1018,
    pay_type: 5,
    channel: "synthetic-app",
    from: "synthetic-source",
    fill_order_admin: "",
    create_time: "2026-09-16 10:00:00",
    pay_time: "0",
    update_time: "0",
    ...patch,
  };
}

function withdraw(patch = {}) {
  return {
    id: 202,
    uid: "withdraw-member-secret",
    order_num: "withdraw-order-202",
    amount: 110,
    fee: 9,
    real_amount: 101,
    status: 3,
    country: 1,
    pay_channel: 118,
    pay_channel_name: 118,
    pay_type: 0,
    channel: "synthetic-app",
    audit_admin: "operator-a",
    auto_commit: 2,
    audit_remark: "free-text-secret",
    remark: "another-free-text-secret",
    bank_account: "bank-account-secret",
    mobile: "mobile-secret",
    ip: "192.0.2.9",
    info: { account: "nested-account-secret", account_user: "nested-name-secret", mobile: "nested-mobile-secret" },
    create_time: "2026-09-16 11:00:00",
    submit_time: "2026-09-16 11:01:00",
    update_time: "2026-09-16 11:02:00",
    ...patch,
  };
}

test("parses data.items and pageInfo without inventing a requested page size", () => {
  const parsed = normalizer.parseGemsPage(envelope("/operate/chargeOrder/index", [charge()], {
    total: 807,
    currentPage: 1,
    totalPage: 81,
  }));
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.pageInfo, { total: 807, currentPage: 1, totalPage: 81, itemsOnPage: 1 });
  assert.equal(parsed.responseCode, 200);
  assert.equal(parsed.responseSuccess, true);
  assert.equal("pageSize" in parsed.pageInfo, false);

  for (const bad of [
    {},
    { data: { items: {}, pageInfo: { total: 0, currentPage: 1, totalPage: 0 } } },
    { data: { items: [], pageInfo: { total: "0", currentPage: 1, totalPage: 0 } } },
    { data: { items: [null], pageInfo: { total: 1, currentPage: 1, totalPage: 1 } } },
  ]) assert.throws(() => normalizer.parseGemsPage(bad), /Invalid GEMS response field/);
});

test("converts major-unit amounts to exact minor-unit strings without floating point rounding", () => {
  assert.equal(normalizer.gemsMajorToMinor(100), "10000");
  assert.equal(normalizer.gemsMajorToMinor(9), "900");
  assert.equal(normalizer.gemsMajorToMinor("10.05"), "1005");
  assert.equal(normalizer.gemsMajorToMinor("0.01"), "1");
  assert.equal(normalizer.gemsMajorToMinor("9007199254740992.99"), "900719925474099299");
  for (const value of ["1.001", "1e3", -1, Number.POSITIVE_INFINITY, " 1.00 "]) {
    assert.throws(() => normalizer.gemsMajorToMinor(value), /Invalid GEMS response field/);
  }
});

test("normalizes charge amounts while preserving the source status and unresolved routing IDs", () => {
  const row = normalizer.normalizeGemsChargeOrder(charge({ status: "unmapped-charge-state", amount: "100.25", extra: "4.75", balance: "105.00" }));
  assert.equal(row.statusRaw, "unmapped-charge-state");
  assert.deepEqual(row.amounts, { amountMinor: "10025", extraMinor: "475", balanceMinor: "10500", reconciles: true });
  assert.deepEqual(row.routingRaw, {
    chargeId: 1001,
    payMethod: 1018,
    payChannelName: 1018,
    payType: 5,
    channel: "synthetic-app",
    source: "synthetic-source",
  });
  assert.equal("statusText" in row, false);
  assert.equal("providerName" in row.routingRaw, false);
});

test("normalizes withdrawal amount, fee and actual amount independently", () => {
  const row = normalizer.normalizeGemsWithdrawOrder(withdraw());
  assert.equal(row.statusRaw, 3);
  assert.deepEqual(row.amounts, { amountMinor: "11000", feeMinor: "900", realAmountMinor: "10100", reconciles: true });
  assert.deepEqual(row.operator, { auditAdmin: "operator-a", autoCommitRaw: 2 });
  assert.equal(normalizer.normalizeGemsWithdrawOrder(withdraw({ real_amount: 100 })).amounts.reconciles, false);
  assert.equal("statusText" in row, false);
  assert.equal("success" in row, false);
});

test("normalized pages are allow-listed and do not retain member, bank, mobile, IP or free-text payloads", () => {
  const chargePage = normalizer.normalizeGemsPage("charge", envelope("/operate/chargeOrder/index", [charge()]));
  const withdrawPage = normalizer.normalizeGemsPage("withdraw", envelope("/operate/withdrawOrder/index", [withdraw()]));
  const output = JSON.stringify({ chargePage, withdrawPage });
  for (const secret of [
    "member-secret",
    "member-account-secret",
    "member-name-secret",
    "withdraw-member-secret",
    "bank-account-secret",
    "mobile-secret",
    "nested-account-secret",
    "nested-name-secret",
    "nested-mobile-secret",
    "free-text-secret",
    "192.0.2.8",
    "192.0.2.9",
  ]) assert.equal(output.includes(secret), false, `leaked ${secret}`);
  assert.equal(output.includes("raw_payload"), false);
  assert.equal(output.includes("rawPayload"), false);
  assert.equal(chargePage.orders[0].statusRaw, 0);
  assert.equal(withdrawPage.orders[0].statusRaw, 3);
});

test("missing or structured status is rejected instead of being classified", () => {
  const { status: _chargeStatus, ...chargeWithoutStatus } = charge();
  const { status: _withdrawStatus, ...withdrawWithoutStatus } = withdraw();
  assert.throws(() => normalizer.normalizeGemsChargeOrder(chargeWithoutStatus), /charge\.status/);
  assert.throws(() => normalizer.normalizeGemsWithdrawOrder(withdrawWithoutStatus), /withdraw\.status/);
  assert.throws(() => normalizer.normalizeGemsWithdrawOrder(withdraw({ status: { code: 3 } })), /withdraw\.status/);
});
