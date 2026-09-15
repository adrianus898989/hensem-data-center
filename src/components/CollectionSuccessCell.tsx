import type { CollectionSuccessComparison, CollectionSuccessMetric } from "@/lib/collectionSuccess";
import { formatNumber } from "@/lib/format";
import "./CollectionSuccessCell.css";

function metricNote(metric: CollectionSuccessMetric): string {
  if (metric.state === "unavailable") return "暂不可用";
  if (metric.state === "missing") return "未采集";
  if (metric.state === "partial") return metric.unknownType ? "类型未确认" : "部分未采集";
  if (metric.state === "zero") return "无提交";
  return "";
}

export function CollectionSuccessCell({ value }: { value: CollectionSuccessComparison }) {
  const { current, previous, deltaPoints, comparisonLabel } = value;
  const counts = `${formatNumber(current.success)} 成功 / ${formatNumber(current.submitted)} 提交`;
  const coverage = `已采集 ${current.captured}/${current.expected} 个平台日`;
  const label = current.rate === null ? "—" : `${(current.rate * 100).toFixed(2)}%`;
  const delta = deltaPoints === null ? `${comparisonLabel === "较昨日" ? "昨日" : "上期"}${metricNote(previous) || "不可比"}`
    : `${comparisonLabel} ${deltaPoints > 0 ? "+" : ""}${deltaPoints.toFixed(2)} 百分点`;
  return <div className="collection-success-cell" tabIndex={0}
    title={`按提交日期：成功笔数 ÷ 提交笔数。${counts}；${coverage}。${current.rate === null ? metricNote(current) : delta}。上一期：${formatNumber(previous.success)} / ${formatNumber(previous.submitted)}。`}
    aria-label={`代收成功率 ${label}，${current.rate === null ? metricNote(current) : delta}，${counts}，${coverage}`}>
    <strong>{label}</strong>
    <small className={current.rate !== null && deltaPoints !== null ? deltaPoints > 0 ? "success-up" : deltaPoints < 0 ? "success-down" : "" : ""}>
      {current.rate === null ? metricNote(current) : delta}
    </small>
  </div>;
}

export function CollectionSuccessBreakdown({ value }: { value: CollectionSuccessComparison }) {
  return <div className="collection-success-breakdown">
    <span className="collection-success-breakdown-label">按平台 · 成功 / 提交</span>
    <div className="collection-success-platforms">{value.platforms.map(item => <div key={`${item.country}:${item.platform}`} className="collection-success-platform">
      <strong>{item.platform}</strong>
      <span>{item.current.captured ? `${formatNumber(item.current.success)} / ${formatNumber(item.current.submitted)}` : "— / —"}</span>
      <span>{item.current.rate === null ? metricNote(item.current) : `${(item.current.rate * 100).toFixed(2)}%`}</span>
    </div>)}</div>
  </div>;
}
