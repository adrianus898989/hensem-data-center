import type { ReactNode } from "react";
import { formatNumber, formatPercent } from "@/lib/format";

type DailyTotals = {
  total: number; autoCount: number; manualCount: number; success: number; rejected: number;
};

export function AutoWithdrawDailySummary({ startDate, endDate, dayCount, totals, actions }: {
  startDate: string; endDate: string; dayCount: number; totals: DailyTotals; actions?: ReactNode;
}) {
  // Keep the daily table's denominator, including orders without an operation classification.
  const percent = (count: number) => totals.total > 0 ? formatPercent(count / totals.total) : "—";
  const unassigned = totals.total - totals.autoCount - totals.manualCount;
  const otherStatus = totals.total - totals.success - totals.rejected;
  const metrics = [
    { label: "自动出款", count: totals.autoCount, tone: "auto", hint: "自动出款笔数 / 总笔数" },
    { label: "人工处理", count: totals.manualCount, tone: "manual", hint: "人工处理笔数 / 总笔数" },
    { label: "成功", count: totals.success, tone: "success", hint: "成功笔数 / 总笔数，沿用日表口径（含已提交）" },
    { label: "驳回", count: totals.rejected, tone: "rejected", hint: "驳回笔数 / 总笔数" }
  ];
  const range = startDate === endDate ? startDate : `${startDate || "—"} 至 ${endDate || "—"}`;
  return <div className="aw-daily-summary">
    <div className="aw-daily-heading">
      <div className="aw-daily-scope"><h2>自动出款日表</h2><span>{range || "—"}{totals.total > 0 && dayCount > 0 ? ` · ${dayCount} 个统计日` : ""}</span></div>
      <div className="aw-daily-actions">{actions}</div>
    </div>
    <dl className="aw-daily-metrics" aria-label="当前筛选汇总，百分比均占总笔数">
      <div className="aw-daily-metric is-total">
        <dt>总笔数</dt><dd><strong>{formatNumber(totals.total)}</strong>
          <small title="按当前筛选有记录的日期数计算">日均 {formatNumber(dayCount > 0 ? totals.total / dayCount : 0)}</small></dd>
      </div>
      {metrics.map(metric => <div className={`aw-daily-metric is-${metric.tone}`} key={metric.tone}>
        <dt>{metric.label}</dt><dd><strong>{formatNumber(metric.count)}</strong>
          <small className="aw-daily-percent" title={metric.hint} aria-label={`${metric.label}占总笔数 ${percent(metric.count)}`}>{percent(metric.count)}</small></dd>
      </div>)}
    </dl>
    {(unassigned !== 0 || otherStatus !== 0) && <div className="aw-daily-remainders">
      {unassigned > 0 && <span title="总笔数减去已统计的自动和人工笔数；具体方式以明细为准">未分方式 <b>{formatNumber(unassigned)}</b> · {percent(unassigned)}</span>}
      {otherStatus > 0 && <span>其他状态 <b>{formatNumber(otherStatus)}</b> · {percent(otherStatus)}</span>}
      {(unassigned < 0 || otherStatus < 0) && <span className="aw-daily-mismatch" role="status">分项笔数超过总笔数，请核对明细</span>}
    </div>}
  </div>;
}
