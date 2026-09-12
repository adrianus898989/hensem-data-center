import { formatPercent } from "@/lib/format";
import { formatPercentagePointChange, percentagePointChange } from "@/lib/autoWithdrawComparison";

export type AutoWithdrawRateTone = "auto" | "manual" | "success" | "rejected";

export function autoWithdrawDeltaClass(change: number | null, tone: AutoWithdrawRateTone): string {
  if (change === null || !Number.isFinite(change)) return "is-unavailable";
  const rounded = Number(change.toFixed(2));
  if (rounded === 0) return "is-flat is-neutral";
  const favorable = tone === "auto" || tone === "success" ? rounded > 0 : rounded < 0;
  return `${rounded > 0 ? "is-up" : "is-down"} ${favorable ? "is-favorable" : "is-unfavorable"}`;
}

export function AutoWithdrawRateComparison({ count, total, previousCount, previousTotal, tone, compare = false }: {
  count: number;
  total: number;
  previousCount?: number;
  previousTotal?: number;
  tone: AutoWithdrawRateTone;
  compare?: boolean;
}) {
  const currentValid = Number.isFinite(count) && count >= 0 && Number.isFinite(total) && total > 0;
  const previousPresent = previousCount !== undefined && previousTotal !== undefined
    && Number.isFinite(previousCount) && previousCount >= 0 && Number.isFinite(previousTotal) && previousTotal >= 0;
  const previousRate = previousPresent && previousTotal! > 0 ? formatPercent(previousCount! / previousTotal!) : "—";
  const change = previousPresent ? percentagePointChange(count, total, previousCount!, previousTotal!) : null;
  return <span className={`aw-rate-compare is-${tone}`}>
    <span className="aw-rate-current-line">
      <span className="aw-rate-current">{currentValid ? formatPercent(count / total) : "—"}</span>
      {compare && previousPresent && <span className={`aw-rate-delta ${autoWithdrawDeltaClass(change, tone)}`}
        title={change === null ? "总笔数为零，无法比较占比" : "与昨日占比之差，单位为百分点（pp）"}>
        {change === null ? "不可比" : formatPercentagePointChange(change)}
      </span>}
    </span>
    {compare && <span className={`aw-rate-previous${previousPresent ? "" : " is-unavailable"}`}>
      {previousPresent ? `昨日 ${previousRate}` : "无对比数据"}
    </span>}
  </span>;
}
