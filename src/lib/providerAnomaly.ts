/** Rules are advisory, not an instruction to change payment routing. */
export type RiskState = "normal" | "warning" | "critical" | "unknown" | "exempt";
export type RiskThresholds = {
  version: 1; minSample: number; minCoveragePercent: number; maxAgeHours: number;
  delayWarningMinutes: number; delayCriticalMinutes: number;
  rateWarningPercent: number; rateCriticalPercent: number;
  rateWarningDays: number; rateCriticalDays: number;
  shareWarningPercent: number; shareCriticalPercent: number;
  pendingWarningCount: number; pendingCriticalCount: number;
  pendingWarningAgeDays: number; pendingCriticalAgeDays: number;
};
export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  version: 1, minSample: 100, minCoveragePercent: 95, maxAgeHours: 36,
  delayWarningMinutes: 10, delayCriticalMinutes: 30,
  rateWarningPercent: 50, rateCriticalPercent: 30, rateWarningDays: 2, rateCriticalDays: 3,
  shareWarningPercent: 35, shareCriticalPercent: 50,
  pendingWarningCount: 20, pendingCriticalCount: 100, pendingWarningAgeDays: 2, pendingCriticalAgeDays: 3,
};
export const RISK_LABELS: Record<RiskState,string> = {
  normal: "🟢 正常 / 可加量", warning: "🟡 控量 / 调整分量", critical: "🔴 减量 / 暂停", unknown: "⚪ 无法判断", exempt: "— 此项豁免",
};
export function validateRiskThresholds(value: unknown): RiskThresholds {
  if (!value || typeof value !== "object" || (value as RiskThresholds).version !== 1) throw new Error("阈值版本不兼容，请恢复参考值。");
  const v = value as RiskThresholds;
  for (const key of Object.keys(DEFAULT_RISK_THRESHOLDS) as Array<keyof RiskThresholds>) {
    if (typeof v[key] !== "number" || !Number.isFinite(v[key]) || v[key] <= 0) throw new Error("所有阈值必须填写大于 0 的有效数字。");
  }
  for (const key of ["minSample","rateWarningDays","rateCriticalDays","pendingWarningCount","pendingCriticalCount","pendingWarningAgeDays","pendingCriticalAgeDays"] as const) {
    if (!Number.isSafeInteger(v[key])) throw new Error("样本、天数和笔数须为正整数。");
  }
  if (v.minCoveragePercent > 100 || v.rateWarningPercent > 100 || v.shareCriticalPercent > 100) throw new Error("比例不得超过 100%。");
  if (v.rateCriticalPercent >= v.rateWarningPercent || v.delayWarningMinutes >= v.delayCriticalMinutes || v.shareWarningPercent >= v.shareCriticalPercent || v.pendingWarningCount >= v.pendingCriticalCount || v.rateWarningDays > v.rateCriticalDays || v.pendingWarningAgeDays > v.pendingCriticalAgeDays) throw new Error("预警与严重阈值的顺序不正确。");
  if (v.rateCriticalDays > 31 || v.maxAgeHours > 8760 || v.minSample > 1e9) throw new Error("阈值超出允许范围。");
  return Object.fromEntries(Object.keys(DEFAULT_RISK_THRESHOLDS).map(key=>[key,v[key as keyof RiskThresholds]])) as RiskThresholds;
}
export function riskSettingsKey(owner: string): string { return `hensem.provider-risk.v1:${owner}`; }
export function readRiskSettings(text: string | null): RiskThresholds {
  if (!text) return {...DEFAULT_RISK_THRESHOLDS};
  try { return validateRiskThresholds(JSON.parse(text)); } catch { return {...DEFAULT_RISK_THRESHOLDS}; }
}
export type MetricEvidence = {coverage: number | null; latestAt: string | null};
export type RiskDay = MetricEvidence & {date: string; total: number | null; success: number | null};
export type DelayBucket = {minSeconds: number; maxSeconds: number | null; count: number};
export type MidnightEvidence = MetricEvidence & {date: string; count: number | null; amount: number | null; maxAgeDays: number | null; verified: boolean; continuityVerified?: boolean; ageBuckets?: Array<{minDays:number;maxDays:number|null;count:number;amount:number}>};
export type RiskSource = {
  key: string; country: string; platform: string; timezone: string; currency: string;
  canonicalProvider: string; provider: string;
  delay: (MetricEvidence & {sample: number | null; p95Seconds: number | null; buckets?: DelayBucket[]}) | null;
  successDays: RiskDay[];
  share: (MetricEvidence & {sample: number | null; providerAmount: number | null; totalAmount: number | null; denominatorKey: string}) | null;
  midnight: MidnightEvidence | null; midnightDays?: MidnightEvidence[];
};
export type RiskMetric = {key: "delay" | "rate" | "share" | "midnight"; label: string; state: RiskState; value: string; detail: string};
export type ProviderRisk = {key: string; provider: string; currency: string; sources: RiskSource[]; metrics: RiskMetric[]; state: RiskState; score: number | null; incomplete: boolean};
const validNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
function evidenceIssue(e: MetricEvidence | null, t: RiskThresholds, now: number): string | null {
  if (!e || !validNumber(e.coverage) || e.coverage > 1) return "没有已核验采集覆盖率";
  if (e.coverage * 100 < t.minCoveragePercent) return "采集覆盖不足";
  const at = e.latestAt ? Date.parse(e.latestAt) : NaN;
  if (!Number.isFinite(at) || at > now + 300000 || now - at > t.maxAgeHours * 3600000) return "同步时间缺失或已过期";
  return null;
}
function severity(value: number, warning: number, critical: number): RiskState { return value >= critical ? "critical" : value >= warning ? "warning" : "normal"; }
function metric(key: RiskMetric["key"], label: string, state: RiskState, value: string, detail: string): RiskMetric { return {key,label,state,value,detail}; }
function unknown(key: RiskMetric["key"], label: string, reason: string): RiskMetric { return metric(key,label,"unknown","—",reason); }
export function scoreProvider(sources: RiskSource[], t: RiskThresholds, now = Date.now()): ProviderRisk {
  validateRiskThresholds(t);
  if (!sources.length) throw new Error("不能对空三方来源评分。");
  const provider = sources[0].canonicalProvider, currency = sources[0].currency;
  if (sources.some(s=>s.canonicalProvider !== provider || s.currency !== currency)) throw new Error("不同三方或币种不可合并评分。");
  const labels = {delay:"创建至成功耗时",rate:"持续低代收成功率",share:"区间代收金额占比",midnight:"零点未完成代付"};
  const metrics: RiskMetric[] = [];
  const delayIssue = sources.map(s=>evidenceIssue(s.delay,t,now) || (!s.delay || !validNumber(s.delay.sample) ? "成功耗时样本缺失" : !validNumber(s.delay.p95Seconds) && !s.delay.buckets?.length ? "缺少成功耗时分布" : null)).find(Boolean);
  if (delayIssue) metrics.push(unknown("delay",labels.delay,delayIssue));
  else if (sources.reduce((n,s)=>n+s.delay!.sample!,0) < t.minSample) metrics.push(unknown("delay",labels.delay,"成功耗时样本不足"));
  else if (sources.every(s=>s.delay!.buckets?.length)) {
    const combined = new Map<string,DelayBucket>(); let invalid = false;
    const boundaryKey = (b:DelayBucket) => `${b.minSeconds}:${b.maxSeconds}`;
    const firstBounds = sources[0].delay!.buckets!.map(boundaryKey).join("|");
    for (const source of sources) {
      const buckets=source.delay!.buckets!;
      if(buckets.map(boundaryKey).join("|")!==firstBounds || buckets.reduce((n,b)=>n+b.count,0)!==source.delay!.sample)invalid=true;
      for(let i=0;i<buckets.length;i++) {
        const b=buckets[i];
        if(!validNumber(b.minSeconds)||!Number.isSafeInteger(b.count)||b.count<0||b.maxSeconds!==null&&(!validNumber(b.maxSeconds)||b.maxSeconds<=b.minSeconds)||i>0&&buckets[i-1].maxSeconds!==b.minSeconds)invalid=true;
        const k=boundaryKey(b);combined.set(k,{...b,count:(combined.get(k)?.count||0)+b.count});
      }
    }
    const sample=sources.reduce((n,s)=>n+s.delay!.sample!,0);let cumulative=0;
    const bucket=[...combined.values()].find(b=>(cumulative+=b.count)>=Math.ceil(sample*.95));
    if(invalid || !bucket)metrics.push(unknown("delay",labels.delay,"耗时分桶不完整或边界不一致"));
    else {
      const low=bucket.minSeconds/60, high=bucket.maxSeconds===null?null:bucket.maxSeconds/60;
      const state:RiskState=low>=t.delayCriticalMinutes?"critical":low>=t.delayWarningMinutes && high!==null&&high<=t.delayCriticalMinutes?"warning":high!==null&&high<=t.delayWarningMinutes?"normal":"unknown";
      metrics.push(metric("delay",labels.delay,state,`P95 ${low}—${high??"∞"} 分钟`,`${sample} 个成功订单，合并耗时分桶。${state==="unknown"?"分桶跨越阈值，不能精确判断。":""}支付时间未接入，不能据此判定掉单。`));
    }
  }
  else if (!sources.every(s=>validNumber(s.delay!.p95Seconds))) metrics.push(unknown("delay",labels.delay,"耗时统计口径不一致"));
  else {
    // Percentiles cannot be averaged. Use the worst source P95 and label it.
    const seconds = Math.max(...sources.map(s=>s.delay!.p95Seconds!));
    metrics.push(metric("delay",labels.delay,severity(seconds/60,t.delayWarningMinutes,t.delayCriticalMinutes),`${(seconds/60).toFixed(1)} 分钟`,"来源中最高 P95；支付时间未接入，不代表支付后回调耗时，不能据此判定掉单。"));
  }
  const allDates = [...new Set(sources.flatMap(s=>s.successDays.map(d=>d.date)))].sort();
  let rateIssue = "", eligible = 0, warningDays = 0, criticalDays = 0, total = 0, success = 0;
  if (allDates.length < t.rateWarningDays) rateIssue = "可判断天数不足";
  for (const date of allDates) {
    const dayRows = sources.map(s=>s.successDays.find(d=>d.date===date));
    // Missing platform-day must not be removed from a merged denominator.
    const issue = dayRows.map(d=>!d ? "部分来源缺少日期覆盖" : evidenceIssue(d,t,now) || (!validNumber(d.total) || !validNumber(d.success) || d.success > d.total ? "成功率分子分母无效" : null)).find(Boolean);
    if (issue) { rateIssue ||= issue; continue; }
    const count = dayRows.reduce((n,d)=>n+d!.total!,0), completed = dayRows.reduce((n,d)=>n+d!.success!,0);
    if (count < t.minSample) { rateIssue ||= "每日订单样本不足"; continue; }
    eligible++; total+=count;success+=completed;
    if (completed/count*100 <= t.rateWarningPercent) warningDays++;
    if (completed/count*100 <= t.rateCriticalPercent) criticalDays++;
  }
  const rateState: RiskState = criticalDays >= t.rateCriticalDays ? "critical" : warningDays >= t.rateWarningDays ? "warning" : rateIssue || eligible < t.rateWarningDays ? "unknown" : "normal";
  metrics.push(metric("rate",labels.rate,rateState,total?percent(success/total):"—",`${eligible} 个有效日；低成功率 ${warningDays} 天，极低 ${criticalDays} 天。按笔数加权，不平均百分比。${rateIssue?` ${rateIssue}；结论不完整。`:""}`));
  if (provider.trim().toUpperCase() === "UPI-QR") metrics.push(metric("share",labels.share,"exempt","不参与","UPI-QR 只豁免占比，仍检查耗时、成功率和零点未完成代付。"));
  else {
    const shareIssue = currency==="未提供币种"?"缺少币种，不能比较金额":sources.map(s=>evidenceIssue(s.share,t,now) || (!s.share || !validNumber(s.share.sample) || s.share.sample < t.minSample ? "占比分母样本不足" : !validNumber(s.share.providerAmount) || !validNumber(s.share.totalAmount) || s.share.totalAmount <= 0 || s.share.providerAmount > s.share.totalAmount || !s.share.denominatorKey ? "缺少完整占比分母" : null)).find(Boolean);
    if (shareIssue) metrics.push(unknown("share",labels.share,shareIssue));
    else {
      const denominators = new Map<string,number>(); let amount = 0, inconsistent = false;
      for (const s of sources) {const v=s.share!;if(denominators.has(v.denominatorKey) && denominators.get(v.denominatorKey)!==v.totalAmount)inconsistent=true;denominators.set(v.denominatorKey,v.totalAmount!);amount+=v.providerAmount!;}
      const denominator=[...denominators.values()].reduce((a,b)=>a+b,0);
      if(inconsistent || amount>denominator)metrics.push(unknown("share",labels.share,"来源占比分母重复或不一致"));
      else metrics.push(metric("share",labels.share,severity(amount/denominator*100,t.shareWarningPercent,t.shareCriticalPercent),percent(amount/denominator),`按 ${currency} 已核验范围代收金额计算；不是全站未授权数据的占比。`));
    }
  }
  const midnightIssue = currency==="未提供币种"?"缺少币种，不能合并零点快照金额":sources.map(s=>evidenceIssue(s.midnight,t,now) || (!s.midnight?.verified ? "未接入已核验的当地零点快照" : !Number.isSafeInteger(s.midnight.count) || !validNumber(s.midnight.count) || !validNumber(s.midnight.amount) ? "快照笔数或金额缺失" : s.midnight.count>0&&s.midnight.continuityVerified!==true?"只有创建账龄，尚未核验同一订单连续多日未完成":null)).find(Boolean);
  if(midnightIssue)metrics.push(unknown("midnight",labels.midnight,midnightIssue));
  else {
    const count=sources.reduce((n,s)=>n+s.midnight!.count!,0), amount=sources.reduce((n,s)=>n+s.midnight!.amount!,0);
    const buckets=sources.flatMap(s=>s.midnight!.ageBuckets||[]);
    const valid=sources.every(s=>(s.midnight!.ageBuckets||[]).reduce((n,b)=>n+b.count,0)===s.midnight!.count)&&buckets.every(b=>validNumber(b.minDays)&&Number.isSafeInteger(b.count)&&b.count>=0&&(b.maxDays===null||validNumber(b.maxDays)&&b.maxDays>b.minDays));
    const bound=(age:number,upper:boolean)=>buckets.filter(b=>upper?(b.maxDays===null||b.maxDays>age):b.minDays>=age).reduce((n,b)=>n+b.count,0);
    const criticalLower=bound(t.pendingCriticalAgeDays,false),warningLower=bound(t.pendingWarningAgeDays,false);
    const state:RiskState=!valid?"unknown":criticalLower>=t.pendingCriticalCount?"critical":warningLower>=t.pendingWarningCount?"warning":bound(t.pendingCriticalAgeDays,true)<t.pendingCriticalCount&&bound(t.pendingWarningAgeDays,true)<t.pendingWarningCount?"normal":"unknown";
    const oldest=[...buckets].filter(b=>b.count>0).sort((a,b)=>b.minDays-a.minDays)[0];
    const age=oldest?`${oldest.minDays}—${oldest.maxDays??"∞"} 天`:count===0?"0 天":"未提供";
    metrics.push(metric("midnight",labels.midnight,state,`${count.toLocaleString("zh-CN")} 笔 · ${amount.toLocaleString("zh-CN",{maximumFractionDigits:2})} ${currency}`,`结束日各平台当地 00点附近采集窗口的已提交/代付中快照；最老账龄区间 ${age}。已达 ${t.pendingWarningAgeDays} 天至少 ${warningLower} 笔，已达 ${t.pendingCriticalAgeDays} 天至少 ${criticalLower} 笔。${state==="unknown"?"账龄分桶不足或跨越阈值，无法判断。":""}快照反映当时状态，不代表现在仍未完成。`));
  }
  const incomplete=metrics.some(m=>m.state==="unknown" || m.detail.includes("结论不完整"));
  const state:RiskState=metrics.some(m=>m.state==="critical")?"critical":metrics.some(m=>m.state==="warning")?"warning":incomplete?"unknown":"normal";
  return {key:`${provider}\u0000${currency}`,provider,currency,sources,metrics,state,score:state==="critical"?100:state==="warning"?50:state==="normal"?0:null,incomplete};
}
export function scoreProviders(sources: RiskSource[], thresholds: RiskThresholds, now = Date.now()): ProviderRisk[] {
  const groups=new Map<string,RiskSource[]>();
  const seen=new Set<string>();
  for(const source of sources){
    if(seen.has(source.key))throw new Error("异常数据来源重复，未进行合并。");seen.add(source.key);
    const key=JSON.stringify([source.canonicalProvider,source.currency]);groups.set(key,[...(groups.get(key)||[]),source]);
  }
  const rank:Record<RiskState,number>={critical:0,warning:1,unknown:2,normal:3,exempt:4};
  return [...groups.values()].map(rows=>scoreProvider(rows,thresholds,now)).sort((a,b)=>rank[a.state]-rank[b.state]||a.provider.localeCompare(b.provider)||a.currency.localeCompare(b.currency));
}
