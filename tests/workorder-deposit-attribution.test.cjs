const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTs, root } = require("./load-typescript.cjs");

const {
  buildWorkOrderDepositView,
  workOrderDepositProviderKey,
  workOrderDepositThirdPartyName,
  workOrderSuccessTone,
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

test("work-order success warning only flags valid ratios below 30 percent", () => {
  assert.equal(workOrderSuccessTone(0, 0), "neutral");
  assert.equal(workOrderSuccessTone(1, 0), "danger");
  assert.equal(workOrderSuccessTone(100, 29), "danger");
  assert.equal(workOrderSuccessTone(100, 30), "neutral");
  assert.equal(workOrderSuccessTone(100, 90), "neutral");
});

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
    ["印度", "3TPay-QR", "3TPay"],
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
    ["印度", "3cPay-QR", "3cPay"],
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
    ["印度", "PAYTM", "HaoxPayINR", "WPay"],
    ["印度", "PAYTM", "IC2PayINR", "ICPay"],
    ["印度", "PAYTM", "NinePayINR", "NinePay"],
    ["印度", "PAYTM", "OX2PayINR", "OXPay"],
    ["印度", "PAYTM", "RAPayINR", "RAPay"],
    ["印度", "PAYTM", "UmoneyPayINR", "UmoneyPay"],
    ["印度", "PAYTM", "WePay2INR", "WePay"],
    ["印度", "PAYTM", "WPayINR", "WPay"],
    ["印度", "QR", "UmoneyPayINR", "UmoneyPay"],
    ["印度", "QR", "WePay2INR", "WePay"],
    ["印度", "UPI", "ArbPayINR", "UPI-QR"],
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
  assert.equal(byName.get("WPay").submittedAmount, 50);
  for (const unknown of ["PAYTM / SpeedPayINR", "未知三方", "Arb"]) {
    assert.equal(byName.has(unknown), true, unknown);
  }
  const newWin = view.compare([workOrderDepositProviderKey("印度", "NewWinPay")]).current;
  assert.deepEqual([newWin.submittedAmount, newWin.submittedCount, newWin.withdrawNotReceivedAmount, newWin.withdrawNotReceivedCount], [30, 2, 3, 2]);
  const traceable = view.compare([workOrderDepositProviderKey("印度", "PAYTM / SpeedPayINR")]).current;
  assert.deepEqual([traceable.submittedAmount, traceable.submittedCount, traceable.withdrawNotReceivedAmount, traceable.withdrawNotReceivedCount], [60, 1, 6, 1]);
});

