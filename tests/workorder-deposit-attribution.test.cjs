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

function deposit(thirdParty, submittedAmount, submittedCount, successAmount, successCount) {
  return {
    system_name: "AR", source_system: "AR_WORKORDER", stat_date: "2026-09-15",
    country_code: "ID", country: "印尼", platform: "55FIVE",
    third_party: thirdParty, channel_type: "QRIS",
    submitted_amount: submittedAmount, submitted_count: submittedCount,
    success_amount: successAmount, success_count: successCount,
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
