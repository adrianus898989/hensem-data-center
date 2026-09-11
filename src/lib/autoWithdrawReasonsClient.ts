"use client";

import type { DashboardSession, DashboardProfile } from "./dashboardAuthClient";

export type ReasonOperator = "manual" | "auto" | "unknown";
export type WithdrawReasonGroup = {
  operator_class: ReasonOperator;
  reason_key: string;
  reason_label: string;
  classification: "template" | "empty" | "unclassified" | "truncated";
  count: number;
  success: number;
  reject: number;
  other: number;
  samples: string[];
  variants?: Array<{ reason_label: string; count: number }>;
};
export type WithdrawReasonsDay = {
  source_system: string;
  country_code: string;
  platform: string;
  stat_date: string;
  updated_at: string;
  grouping_version?: string;
  snapshot: {
    schema_version: number;
    classifier_version: string;
    timezone: string;
    snapshot_at: string;
    coverage: { complete: boolean; expected_count: number; unique_count: number; incomplete_note_count: number };
    totals: { total: number; auto: number; manual: number; unknown: number; success: number; reject: number; other: number };
    groups: WithdrawReasonGroup[];
  };
};

const COUNTRY_CODES: Record<string, string> = {
  印度: "IN", 印尼: "ID", 印度尼西亚: "ID", 越南: "VN", 巴西: "BR", 巴基斯坦: "PK",
  孟加拉: "BD", 孟加拉国: "BD", 菲律宾: "PH", 尼日利亚: "NG", 缅甸: "MM", 马来: "MY",
  马来西亚: "MY", 墨西哥: "MX", 哥伦比亚: "CO", 智利: "CL", 南非: "ZA", 胖虎巴西: "BR",
};

// Exact output labels from the user's Panda collector, not inferred from a
// country or a name prefix. Other Brazilian/Philippine backends stay on AR.
const PANDA_BRAZIL_PLATFORMS = new Set([
  "SSS55", "POPWB", "POPMEL", "POPDEZ", "POPBOA", "BOOMRIO", "POPN1", "POPBIS", "POPFLU",
  "POPVAI", "POPLUZ", "POPBEA", "POPFOI", "POPZOE", "PLAYER BR", "POPSUR", "POPTIG", "POPSEN",
  "POPTAM", "56L", "559K", "2V222", "9596BET", "8599BET", "F75", "KK345", "AA45", "FF555",
  "VIP345", "25RR", "KKVIP", "5V555", "27FF", "58EE", "222O", "32QQ", "TPTP", "67VIP",
  "222VIP", "345F", "POPNOV", "POPFEZ", "POPCRA", "43R", "POPBUL", "234T", "888HH",
  "BET5697", "96F", "45FF", "76PP", "8566BET", "776F",
]);

export function canReadWithdrawReasons(profile: DashboardProfile | null): boolean {
  // Match withdraw_reasons_dashboard_read, including explicit permission for admins.
  return Boolean(profile?.active && (profile.role === "owner" || profile.permissions?.auto_withdraw === true));
}

export function reasonCountryCode(country: string) {
  const value = country.trim();
  const code = COUNTRY_CODES[value] || (/^[a-z]{2}$/i.test(value) ? value.toUpperCase() : "");
  if (!code) throw new Error(`暂未配置「${value}」的原因采集国家，请联系管理员核对。`);
  return code;
}

export function isReasonDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function reasonPercent(count: number, total: number): string {
  return total > 0 ? `${(count / total * 100).toFixed(2)}%` : "—";
}

export function reasonSourceTarget(country: string, platform: string) {
  // These are the two explicitly configured New AR backends. Keep their
  // snapshots separate from AR, and never fuzzy-match similarly named sites.
  const name = platform.trim();
  if (country === "PK" && name.toUpperCase() === "POPZAR") return { source: "NEWAR", platform: "POPZAR" };
  if (country === "IN" && ["DHANI.WIN", "DHANIWIN"].includes(name.toUpperCase())) return { source: "NEWAR", platform: "DHANI.WIN" };
  if ((country === "BR" && PANDA_BRAZIL_PLATFORMS.has(name.toUpperCase()))
    || (country === "PH" && name.toUpperCase() === "PH19")) return { source: "PANDA", platform: name.toUpperCase() };
  return { source: "AR", platform: name };
}