test("source-backed India rail and code pairs join canonical providers without global alias guesses", () => {
  const scoped = (thirdParty, channelType, amount) => ({
    ...deposit(thirdParty, amount, 1, amount / 2, 1, amount * 2, 2, amount, 1),
    country_code: "IN", country: "印度", platform: "RAJA", channel_type: channelType,
  });
  const source = [
    scoped("PAYTM", "HaoxPayINR", 100), scoped("PAYTM-WPay", "HaoxPayINR", 200), scoped("WPay", "UPI", 300),
    scoped("UPI", "ArbPayINR", 400), scoped("UPI-QR", "ArbPayINR", 500),
    scoped("ArbPay", "ArbPayINR", 600), scoped("N/A", "N/A", 700),
  ];
  const before = structuredClone(source);
  const view = buildWorkOrderDepositView({ rows: source, volumeRows: [], start: "2026-09-15", end: "2026-09-15", country: "印度" });
  assert.deepEqual(source, before);
  assert.deepEqual(view.providers.map(row => row.channel).sort(), ["WPay", "UPI-QR", "ArbPay", "未知三方"].sort());
  for (const [provider, amount, count] of [["WPay", 600, 3], ["UPI-QR", 900, 2], ["ArbPay", 600, 1], ["未知三方", 700, 1]]) {
    const metric = view.compare([workOrderDepositProviderKey("印度", provider)]).current;
    assert.deepEqual([metric.submittedAmount, metric.submittedCount, metric.withdrawNotReceivedAmount, metric.withdrawNotReceivedCount], [amount, count, amount * 2, count * 2]);
  }
  assert.equal(view.compare().current.submittedAmount, 2800);
  assert.equal(view.compare().current.withdrawNotReceivedAmount, 5600);
  for (const [raw, channel] of [["PAYTM", "HaoxPayINR2"], ["QR", "HaoxPayINR"], ["HaoxPayINR", "PAYTM"]])
    assert.notEqual(workOrderDepositThirdPartyName("印度", raw, channel), "WPay");
  for (const [raw, channel] of [["UPI", ""], ["UPI", "ArbPayINR2"], ["ArbPayINR", "UPI"], ["ArbPay", "ArbPayINR"]])
    assert.notEqual(workOrderDepositThirdPartyName("印度", raw, channel), "UPI-QR");
  for (const country of ["印尼", "越南", "马来"]) {
    assert.notEqual(workOrderDepositThirdPartyName(country, "PAYTM", "HaoxPayINR"), "WPay");
    assert.notEqual(workOrderDepositThirdPartyName(country, "UPI", "ArbPayINR"), "UPI-QR");
  }
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

test("QR work orders join canonical provider rows once in current and previous periods", () => {
  const scoped = (thirdParty, amount, statDate = "2026-09-15") => ({
    ...deposit(thirdParty, amount, 1, amount / 2, 1, amount * 2, 2, amount, 1),
    country_code: "IN", country: "印度", platform: "91CLUB", stat_date: statDate,
    channel_type: "QR",
  });
  const rows = [
    scoped("3TPay", 100), scoped("3TPay-QR", 200),
    scoped("3cPay", 300), scoped("3cPay-QR", 400),
    scoped("IcePay", 500), scoped("Intnet-QR", 600),
    scoped("3TPay-QR", 40, "2026-09-14"),
    scoped("3cPay-QR", 50, "2026-09-14"),
    scoped("UPI", 10), scoped("N/A", 20),
  ];
  const before = structuredClone(rows);
  const view = buildWorkOrderDepositView({
    rows, volumeRows: ["3TPay", "3cPay", "Intnet"].map(channel => ({
      ...volumeRows[0], country: "印度", platform: "91CLUB", channel, rawChannel: channel,
    })), start: "2026-09-15", end: "2026-09-15", country: "印度",
  });
  assert.deepEqual(rows, before, "attribution never rewrites the collected source rows");
  assert.deepEqual(view.providers.map(row => row.channel).sort(), ["3TPay", "3cPay", "Intnet", "UPI", "未知三方"].sort());
  for (const [provider, amount, previousAmount] of [["3TPay", 300, 40], ["3cPay", 700, 50], ["Intnet", 1100, 0]]) {
    const metric = view.compare([workOrderDepositProviderKey("印度", provider)]);
    assert.deepEqual(
      [metric.current.submittedAmount, metric.current.submittedCount,
        metric.current.successAmount, metric.current.successCount,
        metric.current.withdrawNotReceivedAmount, metric.current.withdrawNotReceivedCount,
        metric.current.withdrawSuccessAmount, metric.current.withdrawSuccessCount],
      [amount, 2, amount / 2, 2, amount * 2, 4, amount, 2], provider,
    );
    assert.equal(metric.previous.submittedAmount, previousAmount, provider);
  }
  const total = view.compare().current;
  assert.equal(total.submittedAmount, 2130, "unresolved provider money remains in the total");
  assert.equal(total.submittedCount, 8);
  assert.equal(total.withdrawNotReceivedAmount, 4260);
  assert.equal(total.withdrawNotReceivedCount, 16);
  assert.equal(view.providers.reduce((sum, row) => sum + row.submittedAmount, 0), total.submittedAmount);
  const filtered = buildWorkOrderDepositView({ rows, volumeRows: [], start: "2026-09-15", end: "2026-09-15", country: "印度", provider: "3TPay-QR" });
  assert.deepEqual(filtered.providers.map(row => row.channel), ["3TPay"]);
  assert.equal(filtered.providers[0].submittedAmount, 300);
});
