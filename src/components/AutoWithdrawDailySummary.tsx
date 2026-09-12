import type { ReactNode } from "react";
import { formatNumber, formatPercent } from "@/lib/format";
import { formatPercentagePointChange, percentagePointChange } from "@/lib/autoWithdrawComparison";
import { autoWithdrawDeltaClass, type AutoWithdrawRateTone } from "./AutoWithdrawRateComparison";

export type DailyTotals = {
  total: number; autoCount: number; manualCount: number; success: number; rejected: number;
};

export function AutoWithdrawDailySummary({ startDate, endDate, dayCount, totals, actions, comparison }: {
  startDate: string; endDate: string; dayCount: number; totals: DailyTotals; actions?: ReactNode;
  comparison?: { totals: DailyTotals | null; matchedPlatforms: number; totalPlatforms: number; date: string | null };
}) {
  // Keep the daily table's denominator, including orders without an operation classification.
  const percent = (count: number) => totals.total > 0 ? formatPercent(count / totals.total) : "—";
  const unassigned = totals.total - totals.autoCount - totals.manualCount;
  const otherStatus = totals.total - totals.success - totals.rejected;
  const metrics: { label: string; key: keyof Omit<DailyTotals, "total">; tone: AutoWithdrawRateTone; hint: string }[] = [
    { label: "自动出款", key: "autoCount", tone: "auto", hint: "自动出款笔数 / 总笔数" },
    { label: "人工处理", key: "manualCount", tone: "manual", hint: "人工处理笔数 / 总笔数" },
    { label: "成功", key: "success", tone: "success", hint: "成功笔数 / 总笔数，沿用日表口径（含已提交）" },
    { label: "驳回", key: "rejected", tone: "rejected", hint: "驳回笔数 / 总笔数" }
  ];
  const compare = Boolean(comparison) && startDate === endDate;
  const fullyMatched = compare && comparison!.totalPlatforms > 0
    && comparison!.matchedPlatforms === comparison!.totalPlatforms && Boolean(comparison!.date);
  const previous = fullyMatched ? comparison!.totals : null;
  const growth = previous && Number.isFinite(previous.total) && previous.total > 0 && Number.isFinite(totals.total)
    ? (totals.total - previous.total) / previous.total : null;
  const growthText = growth === null ? "不可比" : `${growth > 0 ? "+" : growth < 0 ? "−" : ""}${formatPercent(Math.abs(growth))}`;
  const range = startDate === endDate ? startDate : `${startDate || "—"} 至 ${endDate || "—"}`;
  return <div className="aw-daily-summary">
    <div className="aw-daily-heading">
      <div className="aw-daily-scope"><h2>自动出款日表</h2><span>{range || "—"}{totals.total > 0 && dayCount > 0 ? ` · ${dayCount} 个统计日` : ""}</span>
        {compare && <span className={`aw-daily-comparison-scope${previous ? "" : " aw-daily-comparison-incomplete"}`}>
          对比 {comparison!.date || "前日"}{previous ? "" : ` · 覆盖 ${comparison!.matchedPlatforms}/${comparison!.totalPlatforms} 平台，汇总不可比`}
        </span>}
      </div>
      <div className="aw-daily-actions">{actions}</div>
    </div>
    <dl className="aw-daily-metrics" aria-label="当前筛选汇总，百分比均占总笔数">
      <div className="aw-daily-metric is-total">
        <dt>总笔数</dt><dd><strong>{formatNumber(totals.total)}</strong>
          <small title="按当前筛选有记录的日期数计算">日均 {formatNumber(dayCount > 0 ? totals.total / dayCount : 0)}</small></dd>
        {compare && <dd className="aw-daily-previous">{previous ? <>
          <span>前日 {formatNumber(previous.total)} 笔</span><span aria-hidden="true"> · </span>
          <span className={`aw-rate-delta ${growth === null ? "is-unavailable" : growth > 0 ? "is-up" : growth < 0 ? "is-down" : "is-flat"}`}
            title={growth === null ? "前日总笔数为零，无法计算增长率" : "总笔数较前日的增长率，不是占比百分点变化"}>{growthText}</span>
        </> : "无完整对比数据"}</dd>}
      </div>
      {metrics.map(metric => {
        const count = totals[metric.key];
        const previousPercent = previous && previous.total > 0 ? formatPercent(previous[metric.key] / previous.total) : "—";
        const change = previous ? percentagePointChange(count, totals.total, previous[metric.key], previous.total) : null;
        return <div className={`aw-daily-metric is-${metric.tone}`} key={metric.tone}>
          <dt>{metric.label}</dt><dd><strong>{formatNumber(count)}</strong>
            <small className="aw-daily-percent" title={metric.hint} aria-label={`${metric.label}占总笔数 ${percent(count)}`}>{percent(count)}</small></dd>
          {compare && <dd className="aw-daily-previous">{previous ? <>
            <span>前日 {previousPercent}</span><span aria-hidden="true"> · </span>
            <span className={`aw-rate-delta ${autoWithdrawDeltaClass(change, metric.tone)}`}
              title={change === null ? "总笔数为零，无法比较占比" : "与前日占比之差，单位为百分点（pp）"}>
              {change === null ? "不可比" : formatPercentagePointChange(change)}
            </span>
          </> : "无完整对比数据"}</dd>}
        </div>;
      })}
    </dl>
    {(unassigned !== 0 || otherStatus !== 0) && <div className="aw-daily-remainders">
      {unassigned > 0 && <span title="总笔数减去已统计的自动和人工笔数；具体方式以明细为准">未分方式 <b>{formatNumber(unassigned)}</b> · {percent(unassigned)}</span>}
      {otherStatus > 0 && <span>其他状态 <b>{formatNumber(otherStatus)}</b> · {percent(otherStatus)}</span>}
      {(unassigned < 0 || otherStatus < 0) && <span className="aw-daily-mismatch" role="status">分项笔数超过总笔数，请核对明细</span>}
    </div>}
  </div>;
}
