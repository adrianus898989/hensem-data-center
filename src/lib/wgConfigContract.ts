// WG read-only configuration v1: only fields observed in the supplied HAR.
// This module has no network, storage, React or source-backend dependencies.
export const WG_CONFIG_MAX_BYTES = 2 * 1024 * 1024;
export const WG_DICTIONARIES = ["levels", "tags", "activities", "withdraw_types", "merchants"] as const;
export const WG_UNAVAILABLE_DICTIONARIES = ["games", "banks"] as const;
export type WGDictionaryName = typeof WG_DICTIONARIES[number];
export type WGSelectionCode = number | string;
export type WGUnknownSelection = WGSelectionCode | WGSelectionCode[] | null;
export type WGGameSelection = { categoryId: number; platformId: number; gameIds: number[] };
export type WGDiscountSelection = { optType: number; dealType: number; activeIds: number[] };
export type WGAmount = {
  memberLevelId?: number; currency?: string; currencyName?: string;
  minAuditAmount: string; total24Amount: string; selectType: number;
  merchList: number[] | null; reviewAmount: string; reviewAmountByTime: number;
  receivedAmount: string; receivedAmountByTime: number; designateBank: WGUnknownSelection;
};
export type WGCondition = {
  status?: boolean; value?: number; excludeNoWallet?: boolean; excludeThirdPartyWallet?: boolean;
  day?: number; multiple?: number; ratio?: number; difference?: number; severalTimes?: number;
  severalHours?: number; specifiedDiscount?: WGSelectionCode[] | WGDiscountSelection[]; amount?: number;
};
export type WGConfigSetting = {
  exemptSwitch: number; unavoidableCauseRemarkSwitch: number;
  levelIds: number[]; tagIds: number[]; registerTime: number;
  requiredLevelIds: number[]; requiredTagIds: number[]; requiredRegisterTime: number;
  noRequiredTagIds: number[]; otherCondition: null;
  exemptAmountList: WGAmount[]; otherConditionV2: Record<string, WGCondition | WGUnknownSelection>;
  PIXCondition: WGSelectionCode[]; exemptMemberLevelAmount: WGAmount[];
  mustBeReviewedAmountList: WGAmount[]; mustBeReviewedMemberLevelAmountList: WGAmount[];
  reviewBankCodeList: WGUnknownSelection; betGameLimit: { games: WGUnknownSelection | WGGameSelection[]; days: number };
};
export type WGConfigDictionaries = {
  levels: Array<{ id: number; level_id: number; name: string }>;
  tags: Array<{ id: number; name: string }>;
  activities: Array<{ optType: number; optTypeTxt: string; dealTypeList: Array<{
    dealType: number; dealTypeTxt: string; activeList: Array<{ ActiveId: number; ActiveName: string }>;
  }> }>;
  withdraw_types: Array<{ id: number; name: string; weight: number; child: Array<{
    id: number; name: string; weight: number; extends?: Array<{ k: string; v: string }>;
  }> }>;
  merchants: Array<{ id: number; value: string }>;
};
export type WGConfiguration = {
  settings: Record<string, WGConfigSetting>;
  dictionaries: WGConfigDictionaries;
  completeness: { available: string[]; unavailable: string[] };
};
export type WGConfigSnapshot = {
  schema_version: 1; source_system: "WG"; parser_version: "wg-config-v1";
  country_code: string; platform: string; site_code: string; timezone: string;
  observed_at: string; observed_local_date: string; snapshot_id: string;
  configuration: WGConfiguration;
};

