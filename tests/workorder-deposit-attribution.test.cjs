const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTs, root } = require("./load-typescript.cjs");

const {
  buildWorkOrderDepositView,
  workOrderDepositProviderKey,
  workOrderDepositThirdPartyName,
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

test("confirmed raw work-order aliases use one provider without guessing adjacent names", () => {
  const aliases = [
    ["印度", "NewWinPay2", "NewWinPay"],
    ["印度", "NewWinPay2INR", "NewWinPay"],
    ["印度", "NewWinPay2INR-Bank", "NewWinPay"],
    ["印度", "3TPayINR", "3TPay"],
    ["印度", "3TPayINR-PaytmQR", "3TPay"],
    ["印度", "FancyPay-QR", "FancyPay"],
    ["印度", "FancyPayINR-Bank", "FancyPay"],
    ["印度", "RAPay-QR", "RAPay"],
    ["印度", "QR-OX", "OXPay"],
    ["印度", "OXPayINR", "OXPay"],
    ["印度", "DiDi", "DiDiPay"],
    ["印度", "DiDiPayINR-Bank", "DiDiPay"],
    ["印度", "IC2PayINR-Bank", "ICPay"],
    ["印度", "ATPayINR-Bank2", "ATPay"],
    ["印度", "P3cPayINR", "3cPay"],
    ["巴基斯坦", "MCB-EP", "MCBPay"],
    ["巴基斯坦", "Open", "OpenPay"],
    ["巴基斯坦", "OpenPayPKR", "OpenPay"],
  ];
  for (const [country, raw, expected] of aliases) {
    assert.equal(workOrderDepositThirdPartyName(country, raw), expected, `${country}/${raw}`);
  }

  for (const raw of ["NewWinPay3", "HaoxPayINR", "SpeedPayINR", "Arb"]) {
    assert.notEqual(workOrderDepositThirdPartyName("印度", raw), "NewWinPay", raw);
  }
});

test("generic payment rails use channel_type only for confirmed source pairs", () => {
  const confirmed = [
    ["印度", "PAYTM", "IC2PayINR", "ICPay"],
    ["印度", "PAYTM", "NinePayINR", "NinePay"],
    ["印度", "PAYTM", "OX2PayINR", "OXPay"],
    ["印度", "PAYTM", "RAPayINR", "RAPay"],
    ["印度", "PAYTM", "UmoneyPayINR", "UmoneyPay"],
    ["印度", "PAYTM", "WePay2INR", "WePay"],
    ["印度", "PAYTM", "WPayINR", "WPay"],
    ["印度", "QR", "UmoneyPayINR", "UmoneyPay"],
    ["印度", "QR", "WePay2INR", "WePay"],
    ["缅甸", "KBZPay", "KingPayMMK", "KingPay"],
    ["缅甸", "WavePay", "KingPayMMK", "KingPay"],
    ["缅甸", "KBZPay", "YTPayMMK", "YTPay"],
    ["缅甸", "WavePay", "YTPayMMK", "YTPay"],
    ["马来", "DuitNow", "FPayMYR", "FPay"],
    ["马来", "Touch n Go", "TruePayMYR", "TruePay"],
  ];
  for (const [country, raw, channelType, expected] of confirmed) {
    assert.equal(workOrderDepositThirdPartyName(country, raw, channelType), expected, `${country}/${raw}/${channelType}`);
  }

  assert.equal(workOrderDepositThirdPartyName("印度", "PAYTM", "HaoxPayINR"), "PAYTM / HaoxPayINR");
  assert.equal(workOrderDepositThirdPartyName("印度", "PAYTM", "SpeedPayINR"), "PAYTM / SpeedPayINR");
  assert.equal(workOrderDepositThirdPartyName("印度", "QR", "Arb"), "QR / Arb");
  assert.equal(workOrderDepositThirdPartyName("马来", "DuitNow", "N/A"), "DuitNow / N/A");
});

test("resolved aliases merge their deposit and withdrawal metrics while traceable unknowns stay separate", () => {
  const scoped = (thirdParty, channelType, submitted, withdrawn) => ({
    ...deposit(thirdParty, submitted, 1, 0, 0, withdrawn, 1, 0, 0),
    country_code: "IN", country: "印度", platform: "91CLUB", channel_type: channelType,
  });
  const view = buildWorkOrderDepositView({
    rows: [
      scoped("NewWinPay", "UPI", 10, 1),
      scoped("NewWinPay2INR-Bank", "BANK", 20, 2),
      scoped("PAYTM", "IC2PayINR", 30, 3),
      scoped("ICPay", "UPI", 40, 4),
      scoped("PAYTM", "HaoxPayINR", 50, 5),
      scoped("PAYTM", "SpeedPayINR", 60, 6),
      scoped("N/A", "N/A", 70, 7),
      scoped("Arb", "UPI", 80, 8),
    ],
    volumeRows: [], start: "2026-09-15", end: "2026-09-15", country: "印度",
  });

  const byName = new Map(view.providers.map(row => [row.channel, row]));
  assert.deepEqual(
    [byName.get("NewWinPay").submittedAmount, byName.get("NewWinPay").withdrawNotReceivedAmount],
    [30, 3],
  );
  assert.deepEqual(
    [byName.get("ICPay").submittedAmount, byName.get("ICPay").withdrawNotReceivedAmount],
    [70, 7],
  );
  for (const unknown of ["PAYTM / HaoxPayINR", "PAYTM / SpeedPayINR", "未知三方", "Arb"]) {
    assert.equal(byName.has(unknown), true, unknown);
  }
  const newWin = view.compare([workOrderDepositProviderKey("印度", "NewWinPay")]).current;
  assert.deepEqual([newWin.submittedAmount, newWin.submittedCount, newWin.withdrawNotReceivedAmount, newWin.withdrawNotReceivedCount], [30, 2, 3, 2]);
  const traceable = view.compare([workOrderDepositProviderKey("印度", "PAYTM / HaoxPayINR")]).current;
  assert.deepEqual([traceable.submittedAmount, traceable.submittedCount, traceable.withdrawNotReceivedAmount, traceable.withdrawNotReceivedCount], [50, 1, 5, 1]);
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
