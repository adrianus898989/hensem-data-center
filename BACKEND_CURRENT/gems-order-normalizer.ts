/**
 * Pure response parsing and allow-list normalization for the GEM7/MAX7/EK7
 * backend family.
 *
 * Deliberately out of scope here:
 * - HTTP method, URL construction, authentication, retries, or page requests;
 * - business meanings for order statuses;
 * - payment-channel names or dictionaries;
 * - database writes.
 *
 * Source order objects can contain member, bank, mobile, and IP data. The
 * normalized contracts below therefore never expose a raw payload and only
 * copy fields required for order metrics and operator attribution.
 */

type JsonObject = Record<string, unknown>;
export type GemsScalar = string | number | boolean | null;
export type GemsOrderKind = "charge" | "withdraw";

export type GemsPageInfo = {
  total: number;
  currentPage: number;
  totalPage: number;
  itemsOnPage: number;
};

export type ParsedGemsPage = {
  path: string | null;
  responseCode: GemsScalar;
  responseSuccess: GemsScalar;
  pageInfo: GemsPageInfo;
  items: JsonObject[];
};

type RawTimestamps = {
  createTime: string | null;
  submitTime?: string | null;
  payTime?: string | null;
  updateTime: string | null;
};

export type NormalizedGemsChargeOrder = {
  kind: "charge";
  vendorId: string;
  orderNum: string | null;
  statusRaw: GemsScalar;
  amounts: {
    amountMinor: string;
    extraMinor: string;
    balanceMinor: string;
    reconciles: boolean;
  };
  routingRaw: {
    chargeId: GemsScalar;
    payMethod: GemsScalar;
    payChannelName: GemsScalar;
    payType: GemsScalar;
    channel: GemsScalar;
    source: GemsScalar;
  };
  operator: {
    fillOrderAdmin: string | null;
  };
  notifiedRaw: GemsScalar;
  timestampsRaw: RawTimestamps;
};

export type NormalizedGemsWithdrawOrder = {
  kind: "withdraw";
  vendorId: string;
  orderNum: string | null;
  statusRaw: GemsScalar;
  amounts: {
    amountMinor: string;
    feeMinor: string;
    realAmountMinor: string;
    reconciles: boolean;
  };
  routingRaw: {
    payChannel: GemsScalar;
    payChannelName: GemsScalar;
    payType: GemsScalar;
    channel: GemsScalar;
    country: GemsScalar;
  };
  operator: {
    auditAdmin: string | null;
    autoCommitRaw: GemsScalar;
  };
  timestampsRaw: RawTimestamps;
};

export type NormalizedGemsOrder = NormalizedGemsChargeOrder | NormalizedGemsWithdrawOrder;

export type NormalizedGemsPage = {
  kind: GemsOrderKind;
  path: string | null;
  responseCode: GemsScalar;
  responseSuccess: GemsScalar;
  pageInfo: GemsPageInfo;
  orders: NormalizedGemsOrder[];
};

export class GemsParseError extends Error {
  constructor(readonly field: string) {
    super(`Invalid GEMS response field: ${field}`);
    this.name = "GemsParseError";
  }
}

function record(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GemsParseError(field);
  return value as JsonObject;
}

function scalar(value: unknown, field: string): GemsScalar {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new GemsParseError(field);
}

function optionalScalar(value: unknown, field: string): GemsScalar {
  return value === undefined ? null : scalar(value, field);
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new GemsParseError(field);
  return value;
}

function identifier(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  throw new GemsParseError(field);
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new GemsParseError(field);
}

/**
 * Convert a source amount expressed in major currency units into an exact
 * base-10 minor-unit string. Values with more than two decimal places are
 * rejected instead of silently rounded because the upstream rounding rule is
 * not known yet.
 */
export function gemsMajorToMinor(value: unknown, field = "amount"): string {
  let source: string;
  const cameFromNumber = typeof value === "number";
  if (cameFromNumber) {
    if (!Number.isFinite(value) || value < 0) throw new GemsParseError(field);
    source = String(value);
  } else if (typeof value === "string" && value.length > 0 && value === value.trim()) {
    source = value;
  } else {
    throw new GemsParseError(field);
  }

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(source);
  if (!match) throw new GemsParseError(field);
  const fraction = (match[2] || "").padEnd(2, "0");
  const result = BigInt(match[1]) * BigInt(100) + BigInt(fraction || "0");
  if (cameFromNumber && result > BigInt(Number.MAX_SAFE_INTEGER)) throw new GemsParseError(field);
  return result.toString();
}