type ObjectValue = Record<string, unknown>;
function fail(path: string): never { throw new Error(`invalid_wg_configuration:${path}`); }
function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path);
  return value as ObjectValue;
}
function keys(value: ObjectValue, expected: readonly string[], path: string): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) fail(`${path}.fields`);
}
function text(value: unknown, max: number, path: string, empty = false): asserts value is string {
  if (typeof value !== "string" || (!empty && !value.length) || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value) || Array.from(value).length > max) fail(path);
  for (const character of value) if (character.length === 1 && /[\ud800-\udfff]/.test(character)) fail(path);
}
function number(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail(path);
}
function id(value: unknown, path: string): asserts value is number {
  number(value, path); if (!Number.isSafeInteger(value) || value < 0) fail(path);
}
function list(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path); return value;
}
function ids(value: unknown, path: string): number[] {
  const result = list(value, 2000, path);
  for (const item of result) id(item, path);
  if (new Set(result).size !== result.length) fail(`${path}.duplicate`);
  return result as number[];
}
function selection(value: unknown, path: string, arrayOnly = false): void {
  if (value === null && !arrayOnly) return;
  const values = Array.isArray(value) ? list(value, 2000, path) : arrayOnly ? fail(`${path}.unobserved_shape`) : [value];
  for (const item of values) {
    if (typeof item === "number") id(item, path);
    else if (typeof item !== "string" || !/^[A-Za-z0-9_.:|/-]{1,80}$/.test(item)) fail(`${path}.unobserved_shape`);
  }
}
function nullOnly(value: unknown, path: string): void { if (value !== null) fail(`${path}.unobserved_shape`); }
// VN returns selected games/offers grouped by their source parents. Only these
// two observed structures are accepted; arbitrary objects remain unsupported.
function groupedSelection(value: unknown, path: string, parents: readonly string[], children: string, arrayOnly = false): void {
  if (!Array.isArray(value) || !value.some(item => item !== null && typeof item === "object")) {
    selection(value, path, arrayOnly); return;
  }
  const rows = list(value, 2000, path), seen = new Set<string>();
  let nodes = rows.length;
  for (const item of rows) {
    const row = object(item, path); keys(row, [...parents, children], path);
    for (const parent of parents) id(row[parent], `${path}.${parent}`);
    const selected = ids(row[children], `${path}.${children}`);
    const key = JSON.stringify(parents.map(parent => row[parent]));
    if (seen.has(key)) fail(`${path}.duplicate`);
    seen.add(key); nodes += selected.length;
  }
  if (nodes > 5000) fail(`${path}.tree_size`);
}
function byteLimit(value: unknown): void {
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { fail("json"); }
  if (!encoded || new TextEncoder().encode(encoded).byteLength > WG_CONFIG_MAX_BYTES) fail("size");
}
function uniqueRows(rows: unknown[], field: string, path: string): void {
  const values = rows.map(row => object(row, path)[field]);
  if (new Set(values).size !== values.length) fail(`${path}.duplicate`);
}
function sameSet(value: unknown, expected: readonly string[], path: string): void {
  const actual = list(value, 8, path);
  if (actual.length !== expected.length || new Set(actual).size !== actual.length || actual.some(item => !expected.includes(item as string))) fail(path);
}

