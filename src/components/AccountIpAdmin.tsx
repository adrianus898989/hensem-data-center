"use client";
import { useEffect, useRef, useState } from "react";
import type { DashboardSession } from "@/lib/dashboardAuthClient";
import { securityRequest, type AccountSurface, type IpAccount, type IpRule, type SecurityCapabilities, type SecurityPolicy } from "@/lib/accountSecurityClient";
import AccountEditorDialog from "./AccountEditorDialog";
import "./AccountIpAdmin.css";

type Filters = { ip: string; account: string; status: string };
const emptyFilters: Filters = { ip: "", account: "", status: "all" };
const validVersion = (value: unknown) => Number.isInteger(value) && Number(value) >= 1;
const readOnly: SecurityCapabilities = { view: false, manage_global: false, manage_account: false, manage_policy: false };
function validList(policy: SecurityPolicy | undefined, rules: IpRule[] | undefined, accounts: IpAccount[] | undefined, caps: SecurityCapabilities | undefined, surface: AccountSurface) {
  return !!policy && Number.isInteger(policy.failure_limit) && policy.failure_limit >= 1 && policy.failure_limit <= 20 && typeof policy.ip_enabled === "boolean" && validVersion(policy.version) && (surface !== "dashboard" || policy.ip_enabled) &&
    !!caps && ["view", "manage_global", "manage_account", "manage_policy"].every(key => typeof caps[key as keyof SecurityCapabilities] === "boolean") && caps.view &&
    Array.isArray(accounts) && accounts.every(row => row && typeof row.id === "string" && !!row.id && typeof row.username === "string" && !!row.username && typeof row.active === "boolean" && ["inherit", "allowlist"].includes(row.ip_mode) && validVersion(row.version)) && new Set(accounts.map(row => row.id)).size === accounts.length &&
    Array.isArray(rules) && rules.every(row => row && ["number", "string"].includes(typeof row.id) && !!String(row.id) && typeof row.network === "string" && !!row.network && typeof row.note === "string" && typeof row.active === "boolean" && validVersion(row.version) &&
      (row.scope === "global" ? row.user_id === null && row.username === null : row.scope === "account" && typeof row.user_id === "string" && !!row.user_id && typeof row.username === "string" && !!row.username && ["inherit", "allowlist"].includes(row.ip_mode || "")) &&
      (row.updated_by === null || typeof row.updated_by === "string") && (row.updated_at === null || typeof row.updated_at === "string")) && new Set(rules.map(row => `${row.scope}:${row.id}`)).size === rules.length;
}
function modificationTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}
export default function AccountIpAdmin({ session }: { session: DashboardSession }) {
  const sessionRef = useRef(session); sessionRef.current = session;
  const [surface, setSurface] = useState<AccountSurface>("dashboard");
  const [rows, setRows] = useState<IpRule[]>([]), [accounts, setAccounts] = useState<IpAccount[]>([]), [capabilities, setCapabilities] = useState<SecurityCapabilities>(readOnly);
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null), [currentIp, setCurrentIp] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState(emptyFilters), [draftFilters, setDraftFilters] = useState(emptyFilters), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [editor, setEditor] = useState<IpRule | "new" | null>(null), [network, setNetwork] = useState(""), [note, setNote] = useState(""), [accountId, setAccountId] = useState(""), [active, setActive] = useState(true);
  const [confirm, setConfirm] = useState<{ kind: "mode" } | { kind: "delete"; rule: IpRule } | null>(null);
  const contextRef = useRef(""); contextRef.current = session.user.id + "|" + surface;
  const label = surface === "workorder" ? "前端工单" : "后台";
  const canWrite = (row: IpRule) => row.scope === "global" ? capabilities.manage_global === true : capabilities.manage_account === true;
  const canAdd = capabilities.manage_global === true || capabilities.manage_account === true && accounts.length > 0;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setPolicy(null); setRows([]); setAccounts([]); setCapabilities(readOnly); setCurrentIp(""); setError("");
    securityRequest(sessionRef.current, { action: "list-rules", surface }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (!validList(result.policy, result.rules, result.accounts, result.capabilities, surface)) throw Error("白名单返回不完整，请刷新重试");
      setPolicy(result.policy!); setRows(result.rules!); setAccounts(result.accounts!); setCapabilities(result.capabilities!); setCurrentIp(result.currentIp || "");
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取白名单失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [surface, revision, session.user.id]);
  function switchSurface(next: AccountSurface) {
    if (busy || next === surface) return;
    setLoading(true); setPolicy(null); setRows([]); setAccounts([]); setCapabilities(readOnly); setCurrentIp(""); setError(""); setSurface(next); setEditor(null); setConfirm(null); setFilters(emptyFilters); setDraftFilters(emptyFilters); setPage(1); setMessage("");
  }
  function edit(row: IpRule | "new") {
    if (loading || busy || (row === "new" ? !canAdd : !canWrite(row))) return;
    setEditor(row); setNetwork(row === "new" ? "" : row.network); setNote(row === "new" ? "" : row.note); setActive(row === "new" ? true : row.active); setAccountId(row === "new" ? (capabilities.manage_global ? "" : accounts[0]?.id || "") : row.user_id || ""); setError("");
  }
  async function mutate(body: Record<string, unknown> & { action: string }, done: string) {
    if (busy || loading) return;
    if (body.action === "policy" && (!capabilities.manage_global || surface === "dashboard" && (body.patch as { ip_enabled?: boolean } | undefined)?.ip_enabled === false)) { setError("无权修改此登录限制"); return; }
    if (body.action !== "policy" && !(body.scope === "global" ? capabilities.manage_global : capabilities.manage_account)) { setError("无权修改此白名单规则"); return; }
    const operationContext = contextRef.current;
    setBusy(true); setError(""); setMessage("");
    try { await securityRequest(sessionRef.current, { ...body, surface }); if (contextRef.current !== operationContext) return; setEditor(null); setConfirm(null); setMessage(done); setRevision(n => n + 1); }
    catch (e) { if (contextRef.current === operationContext) setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  function ruleRequest(row: IpRule) { return { scope: row.scope, ...(row.user_id ? { user_id: row.user_id } : {}), id: row.id, expected_version: row.version }; }
  function save(event: React.FormEvent) {
    event.preventDefault(); if (!editor || !network.trim()) return;
    const account = accounts.find(row => row.id === accountId);
    if (accountId && !account) { setError("绑定账号已不可用，请重新读取白名单"); return; }
    if (editor !== "new" && accountId !== (editor.user_id || "")) { setError("已有规则不能更换绑定账号，请新增正确规则后移除原规则"); return; }
    void mutate({ action: "upsert-ip-rule", network: network.trim(), note: note.trim(), active, ...(editor === "new" ? { scope: accountId ? "account" : "global", ...(account ? { user_id: account.id, expected_version: account.version } : {}) } : ruleRequest(editor)) }, accountId ? "账号 IP 规则已保存；该账号按专属启用 IP 验证" : "不限账号 IP 规则已保存");
  }
  const visible = rows.filter(row => (filters.status === "all" || (filters.status === "active") === row.active) && [row.network, row.note].join(" ").toLowerCase().includes(filters.ip.trim().toLowerCase()) && (row.username || "不限账号").toLowerCase().includes(filters.account.trim().toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize)), currentPage = Math.min(page, totalPages), shown = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return <div className="account-ip-admin">
    <div role="tablist" aria-label="IP 白名单入口" className="owner-preview-account-tabs">{(["workorder", "dashboard"] as const).map(value => <button key={value} type="button" role="tab" aria-selected={surface === value} disabled={busy} onClick={() => switchSurface(value)}>{value === "workorder" ? "前端工单白名单" : "后台白名单"}</button>)}</div>
    <section className="account-ip-policy"><div><h3>{label} IP 白名单</h3><p>当前 IP：<b>{loading ? "读取中" : currentIp || "未取得"}</b></p></div><div><span className={policy?.ip_enabled ? "ip-enabled" : "ip-off"}>{policy ? (policy.ip_enabled ? "已开启白名单" : "未开启白名单") : "待读取"}</span>{surface === "workorder" && capabilities.manage_global && <button type="button" disabled={busy || loading || !policy} onClick={() => { setError(""); setConfirm({ kind: "mode" }); }}>{policy?.ip_enabled ? "关闭限制" : "开启限制"}</button>}</div></section>
    <p className="account-ip-explanation"><b>不指定账号＝不限账号：</b>允许此 IP 打开入口，登录仍需有效账号及权限。<b>指定账号：</b>仅允许该账号从其专属启用 IP 登录；保存后采用独立白名单。</p>
    <form className="account-ip-toolbar" onSubmit={event => { event.preventDefault(); setFilters(draftFilters); setPage(1); }}><label>IP / 备注<input aria-label="搜索 IP 或备注" value={draftFilters.ip} onChange={e => setDraftFilters(value => ({ ...value, ip: e.target.value }))} placeholder="IP、网段或备注" /></label><label>账号<input aria-label="搜索绑定账号" value={draftFilters.account} onChange={e => setDraftFilters(value => ({ ...value, account: e.target.value }))} placeholder="账号或不限账号" /></label><label>状态<select aria-label="IP 规则状态" value={draftFilters.status} onChange={e => setDraftFilters(value => ({ ...value, status: e.target.value }))}><option value="all">全部状态</option><option value="active">启用</option><option value="inactive">停用</option></select></label><button type="submit" disabled={loading}>查询</button><button type="button" disabled={loading} onClick={() => { setFilters(emptyFilters); setDraftFilters(emptyFilters); setPage(1); }}>重置</button><button type="button" disabled={busy || loading} onClick={() => setRevision(n => n + 1)}>刷新</button>{canAdd && <button className="primary" type="button" disabled={busy || loading || !policy} onClick={() => edit("new")}>新增 IP</button>}</form>
    {error && !editor && !confirm && <p role="alert" className="ip-error">{error}</p>}{message && <p role="status" className="ip-success">{message}</p>}
    <div className="account-ip-table"><table><thead><tr><th>IP / CIDR</th><th>绑定账号</th><th>状态</th><th>备注</th><th>修改人</th><th>修改时间</th><th>操作</th></tr></thead><tbody>{shown.map(row => <tr key={`${row.scope}:${row.id}`}><td className="ip-network">{row.network}</td><td>{row.scope === "global" ? <span className="ip-global-account">不限账号</span> : <><b>{row.username}</b><small className={row.ip_mode === "allowlist" ? "ip-enabled" : "ip-off"}>{row.ip_mode === "allowlist" ? "独立白名单" : "未生效 · 跟随全局"}</small></>}</td><td><span className={row.active ? "ip-enabled" : "ip-off"}>{row.active ? "启用" : "停用"}</span></td><td>{row.note || "—"}</td><td>{row.updated_by || "—"}</td><td className="ip-time">{modificationTime(row.updated_at)}</td><td>{canWrite(row) ? <div className="ip-row-actions"><button type="button" disabled={busy || loading} onClick={() => edit(row)}>编辑</button><button type="button" disabled={busy || loading} onClick={() => void mutate({ action: "set-ip-rule-active", ...ruleRequest(row), active: !row.active }, row.active ? "IP 规则已停用" : "IP 规则已启用")}>{row.active ? "停用" : "启用"}</button><button className="danger" type="button" disabled={busy || loading} onClick={() => { setError(""); setConfirm({ kind: "delete", rule: row }); }}>删除</button></div> : <span className="ip-off">只读</span>}</td></tr>)}</tbody></table>{!shown.length && <div className="ip-empty">{loading ? "正在读取白名单…" : !policy ? "未取得白名单，请刷新重试" : rows.length ? "没有符合条件的规则" : "尚未添加 IP 规则"}</div>}</div>
    <div className="account-ip-pagination"><span>共 {visible.length} 条{visible.length !== rows.length ? ` / 全部 ${rows.length} 条` : ""}</span><label>每页<select aria-label="白名单每页条数" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{[10, 20, 50].map(size => <option key={size} value={size}>{size} 条</option>)}</select></label><button type="button" disabled={currentPage <= 1 || loading} onClick={() => setPage(n => n - 1)}>上一页</button><span>{currentPage} / {totalPages}</span><button type="button" disabled={currentPage >= totalPages || loading} onClick={() => setPage(n => n + 1)}>下一页</button></div>
    <p className="ip-footnote">支持 IPv4、IPv6 与 CIDR；修改时间按当前设备时区展示。停用或删除会立即影响对应登录会话；修改人和时间来自服务端记录。</p>
    {editor && <AccountEditorDialog title={(editor === "new" ? "新增" : "编辑") + label + " IP"} busy={busy} onClose={() => setEditor(null)} bodyClassName="account-ip-admin"><form onSubmit={save}><fieldset disabled={busy}><div className="account-ip-editor-fields"><label>IP / CIDR<input required maxLength={64} autoComplete="off" value={network} onChange={e => setNetwork(e.target.value)} placeholder="例如 203.0.113.8 或 203.0.113.0/24" /></label><label>绑定账号<select aria-label="绑定账号" value={accountId} disabled={editor !== "new"} onChange={e => setAccountId(e.target.value)}><option value="" disabled={!capabilities.manage_global}>不指定账号（不限账号）</option>{accounts.map(account => <option key={account.id} value={account.id} disabled={!capabilities.manage_account}>{account.username}{account.active ? "" : "（停用）"}</option>)}</select></label></div>{currentIp && <button type="button" onClick={() => setNetwork(currentIp)}>填入当前 IP</button>}<p className="account-ip-binding-note">{accountId ? "保存后，该账号仅允许从其全部专属启用 IP 登录，全局不限账号规则不替代账号限制。" : "此 IP 可以打开入口；所有账号仍需通过账号、密码及权限验证。"}</p><label>备注<input maxLength={100} value={note} onChange={e => setNote(e.target.value)} placeholder="例如办公室" /></label><label className="ip-checkbox"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />启用此规则</label>{error && <p role="alert" className="ip-error">{error}</p>}<footer><button type="button" onClick={() => setEditor(null)}>取消</button><button type="submit" className="primary">保存</button></footer></fieldset></form></AccountEditorDialog>}
    {confirm && <AccountEditorDialog title={confirm.kind === "delete" ? "删除 IP 规则" : `${policy?.ip_enabled ? "关闭" : "开启"}${label}白名单`} busy={busy} onClose={() => setConfirm(null)} bodyClassName="account-ip-admin"><p>{confirm.kind === "delete" ? `删除 ${confirm.rule.network}（${confirm.rule.username || "不限账号"}）？此规则允许的访问与对应会话将受影响。` : policy?.ip_enabled ? `${label}登录将不再限制来源 IP，账号与密码验证仍然生效。` : `仅允许启用规则内的 IP 打开和登录${label}。`}</p>{error && <p role="alert" className="ip-error">{error}</p>}<footer><button type="button" disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="primary" type="button" disabled={busy || !policy} onClick={() => void (confirm.kind === "delete" ? mutate({ action: "delete-ip-rule", ...ruleRequest(confirm.rule) }, "IP 规则已删除") : mutate({ action: "policy", patch: { ip_enabled: !policy!.ip_enabled }, expected_version: policy!.version }, "登录限制已更新"))}>确认</button></footer></AccountEditorDialog>}
  </div>;
}
