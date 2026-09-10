"use client";

import type { DashboardSession } from "./dashboardAuthClient";

export type AutoWithdrawNote = {
  data_date: string;
  country: string;
  platform: string;
  reason: string;
  updated_by: string;
  updated_by_name: string;
  updated_at: string;
};

const COLUMNS = "data_date,country,platform,reason,updated_by,updated_by_name,updated_at";

function requestConfig(session: DashboardSession) {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) throw new Error("备注服务尚未配置");
  if (!session?.access_token) throw new Error("请先登录后查看或填写备注");
  return {
    url: `${url}/rest/v1/auto_withdraw_notes`,
    headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
  };
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function readNotesResponse(response: Response): Promise<AutoWithdrawNote[]> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new Error("登录已过期，请重新登录后保存备注");
    if (response.status === 403) throw new Error("没有备注编辑权限，请联系管理员确认账号的自动出款权限");
    throw new Error(json?.message || "备注读取或保存失败，请重试");
  }
  if (!Array.isArray(json)) throw new Error("备注服务返回格式异常");
  return json as AutoWithdrawNote[];
}

export async function listAutoWithdrawNotes(session: DashboardSession, start: string, end: string): Promise<AutoWithdrawNote[]> {
  if (!isDate(start) || !isDate(end) || start > end) throw new Error("请选择有效的备注日期区间");
  const { url, headers } = requestConfig(session);
  const all: AutoWithdrawNote[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({ select: COLUMNS, order: "data_date.asc,country.asc,platform.asc", limit: String(pageSize), offset: String(offset) });
    query.append("data_date", `gte.${start}`);
    query.append("data_date", `lte.${end}`);
    const page = await readNotesResponse(await fetch(`${url}?${query}`, { headers, cache: "no-store" }));
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

export async function saveAutoWithdrawNote(
  session: DashboardSession,
  input: { date: string; country: string; platform: string; reason: string },
): Promise<AutoWithdrawNote> {
  const country = input.country.trim();
  const platform = input.platform.trim();
  const reason = input.reason.trim();
  if (!isDate(input.date) || !country || !platform) throw new Error("请指定备注日期、国家和平台");
  if (reason.length > 1000) throw new Error("备注不能超过 1000 字");
  const { url, headers } = requestConfig(session);
  const query = new URLSearchParams({ on_conflict: "data_date,country,platform", select: COLUMNS });
  const rows = await readNotesResponse(await fetch(`${url}?${query}`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
    // Author and timestamp are stamped by the database, not trusted from the browser.
    body: JSON.stringify({ data_date: input.date, country, platform, reason }),
    cache: "no-store",
  }));
  if (rows.length !== 1) throw new Error("备注没有保存成功，请重试");
  return rows[0];
}