const RULE_FIELDS: Record<string, readonly string[] | null> = {
  firstFewWithdrawals: ["status", "value"],
  withdrawalAccountFirstWithdrawal: ["status", "excludeNoWallet", "excludeThirdPartyWallet"],
  riskControlRulesAndNotAddressed: ["status"], gamblingRiskControlRulesAndNotAddressed: ["status"],
  depositAndWithdrawalDifferenceGreaterThan0: ["status"], accumulatedHistoricalLoss: ["status"],
  last3DaysSystemReleaseAudit: ["status", "day"], firstDepositIsComplete: ["status"],
  depositAndWithdrawalCPFIsInconsistent: ["status"], withdrawalIsRefusedOrCancelled: ["status", "value"],
  withdrawalIPDoesNotHaveTheSameName: ["status"], codingMultiple: ["status", "day", "multiple"],
  depositAndWithdrawalDifference: ["status", "ratio", "difference"], memberSuccessWithdraw: ["status", "severalTimes"],
  withdrawalDeviceAccountNumber: ["status", "value"], rechargeWithdrawalBalanceDifference: ["status", "day", "multiple"],
  firstUseWalletWithdraw: ["status"], firstUseNoWalletWithdraw: ["status"], perUseNoWalletWithdraw: ["status"],
  perUseWalletWithdraw: ["status"], totalWithdrawalFrequency: ["status", "severalTimes"],
  mustBeReceivedDiscount: ["severalHours", "specifiedDiscount"], manualDepositAudit: ["status", "day"],
  sportRollingBetProfit: ["status", "amount"], exemptRechargeWithdrawalDifference: ["status", "day", "difference"],
  exemptCodingMultiple: ["status", "day", "multiple"], requiredWithdrawTypes: null,
};
const SETTING_FIELDS = ["exemptSwitch", "unavoidableCauseRemarkSwitch", "levelIds", "tagIds", "registerTime", "requiredLevelIds", "requiredTagIds", "requiredRegisterTime", "noRequiredTagIds", "otherCondition", "exemptAmountList", "otherConditionV2", "PIXCondition", "exemptMemberLevelAmount", "mustBeReviewedAmountList", "mustBeReviewedMemberLevelAmountList", "reviewBankCodeList", "betGameLimit"];
const AMOUNT_FIELDS = ["minAuditAmount", "total24Amount", "selectType", "merchList", "reviewAmount", "reviewAmountByTime", "receivedAmount", "receivedAmountByTime", "designateBank"];
function amountRows(value: unknown, layered: boolean, path: string): void {
  const rows = list(value, 2000, path);
  for (const item of rows) {
    const row = object(item, path);
    keys(row, [...AMOUNT_FIELDS, ...(layered ? ["memberLevelId"] : ["currency", "currencyName"])], path);
    if (layered) id(row.memberLevelId, path);
    else { text(row.currency, 16, path); text(row.currencyName, 200, path, true); }
    for (const field of ["minAuditAmount", "total24Amount", "reviewAmount", "receivedAmount"]) {
      text(row[field], 100, `${path}.${field}`, true);
      if (!/^(?:|-?\d+(?:\.\d+)?)$/.test(row[field] as string)) fail(`${path}.${field}`);
    }
    for (const field of ["selectType", "reviewAmountByTime", "receivedAmountByTime"]) number(row[field], `${path}.${field}`);
    if (row.merchList !== null) ids(row.merchList, `${path}.merchList`);
    selection(row.designateBank, `${path}.designateBank`);
  }
  uniqueRows(rows, layered ? "memberLevelId" : "currency", path);
}
function setting(value: unknown, path: string): void {
  const current = object(value, path); keys(current, SETTING_FIELDS, path);
  for (const key of ["exemptSwitch", "unavoidableCauseRemarkSwitch", "registerTime", "requiredRegisterTime"]) number(current[key], `${path}.${key}`);
  for (const key of ["levelIds", "tagIds", "requiredLevelIds", "requiredTagIds", "noRequiredTagIds"]) ids(current[key], `${path}.${key}`);
  nullOnly(current.otherCondition, `${path}.otherCondition`);
  selection(current.reviewBankCodeList, `${path}.reviewBankCodeList`);
  selection(current.PIXCondition, `${path}.PIXCondition`, true);
  for (const key of ["exemptAmountList", "mustBeReviewedAmountList"]) amountRows(current[key], false, `${path}.${key}`);
  for (const key of ["exemptMemberLevelAmount", "mustBeReviewedMemberLevelAmountList"]) amountRows(current[key], true, `${path}.${key}`);
  const game = object(current.betGameLimit, `${path}.betGameLimit`);
  keys(game, ["games", "days"], `${path}.betGameLimit`); groupedSelection(game.games, `${path}.betGameLimit.games`, ["categoryId", "platformId"], "gameIds"); number(game.days, `${path}.betGameLimit.days`);
  const rules = object(current.otherConditionV2, `${path}.otherConditionV2`);
  keys(rules, Object.keys(RULE_FIELDS), `${path}.otherConditionV2`);
  for (const [key, fields] of Object.entries(RULE_FIELDS)) {
    const rulePath = `${path}.otherConditionV2.${key}`;
    if (fields === null) { selection(rules[key], rulePath); continue; }
    const rule = object(rules[key], rulePath); keys(rule, fields, rulePath);
    for (const field of fields) {
      if (["status", "excludeNoWallet", "excludeThirdPartyWallet"].includes(field)) {
        if (typeof rule[field] !== "boolean") fail(`${rulePath}.${field}`);
      } else if (field === "specifiedDiscount") groupedSelection(rule[field], `${rulePath}.${field}`, ["optType", "dealType"], "activeIds", true);
      else number(rule[field], `${rulePath}.${field}`);
    }
  }
}

