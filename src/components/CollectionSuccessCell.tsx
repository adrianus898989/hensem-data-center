import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { collectionSuccessComparisonNote, collectionSuccessMissingPlatforms, type CollectionSuccessComparison, type CollectionSuccessMetric } from "@/lib/collectionSuccess";
import { formatNumber } from "@/lib/format";
import "./CollectionSuccessCell.css";

function metricNote(metric: CollectionSuccessMetric): string {
  if (metric.state === "unavailable") return "暂不可用";
  if (metric.state === "missing") return "未采集";
  if (metric.state === "partial") return metric.captured < metric.expected ? `已采集 ${metric.captured}/${metric.expected}` : "类型未确认";
  if (metric.state === "zero") return "无提交";
  return "";
}

export function CollectionSuccessCell({ value }: { value: CollectionSuccessComparison }) {
  const popupId = useId();
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const { current, previous, deltaPoints } = value;
  const counts = `${formatNumber(current.success)} 成功 / ${formatNumber(current.submitted)} 提交`;
  const coverage = `已采集 ${current.captured}/${current.expected} 个平台日`;
  const label = current.rate === null ? "—" : `${(current.rate * 100).toFixed(2)}%`;
  const delta = collectionSuccessComparisonNote(value);
  const isPartial = current.state === "partial";
  const missingPlatforms = collectionSuccessMissingPlatforms(value);
  const canInspectCoverage = isPartial && missingPlatforms.length > 0;
  const countryCount = new Set(missingPlatforms.map(item => item.country)).size;
  const popoverProps = { popover: "auto" } as const;

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const sync = () => setPopupOpen(popup.matches(":popover-open"));
    popup.addEventListener("toggle", sync);
    return () => popup.removeEventListener("toggle", sync);
  }, [canInspectCoverage]);

  const toggleCoverage = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const popup = popupRef.current;
    if (!popup) return;
    if (popup.matches(":popover-open")) {
      popup.hidePopover();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 220;
    const estimatedHeight = Math.min(250, 58 + missingPlatforms.length * 30);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const below = rect.bottom + 6;
    const top = below + estimatedHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.top - estimatedHeight - 6);
    popup.style.setProperty("--coverage-popup-left", `${left}px`);
    popup.style.setProperty("--coverage-popup-top", `${top}px`);
    popup.showPopover();
  };

  return <div className={`collection-success-cell${isPartial ? " is-partial" : ""}`} tabIndex={0}
    title={`按提交日期：成功笔数 ÷ 提交笔数。${counts}；${coverage}。${current.rate === null ? metricNote(current) : delta}。上一期：${formatNumber(previous.success)} / ${formatNumber(previous.submitted)}。`}
    aria-label={`代收成功率 ${label}，${current.rate === null ? metricNote(current) : delta}，${counts}，${coverage}`}>
    <strong>{label}</strong>
    <small className={isPartial ? "success-partial" : current.rate !== null && deltaPoints !== null ? deltaPoints > 0 ? "success-up" : deltaPoints < 0 ? "success-down" : "" : ""}>
      {canInspectCoverage
        ? <button type="button" className="collection-success-coverage-trigger" aria-haspopup="dialog" aria-expanded={popupOpen} aria-controls={popupId} onClick={toggleCoverage}>{delta}</button>
        : current.rate === null ? metricNote(current) : delta}
    </small>
    {canInspectCoverage && <div {...popoverProps} ref={popupRef} id={popupId} role="dialog" aria-label="未采集平台" className="collection-success-coverage-popup" onClick={event => event.stopPropagation()}>
      <div className="collection-success-coverage-title">未采集平台</div>
      <div className="collection-success-coverage-list">{missingPlatforms.map(item => <div key={`${item.country}:${item.platform}`} className="collection-success-coverage-item">
        <strong>{countryCount > 1 ? `${item.country} · ${item.platform}` : item.platform}</strong>
        {item.expected > 1 && <span>少 {item.missing} 天</span>}
      </div>)}</div>
    </div>}
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