// Fail closed on damaged/partial responses: never show a partial count as a full day.
export function validateReasonsDay(value: unknown): WithdrawReasonsDay {
  const row = value as WithdrawReasonsDay;
  const snapshot = row?.snapshot;
  const t = snapshot?.totals;
  const c = snapshot?.coverage;
  const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
  const fail = () => { throw new Error("原因数据校验失败，请刷新或重新采集；未展示不完整统计。"); };
  if (!snapshot || snapshot.schema_version !== 1 || !t || !c || !Array.isArray(snapshot.groups)
    || !isReasonDate(row.stat_date) || !Number.isFinite(Date.parse(row.updated_at))
    || !Number.isFinite(Date.parse(snapshot.snapshot_at)) || typeof snapshot.timezone !== "string"
    || typeof snapshot.classifier_version !== "string") return fail();
  for (const key of ["total", "auto", "manual", "unknown", "success", "reject", "other"] as const) if (!count(t[key])) return fail();
  if (!c.complete || !count(c.expected_count) || !count(c.unique_count) || !count(c.incomplete_note_count)
    || c.unique_count !== t.total || c.expected_count !== t.total
    || t.auto + t.manual + t.unknown !== t.total || t.success + t.reject + t.other !== t.total) return fail();
  const sums = { total: 0, auto: 0, manual: 0, unknown: 0, success: 0, reject: 0, other: 0, truncated: 0 };
  const seen = new Set<string>();
  for (const g of snapshot.groups) {
    if (!g || !["auto", "manual", "unknown"].includes(g.operator_class)
      || !["template", "empty", "unclassified", "truncated"].includes(g.classification)
      || typeof g.reason_key !== "string" || !g.reason_key || typeof g.reason_label !== "string" || !g.reason_label
      || !Array.isArray(g.samples) || g.samples.some(s => typeof s !== "string")
      || ![g.count, g.success, g.reject, g.other].every(count) || g.success + g.reject + g.other !== g.count) return fail();
    if (g.variants !== undefined && (!Array.isArray(g.variants) || g.variants.length === 0
      || g.variants.some(v => !v || typeof v.reason_label !== "string" || !v.reason_label || !count(v.count))
      || g.variants.reduce((sum, v) => sum + v.count, 0) !== g.count)) return fail();
    const key = `${g.operator_class}:${g.reason_key}`;
    if (seen.has(key)) return fail();
    seen.add(key);
    sums.total += g.count; sums[g.operator_class] += g.count;
    sums.success += g.success; sums.reject += g.reject; sums.other += g.other;
    if (g.classification === "truncated") sums.truncated += g.count;
  }
  for (const key of ["total", "auto", "manual", "unknown", "success", "reject", "other"] as const) if (sums[key] !== t[key]) return fail();
  if (sums.truncated !== c.incomplete_note_count) return fail();
  return row;
}

export async function getAutoWithdrawReasons(
  session: DashboardSession,
  target: { date: string; country: string; platform: string },
  signal?: AbortSignal,
): Promise<WithdrawReasonsDay | null> {
  if (!session?.access_token) throw new Error("请先登录后查看原因统计。");
  if (!isReasonDate(target.date) || !target.platform.trim() || target.platform.length > 80) throw new Error("请选择有效的日期和平台。");
  const country = reasonCountryCode(target.country);
  const { source, platform } = reasonSourceTarget(country, target.platform);
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) throw new Error("原因统计服务尚未配置。");
  // Exact case-insensitive match. Escape LIKE wildcards; never use fuzzy platform matching.
  const query = new URLSearchParams({
    select: "source_system,country_code,platform,stat_date,updated_at,grouping_version,snapshot",
    source_system: `eq.${source}`, country_code: `eq.${country}`, stat_date: `eq.${target.date}`,
    platform: `ilike.${platform.replace(/[\\%_*]/g, "\\$&")}`, limit: "2",
  });
  const response = await fetch(`${url}/rest/v1/withdraw_reasons_daily_grouped?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal,
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new Error("登录已过期，请重新登录后查看原因统计。");
    if (response.status === 403) throw new Error("没有自动出款查看权限，请联系管理员。");
    throw new Error("原因统计读取失败，请稍后刷新；未使用旧缓存代替。");
  }
  if (!Array.isArray(json) || json.length > 1) throw new Error("原因数据存在重复平台或响应异常，请联系管理员核对。");
  if (!json.length) return null;
  const day = validateReasonsDay(json[0]);
  if (day.source_system !== source || day.country_code !== country || day.stat_date !== target.date
    || day.platform.toUpperCase() !== platform.toUpperCase()) throw new Error("原因数据范围不匹配，未展示其他平台的数据。");
  return day;
}
