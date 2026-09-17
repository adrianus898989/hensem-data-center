const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTs, root } = require("./load-typescript.cjs");

const {
  buildWorkOrderDepositView,
  workOrderDepositProviderKey,
} = loadTs(path.join(root, "src/lib/workOrderDeposit.ts"));

const volumeRows = ["YerePay", "CoverPay"].map((channel, index) => ({
  id: String(index + 1), sheetName: "fixture", sourceRow: index + 1,
  date: "2026-09-15", country: "印尼", platform: "55FIVE", channel,
  rawChannel: channel, channelType: "QRIS", direction: "代收",
  amount: 100, count: 1, successCount: 1, failedCount: 0,
  successRate: 1, status: "",
}));

function deposit(thirdParty, submittedAmount, submittedCount, successAmount, successCount, withdrawAmount = 0, withdrawCount = 0, withdrawSuccessAmount = 0, withdrawSuccessCount = 0) {
  return {
    system_name: "AR", source_system: "AR_WORKORDER", stat_date: "2026-09-15",
    country_code: "ID", country: "印尼", platform: "55FIVE",
    third_party: thirdParty, channel_type: "QRIS",
    submitted_amount: submittedAmount, submitted_count: submittedCount,
    success_amount: successAmount, success_count: successCount,
    withdraw_not_received_amount: withdrawAmount,
    withdraw_not_received_count: withdrawCount,
    withdraw_success_amount: withdrawSuccessAmount,
    withdraw_success_count: withdrawSuccessCount,
  };
}

test("unmarked platform aggregates are excluded instead of copied to every provider", () => {
  const view = buildWorkOrderDepositView({
    rows: [
      deposit("未标记三方", 15857000, 64, 1171000, 9),
      deposit("YerePay", 3000000, 12, 500000, 3),
      deposit("CoverPay", 2000000, 8, 250000, 2),
    ],
    volumeRows, start: "2026-09-15", end: "2026-09-15", country: "印尼",
  });

  assert.deepEqual(view.providers.map(row => row.channel).sort(), ["CoverPay", "YerePay"]);
  assert.equal(view.providers.some(row => row.channel.includes("未标记")), false);

  const yere = view.compare([workOrderDepositProviderKey("印尼", "YerePay")]).current;
  const cover = view.compare([workOrderDepositProviderKey("印尼", "CoverPay")]).current;
  assert.deepEqual([yere.submittedAmount, yere.submittedCount, yere.successAmount, yere.successCount], [3000000, 12, 500000, 3]);
  assert.deepEqual([cover.submittedAmount, cover.submittedCount, cover.successAmount, cover.successCount], [2000000, 8, 250000, 2]);

  const all = view.compare().current;
  assert.deepEqual([all.submittedAmount, all.submittedCount, all.successAmount, all.successCount], [5000000, 20, 750000, 5]);
});

test("deposit and withdrawal-not-received metrics stay provider scoped", () => {
  const view = buildWorkOrderDepositView({
    rows: [
      deposit("YerePay", 3000, 12, 500, 3, 7200, 4, 5100, 3),
      deposit("CoverPay", 2000, 8, 250, 2, 1800, 2, 900, 1),
    ],
    volumeRows, start: "2026-09-15", end: "2026-09-15", country: "印尼",
  });
  const yere = view.compare([workOrderDepositProviderKey("印尼", "YerePay")]).current;
  assert.deepEqual(
    [
      yere.submittedAmount, yere.submittedCount, yere.successAmount, yere.successCount,
      yere.withdrawNotReceivedAmount, yere.withdrawNotReceivedCount, yere.withdrawSuccessAmount, yere.withdrawSuccessCount,
    ],
    [3000, 12, 500, 3, 7200, 4, 5100, 3],
  );
  assert.equal(yere.successCount / yere.submittedCount, 3 / 12);
  assert.equal(yere.withdrawSuccessCount / yere.withdrawNotReceivedCount, 3 / 4);

  const cover = view.compare([workOrderDepositProviderKey("印尼", "CoverPay")]).current;
  assert.deepEqual(
    [
      cover.submittedAmount, cover.submittedCount, cover.successAmount, cover.successCount,
      cover.withdrawNotReceivedAmount, cover.withdrawNotReceivedCount, cover.withdrawSuccessAmount, cover.withdrawSuccessCount,
    ],
    [2000, 8, 250, 2, 1800, 2, 900, 1],
  );
  assert.equal(cover.successCount / cover.submittedCount, 2 / 8);
  assert.equal(cover.withdrawSuccessCount / cover.withdrawNotReceivedCount, 1 / 2);

  const all = view.compare().current;
  assert.deepEqual(
    [
      all.submittedAmount, all.submittedCount, all.successAmount, all.successCount,
      all.withdrawNotReceivedAmount, all.withdrawNotReceivedCount, all.withdrawSuccessAmount, all.withdrawSuccessCount,
    ],
    [5000, 20, 750, 5, 9000, 6, 6000, 4],
  );
  assert.equal(all.successCount / all.submittedCount, 5 / 20);
  assert.equal(all.withdrawSuccessCount / all.withdrawNotReceivedCount, 4 / 6);
});

test("an unmarked-only source produces no fake provider row or duplicated value", () => {
  const view = buildWorkOrderDepositView({
    rows: [deposit("未标记三方", 15857000, 64, 1171000, 9)],
    volumeRows, start: "2026-09-15", end: "2026-09-15", country: "印尼",
  });
  assert.deepEqual(view.providers, []);
  for (const provider of ["YerePay", "CoverPay"]) {
    const metric = view.compare([workOrderDepositProviderKey("印尼", provider)]).current;
    assert.equal(metric.state, "missing");
    assert.deepEqual([metric.submittedAmount, metric.submittedCount, metric.successAmount, metric.successCount], [0, 0, 0, 0]);
  }
});
