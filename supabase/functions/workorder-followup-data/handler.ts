export type PortalAccount = { auth_user_id: string; role: string; active: boolean; team: string; platforms: string[] };
export type Gateway = {
  identify(headers: Headers): Promise<unknown>;
  list(account: PortalAccount, filters: Record<string, string>, offset: number, limit: number): Promise<any>;
  mirror(record: Record<string, unknown>): Promise<boolean>;
};
export class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
const fail = (code = 'invalid_request'): never => { throw new ApiError(400, code); };
const object = (value: unknown): Record<string, any> => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, any>; };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const id = (value: unknown) => { if (!uuid(value)) fail('invalid_identifier'); return (value as string).toLowerCase(); };
const outcomes: Record<string, string> = { pending: 'Not Yet Received', success: 'Success', other_id: 'Success To Other ID', other_platform: 'Success To Other Platform', other_order: 'Success To Other Order', over30: 'more than 30days/refund', need_evidence: 'Need to provide PDF/VIDEO', no_refund: 'No refund', over15: 'more than 15days refund', refund: 'REFUND', appeal: 'save account contact appeal', unknown: '' };
const checks = new Set(['yes', 'no', 'unknown']);
const evidence: Record<string, string> = { unknown: '', none: 'NO', pdf: 'PDF', video: 'VIDEO', both: 'PDF/VIDEO' };
const filterKeys = new Set(['platform', 'provider', 'orderNo', 'workorder', 'utr', 'reply', 'outcome', 'creator', 'follower', 'kyc', 'utrMatch', 'from', 'to', 'minAmount', 'maxAmount', 'source', 'staffCode', 'upiId', 'kycUpiId']);
function outcomeText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value) || !value.trim()) fail('invalid_entry');
  return (value as string).trim();
}
function text(value: unknown, max = 200, multiline = false): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail('invalid_field');
  return (value as string).trim();
}
function day(value: unknown): string {
  const s = text(value, 10); if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) fail('invalid_date'); return s;
}
function instant(value: unknown, required = false): string {
  const s = text(value, 40); if (!s && !required) return '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) fail('invalid_date');
  return new Date(s).toISOString();
}
const indiaDay = (value: string) => new Date(Date.parse(value) + 19_800_000).toISOString().slice(0, 10);
function upi(value: unknown, masked = false): string {
  const s = text(value, 200); if (s && s !== '-' && !(masked ? /^[a-zA-Z0-9*][a-zA-Z0-9._*-]{0,127}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/ : /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/).test(s)) fail('invalid_upi'); return s;
}
function receiptFacts(orderNo: unknown, now: number) {
  const m = /^RC(\d{4})(\d{2})(\d{2})/.exec(display(orderNo).trim().toUpperCase());
  const value = m ? `${m[1]}-${m[2]}-${m[3]}` : '', parsed = value ? Date.parse(value + 'T00:00:00Z') : NaN;
  const today = indiaDay(new Date(now).toISOString());
  if (value.startsWith('0000-') || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value || value > today) return { date: '', days: null };
  return { date: value, days: Math.round((Date.parse(today + 'T00:00:00Z') - parsed) / 86400000) };
}
function identifier(value: unknown, required = false): string {
  const s = text(value, 100); if ((!s && required) || s && !/^[a-zA-Z0-9._/-]{1,100}$/.test(s)) fail('invalid_identifier'); return s;
}
function safeNote(value: unknown, max: number): string {
  const s = text(value, max, true);
  if (/@|(?:\d[\s-]*){9,}|银行卡|手机号|UPI\s*(?:ID|账号)/i.test(s)) fail('private_field'); return s;
}
function normalizeIp(value: string): string {
  const s = value.trim().replace(/^::ffff:/i, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s) && s.split('.').every(n => +n <= 255)) return s;
  if (s.includes(':') && s.length <= 64) { try { return new URL('https://[' + s + ']').hostname.slice(1, -1); } catch { /* deny */ } }
  return '';
}
async function forwarded(request: Request, hash: string): Promise<Headers> {
  const key = request.headers.get('x-portal-proxy-key') || '', ip = normalizeIp(request.headers.get('x-portal-client-ip') || '');
  if (!key || key.length > 256 || !ip || !/^[a-f0-9]{64}$/.test(hash)) throw new ApiError(403, 'proxy_denied');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), expected = Uint8Array.from(hash.match(/../g)!, v => parseInt(v, 16));
  let mismatch = 0; for (let i = 0; i < 32; i++) mismatch |= digest[i] ^ expected[i];
  if (mismatch) throw new ApiError(403, 'proxy_denied');
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [^\s,]{1,16384}$/i.test(authorization)) throw new ApiError(401, 'login_required');
  return new Headers({ authorization, 'x-portal-proxy-key': key, 'x-portal-client-ip': ip });
}
function identity(value: unknown): PortalAccount {
  const result = object(value), a = object(result.account), catalog = object(result.catalog), teams = object(catalog.platformTeams);
  if (result.ok !== true || result.identity_kind !== 'workorder' || !uuid(a.auth_user_id) || a.active !== true || !['agent', 'supervisor', 'auditor'].includes(a.role)) throw new ApiError(403, 'account_denied');
  const team = text(a.team, 100);
  if (!team || !Array.isArray(a.platforms) || !a.platforms.length || a.platforms.length > 200 || a.platforms.some((p: unknown) => typeof p !== 'string' || !p || p.length > 100 || teams[p] !== team)) throw new ApiError(403, 'scope_denied');
  return { auth_user_id: a.auth_user_id.toLowerCase(), role: a.role, active: true, team, platforms: [...new Set(a.platforms)] as string[] };
}
function filters(value: unknown, account: PortalAccount): Record<string, string> {
  const raw = object(value ?? {}), result: Record<string, string> = {};
  const allOptions = new Set(['platform', 'provider', 'outcome', 'creator', 'follower', 'kyc', 'utrMatch', 'source']);
  for (const [key, value] of Object.entries(raw)) { if (!filterKeys.has(key) || typeof value !== 'string') fail('invalid_filter'); const v = text(value); if (v && !(v === 'all' && allOptions.has(key))) result[key] = v; }
  if (result.platform && !account.platforms.includes(result.platform)) throw new ApiError(403, 'scope_denied');
  if (result.outcome) result.outcome = outcomeText(result.outcome);
  if (result.kyc && !checks.has(result.kyc) || result.utrMatch && !checks.has(result.utrMatch) || result.source && !['sheet', 'portal'].includes(result.source)) fail('invalid_filter');
  for (const key of ['from', 'to']) if (result[key]) day(result[key]);
  if (result.from && result.to && result.from > result.to) fail('invalid_range');
  for (const key of ['minAmount', 'maxAmount']) if (result[key] && !/^\d{1,12}(?:\.\d{1,2})?$/.test(result[key])) fail('invalid_amount');
  if (result.minAmount && result.maxAmount && Number(result.minAmount) > Number(result.maxAmount)) fail('invalid_range');
  return result;
}
function pagination(value: unknown, fallback: number, max: number, min = 0) { const n = value ?? fallback; if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max) fail('invalid_pagination'); return n as number; }
function entry(value: unknown, now: number) {
  let raw: Record<string, any>;
  try { raw = object(typeof value === 'string' ? JSON.parse(value || '{}') : value ?? {}); } catch { fail('invalid_entry'); }
  const defaults = { upiId: '', kycUpiId: '', utr: '', kycCheck: 'unknown', utrMatch: 'unknown', providerReply: '', outcome: 'unknown', documentType: 'unknown', followedAt: '', orderDate: '' };
  if (Object.keys(raw!).some(k => !Object.hasOwn(defaults, k))) fail('invalid_entry');
  const e = { ...defaults, ...raw! };
  if (Object.values(e).some(v => typeof v !== 'string') || !checks.has(e.kycCheck) || !checks.has(e.utrMatch) || !Object.hasOwn(evidence, e.documentType)) fail('invalid_entry');
  e.outcome = outcomeText(e.outcome);
  e.upiId = upi(e.upiId); e.kycUpiId = upi(e.kycUpiId, true); e.utr = identifier(e.utr); e.providerReply = safeNote(e.providerReply, 2000); e.followedAt = instant(e.followedAt); e.orderDate = ''; // Derived from the case order number below, never a client date.
  if (e.followedAt && Date.parse(e.followedAt) > now + 60000 || e.orderDate && e.orderDate > indiaDay(new Date(now).toISOString())) fail('invalid_date');
  return e;
}
export function mirrorRecord(value: unknown, account: PortalAccount, now: number): Record<string, unknown> {
  if (account.role === 'auditor') throw new ApiError(403, 'read_only');
  const r = object(value), allowed = new Set(['id', 'source', 'country', 'team', 'platform', 'order_no', 'amount_cents', 'currency', 'provider', 'status', 'owner_id', 'created_by', 'created_by_name', 'last_follow_actor_name', 'last_follow_actor_id', 'created_at', 'updated_at', 'due_at', 'version', 'reason', 'entry_json', 'workorders', 'backend_processed']);
  if (Object.keys(r).some(k => !allowed.has(k))) fail('invalid_field');
  const caseId = id(r.id), ownerId = id(r.owner_id), createdBy = id(r.created_by), team = text(r.team, 100), platform = text(r.platform, 100);
  if (team !== account.team || !account.platforms.includes(platform) || account.role === 'agent' && ownerId !== account.auth_user_id) throw new ApiError(403, 'scope_denied');
  if (r.country !== 'IN' || r.currency !== 'INR') fail('invalid_currency');
  if (!Number.isSafeInteger(r.amount_cents) || r.amount_cents <= 0 || r.amount_cents > 999999999999) fail('invalid_amount');
  if (!Number.isSafeInteger(r.version) || r.version < 1 || r.version > 2147483647) fail('invalid_version');
  const createdAt = instant(r.created_at, true), updatedAt = instant(r.updated_at, true), dueAt = instant(r.due_at);
  if (createdAt > updatedAt || Date.parse(updatedAt) > now + 60000) fail('invalid_date');
  if (!['open', 'waiting', 'material', 'review', 'closed'].includes(r.status)) fail('invalid_status');
  if (!Array.isArray(r.workorders) || r.workorders.length > 100) fail('invalid_workorders');
  const workorders = [...new Set(r.workorders.map((v: unknown) => identifier(v, true)))];
  const e = entry(r.entry_json, now), creator = text(r.created_by_name, 100), follower = text(r.last_follow_actor_name, 100);
  const receipt = receiptFacts(r.order_no, now); e.orderDate = receipt.date;
  const payload = { id: caseId, source: text(r.source, 100), country: 'IN', currency: 'INR', team, platform, order_no: identifier(r.order_no, true), amount_cents: r.amount_cents, provider: text(r.provider, 100), status: r.status, owner_id: ownerId, created_by: createdBy, created_by_name: creator, last_follow_actor_name: follower, last_follow_actor_id: r.last_follow_actor_id ? id(r.last_follow_actor_id) : null, created_at: createdAt, updated_at: updatedAt, due_at: dueAt || null, version: r.version, reason: safeNote(r.reason, 1000), workorders, entry: e };

  return { id: 'PORTAL:' + caseId, source_sheet: 'PORTAL', source_tab: caseId, source_row: 1, source_kind: 'portal', portal_case_id: caseId, portal_owner_id: ownerId, portal_team: team, portal_version: r.version, portal_payload: payload, country: '印度', platform, order_number: payload.order_no, work_order_number: workorders.join(' / ') || null, utr: e.utr || null, upi_id: e.upiId || null, kyc_upi_id: e.kycUpiId || null, amount: r.amount_cents / 100, provider: payload.provider || null, provider_reply: e.providerReply || null, followup_status: Object.hasOwn(outcomes, e.outcome) ? outcomes[e.outcome] : e.outcome, kyc_correct: e.kycCheck, utr_match: e.utrMatch, evidence: evidence[e.documentType], followup_at: e.followedAt || null, followup_date: indiaDay(e.followedAt || createdAt), receipt_text: receipt.date || null, first_actor: creator || null, last_actor: follower || null, source_updated_at: updatedAt, updated_at: new Date(now).toISOString() };
}
const display = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : String(value);
function normalizeRow(r: Record<string, any>, account: PortalAccount, now: number) {
  const portal = r.source_kind === 'portal', platform = display(r.display_platform || r.platform), payload = portal ? object(r.portal_payload) : {}, e = portal ? object(payload.entry ?? {}) : {};
  if (!['portal', 'sheet'].includes(r.source_kind) || !account.platforms.includes(platform) || portal && (r.portal_team !== account.team || account.role === 'agent' && r.portal_owner_id !== account.auth_user_id)) throw new ApiError(503, 'invalid_scope_response');
  const rawAmount = r.amount, amount = rawAmount === null || rawAmount === undefined || rawAmount === '' ? null : Number(rawAmount);
  if (amount !== null && !Number.isFinite(amount)) throw new ApiError(503, 'invalid_response');
  const receipt = receiptFacts(r.order_number, now);
  return { id: display(r.id), source: portal ? 'portal' : 'sheet', readOnly: !portal || account.role === 'auditor', portalCaseId: portal ? display(r.portal_case_id) : null, team: account.team, platform, orderNo: display(r.order_number), workorders: portal ? (Array.isArray(payload.workorders) ? payload.workorders.filter((v: unknown) => typeof v === 'string') : []) : r.work_order_number ? [display(r.work_order_number)] : [], utr: display(r.utr), upiId: display(r.upi_id), kycUpiId: display(r.kyc_upi_id), amount, provider: display(r.provider), kyc: checks.has(r.normalized_kyc) ? r.normalized_kyc : 'unknown', utrMatch: checks.has(r.normalized_utr) ? r.normalized_utr : 'unknown', reply: display(r.provider_reply), outcome: typeof r.normalized_outcome === 'string' && r.normalized_outcome.trim() && r.normalized_outcome.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(r.normalized_outcome) ? r.normalized_outcome : 'unknown', orderDate: receipt.date, daysSinceOrder: receipt.days, followedAt: display(r.followup_at), creator: portal ? display(r.first_actor) : '', follower: portal ? display(r.last_actor) : '', createdAt: portal ? display(payload.created_at) : '', updatedAt: display(r.source_updated_at || r.updated_at), sourceSheet: portal ? null : display(r.source_sheet), sourceTab: portal ? null : display(r.source_tab), sourceRow: portal ? null : r.source_row, rawFields: { staffCode: display(r.staff_code), followupStatus: display(r.followup_status), evidence: display(r.evidence), receiptText: display(r.receipt_text), sourceDateText: display(r.source_date_text) }, ownerId: portal ? display(r.portal_owner_id) : null, version: portal ? r.portal_version : undefined };
}
export function createWorkorderFollowupHandler(gateway: Gateway, options: { proxyKeySha256: string; now?: () => number }) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
    if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
    // This endpoint is only called by the Worker. Never grant browser CORS.
    if (request.headers.has('origin')) return json({ ok: false, code: 'origin_denied' }, 403);
    try {
      const authHeaders = await forwarded(request, options.proxyKeySha256);
      const size = Number(request.headers.get('content-length') || 0); if (size > 65536) fail('request_too_large');
      const reader = request.body?.getReader(); if (!reader) fail();
      let count = 0, raw = ''; const decoder = new TextDecoder();
      while (true) { const { done, value } = await reader!.read(); if (done) break; count += value.length; if (count > 65536) { await reader!.cancel(); fail('request_too_large'); } raw += decoder.decode(value, { stream: true }); } raw += decoder.decode();
      let body: Record<string, any>; try { body = object(JSON.parse(raw)); } catch { fail(); }
      if (!['list', 'mirror'].includes(body!.action) || Object.keys(body!).some(k => !(body!.action === 'list' ? ['action', 'filters', 'offset', 'limit'] : ['action', 'record']).includes(k))) fail();
      const account = identity(await gateway.identify(authHeaders));
      if (body!.action === 'mirror') { const record = mirrorRecord(body!.record, account, (options.now ?? Date.now)()); if (await gateway.mirror(record) !== true) throw new ApiError(503, 'mirror_failed'); return json({ ok: true, id: record.id }); }
      const query = filters(body!.filters, account), offset = pagination(body!.offset, 0, 1000000), limit = pagination(body!.limit, 50, 100, 1), result = await gateway.list(account, query, offset, limit);
      if (!result || !Array.isArray(result.rows) || result.rows.length > limit || !Number.isSafeInteger(result.total) || result.total < 0) throw new ApiError(503, 'invalid_response');
      const rows = result.rows.map((r: unknown) => normalizeRow(object(r), account, (options.now ?? Date.now)()));
      const facets: Record<string, string[]> = {};
      for (const key of ['platforms', 'providers', 'creators', 'followers']) facets[key] = [...new Set((Array.isArray(result.facets?.[key]) ? result.facets[key] : []).filter((v: unknown) => typeof v === 'string' && v.length <= 200 && (key !== 'platforms' || account.platforms.includes(v))))] as string[];
      return json({ ok: true, rows, total: result.total, facets, offset, limit });
    } catch (error) { return error instanceof ApiError ? json({ ok: false, code: error.code }, error.status) : json({ ok: false, code: 'service_unavailable' }, 503); }
  };
}