export function validateWGConfiguration(value: unknown): WGConfiguration {
  byteLimit(value);
  const config = object(value, "configuration"); keys(config, ["settings", "dictionaries", "completeness"], "configuration");
  const settings = object(config.settings, "settings");
  if (!Object.hasOwn(settings, "0") || Object.keys(settings).length > 100) fail("settings.scope");
  for (const [site, current] of Object.entries(settings)) {
    if (!/^(?:0|[1-9]\d{0,14})$/.test(site)) fail("settings.site_code"); setting(current, `settings.${site}`);
  }
  const dictionaries = object(config.dictionaries, "dictionaries"); keys(dictionaries, WG_DICTIONARIES, "dictionaries");
  for (const key of ["levels", "tags", "merchants"] as const) {
    const rows = list(dictionaries[key], 2000, `dictionaries.${key}`);
    for (const item of rows) {
      const row = object(item, key); keys(row, key === "levels" ? ["id", "level_id", "name"] : key === "tags" ? ["id", "name"] : ["id", "value"], key);
      id(row.id, key); if (key === "levels") id(row.level_id, key);
      text(row[key === "merchants" ? "value" : "name"], 200, key);
    }
    uniqueRows(rows, key === "levels" ? "level_id" : "id", key);
  }
  let nodes = 0;
  const activities = list(dictionaries.activities, 2000, "activities");
  for (const item of activities) {
    const row = object(item, "activities"); keys(row, ["optType", "optTypeTxt", "dealTypeList"], "activities");
    id(row.optType, "activities"); text(row.optTypeTxt, 200, "activities"); nodes++;
    const deals = list(row.dealTypeList, 2000, "dealTypeList");
    for (const dealValue of deals) {
      const deal = object(dealValue, "dealTypeList"); keys(deal, ["dealType", "dealTypeTxt", "activeList"], "dealTypeList");
      id(deal.dealType, "dealTypeList"); text(deal.dealTypeTxt, 200, "dealTypeList"); nodes++;
      const acts = list(deal.activeList, 2000, "activeList");
      for (const actValue of acts) {
        const act = object(actValue, "activeList"); keys(act, ["ActiveId", "ActiveName"], "activeList");
        id(act.ActiveId, "activeList"); text(act.ActiveName, 200, "activeList"); nodes++;
      }
      uniqueRows(acts, "ActiveId", "activeList");
    }
    uniqueRows(deals, "dealType", "dealTypeList");
  }
  uniqueRows(activities, "optType", "activities");
  const types = list(dictionaries.withdraw_types, 2000, "withdraw_types");
  for (const item of types) {
    const row = object(item, "withdraw_types"); keys(row, ["id", "name", "child", "weight"], "withdraw_types");
    id(row.id, "withdraw_types"); text(row.name, 200, "withdraw_types"); number(row.weight, "withdraw_types"); nodes++;
    const children = list(row.child, 2000, "withdraw_types.child");
    for (const childValue of children) {
      const child = object(childValue, "withdraw_types.child"); keys(child, ["id", "name", "weight", ...(Object.hasOwn(child, "extends") ? ["extends"] : [])], "withdraw_types.child");
      id(child.id, "withdraw_types.child"); text(child.name, 200, "withdraw_types.child"); number(child.weight, "withdraw_types.child"); nodes++;
      const extensions = Object.hasOwn(child, "extends") ? list(child.extends, 2000, "withdraw_types.extends") : [];
      for (const extension of extensions) {
        const field = object(extension, "withdraw_types.extends"); keys(field, ["k", "v"], "withdraw_types.extends");
        text(field.k, 200, "withdraw_types.extends"); text(field.v, 200, "withdraw_types.extends"); nodes++;
      }
      uniqueRows(extensions, "k", "withdraw_types.extends");
    }
    uniqueRows(children, "id", "withdraw_types.child");
  }
  uniqueRows(types, "id", "withdraw_types"); if (nodes > 5000) fail("dictionaries.tree_size");
  const completeness = object(config.completeness, "completeness"); keys(completeness, ["available", "unavailable"], "completeness");
  sameSet(completeness.available, ["settings", ...WG_DICTIONARIES], "completeness.available");
  sameSet(completeness.unavailable, WG_UNAVAILABLE_DICTIONARIES, "completeness.unavailable");
  return value as WGConfiguration;
}

export function validateWGConfigSnapshot(value: unknown, now = new Date()): WGConfigSnapshot {
  byteLimit(value);
  const snapshot = object(value, "snapshot");
  keys(snapshot, ["schema_version", "source_system", "parser_version", "country_code", "platform", "site_code", "timezone", "observed_at", "observed_local_date", "snapshot_id", "configuration"], "snapshot");
  if (snapshot.schema_version !== 1 || snapshot.source_system !== "WG" || snapshot.parser_version !== "wg-config-v1") fail("snapshot.version");
  if (typeof snapshot.country_code !== "string" || !/^[A-Z]{2}$/.test(snapshot.country_code)) fail("country_code");
  text(snapshot.platform, 80, "platform"); text(snapshot.site_code, 15, "site_code");
  if (!/^[1-9]\d*$/.test(snapshot.site_code)) fail("site_code");
  text(snapshot.timezone, 80, "timezone"); text(snapshot.observed_at, 40, "observed_at");
  const date = new Date(snapshot.observed_at);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(snapshot.observed_at)
    || !Number.isFinite(date.getTime()) || date.getTime() > now.getTime() + 300000
    || date.toISOString().slice(0, 10) !== snapshot.observed_at.slice(0, 10)) fail("observed_at");
  let localDate: string;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: snapshot.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    localDate = ["year", "month", "day"].map(key => parts.find(part => part.type === key)!.value).join("-");
  } catch { fail("timezone"); }
  if (snapshot.observed_local_date !== localDate) fail("observed_local_date");
  if (typeof snapshot.snapshot_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot.snapshot_id)) fail("snapshot_id");
  const configuration = validateWGConfiguration(snapshot.configuration);
  if (!Object.hasOwn(configuration.settings, snapshot.site_code)) fail("settings.parent_missing");
  // The receiver must additionally compare country/platform/site/timezone and
  // required member site codes against its trusted target registry.
  return value as WGConfigSnapshot;
}