export function parseGemsPage(payload: unknown): ParsedGemsPage {
  const envelope = record(payload, "response");
  const data = record(envelope.data, "data");
  if (!Array.isArray(data.items)) throw new GemsParseError("data.items");
  const items = data.items.map((item, index) => record(item, `data.items[${index}]`));
  const sourcePage = record(data.pageInfo, "data.pageInfo");
  return {
    path: optionalText(envelope.path, "path"),
    responseCode: optionalScalar(envelope.code, "code"),
    responseSuccess: optionalScalar(envelope.success, "success"),
    pageInfo: {
      total: integer(sourcePage.total, "data.pageInfo.total"),
      currentPage: integer(sourcePage.currentPage, "data.pageInfo.currentPage"),
      totalPage: integer(sourcePage.totalPage, "data.pageInfo.totalPage"),
      // This is the observed row count, not a guessed or requested page size.
      itemsOnPage: items.length,
    },
    items,
  };
}

export function normalizeGemsChargeOrder(item: unknown): NormalizedGemsChargeOrder {
  const source = record(item, "charge");
  if (!("status" in source)) throw new GemsParseError("charge.status");
  const amountMinor = gemsMajorToMinor(source.amount, "charge.amount");
  const extraMinor = gemsMajorToMinor(source.extra, "charge.extra");
  const balanceMinor = gemsMajorToMinor(source.balance, "charge.balance");
  return {
    kind: "charge",
    vendorId: identifier(source.id, "charge.id"),
    orderNum: optionalText(source.order_num, "charge.order_num"),
    statusRaw: scalar(source.status, "charge.status"),
    amounts: {
      amountMinor,
      extraMinor,
      balanceMinor,
      reconciles: BigInt(amountMinor) + BigInt(extraMinor) === BigInt(balanceMinor),
    },
    // Numeric IDs intentionally stay numeric. This layer has no channel-name
    // dictionary and must not present an ID as a provider name.
    routingRaw: {
      chargeId: optionalScalar(source.charge_id, "charge.charge_id"),
      payMethod: optionalScalar(source.pay_method, "charge.pay_method"),
      payChannelName: optionalScalar(source.pay_channel_name, "charge.pay_channel_name"),
      payType: optionalScalar(source.pay_type, "charge.pay_type"),
      channel: optionalScalar(source.channel, "charge.channel"),
      source: optionalScalar(source.from, "charge.from"),
    },
    operator: {
      fillOrderAdmin: optionalText(source.fill_order_admin, "charge.fill_order_admin"),
    },
    notifiedRaw: optionalScalar(source.notified, "charge.notified"),
    timestampsRaw: {
      createTime: optionalText(source.create_time, "charge.create_time"),
      payTime: optionalText(source.pay_time, "charge.pay_time"),
      updateTime: optionalText(source.update_time, "charge.update_time"),
    },
  };
}

export function normalizeGemsWithdrawOrder(item: unknown): NormalizedGemsWithdrawOrder {
  const source = record(item, "withdraw");
  if (!("status" in source)) throw new GemsParseError("withdraw.status");
  const amountMinor = gemsMajorToMinor(source.amount, "withdraw.amount");
  const feeMinor = gemsMajorToMinor(source.fee, "withdraw.fee");
  const realAmountMinor = gemsMajorToMinor(source.real_amount, "withdraw.real_amount");
  return {
    kind: "withdraw",
    vendorId: identifier(source.id, "withdraw.id"),
    orderNum: optionalText(source.order_num, "withdraw.order_num"),
    statusRaw: scalar(source.status, "withdraw.status"),
    amounts: {
      amountMinor,
      feeMinor,
      realAmountMinor,
      reconciles: BigInt(amountMinor) - BigInt(feeMinor) === BigInt(realAmountMinor),
    },
    routingRaw: {
      payChannel: optionalScalar(source.pay_channel, "withdraw.pay_channel"),
      payChannelName: optionalScalar(source.pay_channel_name, "withdraw.pay_channel_name"),
      payType: optionalScalar(source.pay_type, "withdraw.pay_type"),
      channel: optionalScalar(source.channel, "withdraw.channel"),
      country: optionalScalar(source.country, "withdraw.country"),
    },
    operator: {
      auditAdmin: optionalText(source.audit_admin, "withdraw.audit_admin"),
      autoCommitRaw: optionalScalar(source.auto_commit, "withdraw.auto_commit"),
    },
    timestampsRaw: {
      createTime: optionalText(source.create_time, "withdraw.create_time"),
      submitTime: optionalText(source.submit_time, "withdraw.submit_time"),
      updateTime: optionalText(source.update_time, "withdraw.update_time"),
    },
  };
}

export function normalizeGemsPage(kind: GemsOrderKind, payload: unknown): NormalizedGemsPage {
  const parsed = parseGemsPage(payload);
  return {
    kind,
    path: parsed.path,
    responseCode: parsed.responseCode,
    responseSuccess: parsed.responseSuccess,
    pageInfo: parsed.pageInfo,
    orders: parsed.items.map(item => kind === "charge" ? normalizeGemsChargeOrder(item) : normalizeGemsWithdrawOrder(item)),
  };
}
