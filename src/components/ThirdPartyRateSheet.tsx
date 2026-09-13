"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ThirdPartyPlatformStatusRow, ThirdPartyRateRow } from "@/lib/types";
import "./ThirdPartyRateSheet.css";

export type ThirdPartyRateSheetProps = {
  country: string;
  /** Already authorized and ordered by the parent. One input row remains one row. */
  rateRows: readonly ThirdPartyRateRow[];
  statusRows: readonly ThirdPartyPlatformStatusRow[];
  /** Compatibility only: the sheet exposes its fields inline, never in a modal. */
  onOpenRate?: (row: ThirdPartyRateRow) => void;
  selectedSheet?: string;
  onSelectSheet?: (sheet: string) => void;
  initialView?: "compact" | "full";
  pageSize?: 12 | 20 | 50;
};

type SourceRow = Pick<ThirdPartyRateRow, "id" | "sourceRow">;
type MatrixColumn = { platform: string; sourceColumn: number };

export function rateSheetSourceRow(row: SourceRow): number | null {
  const v166 = String(row.id || "").match(/-v166(?:-status)?-(\d+)-/i);
  const direct = String(row.id || "").match(/-direct-(\d+)-/i);
  const value = v166 ? Number(v166[1]) + 1 : direct ? Number(direct[1]) : Number(row.sourceRow);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Missing origin coordinates never join each other; no cross-type/name fallback. */
export function rateSheetMatrixRows(row: ThirdPartyRateRow, statuses: readonly ThirdPartyPlatformStatusRow[]): ThirdPartyPlatformStatusRow[] {
  const sourceRow = rateSheetSourceRow(row);
  if (sourceRow === null) return [];
  return statuses.filter((status) => status.country === row.country
    && status.sheetName === row.sheetName && rateSheetSourceRow(status) === sourceRow
    && status.thirdParty === row.thirdParty && status.category === row.category);
}

function sourceColumn(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

export function rateSheetMatrixColumns(statuses: readonly ThirdPartyPlatformStatusRow[]): MatrixColumn[] {
  const columns = new Map<string, MatrixColumn>();
  for (const status of statuses) {
    if (!status.platform) continue;
    const column = sourceColumn(status.sourceColumn);
    const previous = columns.get(status.platform);
    if (!previous || column < previous.sourceColumn) columns.set(status.platform, { platform: status.platform, sourceColumn: column });
  }
  // Stable sort: equal/unknown source columns retain their supplied order.
  return Array.from(columns.values()).sort((a, b) => a.sourceColumn - b.sourceColumn);
}

function raw(value: string): string {
  return value === "" || value == null ? "—" : value;
}

export function rateSheetBusinessStatus(row: ThirdPartyRateRow, side: "collect" | "payout"): string {
  // “代收/代付情况” in the source can describe limits/capabilities, not a
  // switch (e.g. 20万50万). It remains visible in the original notes only.
  const labels = side === "collect" ? ["代收状态"] : ["代付状态"];
  const parts = String(row.channelInfo || "").split(/\s+\/\s+/);
  const values: string[] = [];
  for (const part of parts) {
    const match = part.trim().match(/^([^:：]+)\s*[:：]\s*([\s\S]*)$/);
    if (match && labels.includes(match[1].trim()) && match[2].trim()) values.push(match[2].trim());
  }
  // Keep the original side-specific wording, including disagreements. The
  // overall status is not evidence for either side and is shown separately.
  return values.join("\n");
}

function statusTone(value: string): string {
  if (/^(开启|正常|开)$/.test(value.trim())) return "good";
  if (/^(停用|暂停|未接入|不支持|关闭|关)$/.test(value.trim())) return "bad";
  if (/^(备用|维护|对接中)$/.test(value.trim())) return "attention";
  return "plain";
}

function StatusText({ value }: { value: string }) {
  return <span className={`rate-sheet-status rate-sheet-status-${statusTone(value)}`}>{raw(value)}</span>;
}

function RowNotes({ row }: { row: ThirdPartyRateRow }) {
  const notes = [
    ["通道 / 备注", row.channelInfo], ["漏单", row.leak], ["白名单", row.whitelist],
  ].filter(([, value]) => value !== "" && value != null);
  if (!notes.length) return <span className="rate-sheet-missing">—</span>;
  return <div className="rate-sheet-notes" tabIndex={0} role="region" aria-label={`${row.thirdParty} ${row.category || "未分类"} 完整备注，可滚动查看`}>{notes.map(([label, value]) => <div key={label}><span>{label}：</span>{value}</div>)}</div>;
}

/** Read-only presentation. No fee parsing, arithmetic, grouping or network. */
export default function ThirdPartyRateSheet({ country, rateRows, statusRows, selectedSheet, onSelectSheet, initialView = "compact", pageSize = 12 }: ThirdPartyRateSheetProps) {
  const id = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [internalSheet, setInternalSheet] = useState("");
  const [view, setView] = useState<"compact" | "full">(initialView);
  const [size, setSize] = useState<12 | 20 | 50>([12, 20, 50].includes(pageSize) ? pageSize : 12);
  const [page, setPage] = useState(0);
  const sheets = useMemo(() => Array.from(new Set(rateRows.map((row) => row.sheetName))), [rateRows]);
  const requestedSheet = selectedSheet === undefined ? internalSheet : selectedSheet;
  const activeSheet = sheets.includes(requestedSheet) ? requestedSheet : sheets[0];
  const rows = useMemo(() => rateRows.filter((row) => row.sheetName === activeSheet), [rateRows, activeSheet]);
  const relevantStatuses = useMemo(() => statusRows.filter((row) => row.sheetName === activeSheet), [statusRows, activeSheet]);
  const columns = useMemo(() => rateSheetMatrixColumns(relevantStatuses), [relevantStatuses]);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * size, (currentPage + 1) * size);
  const full = view === "full";
  useEffect(() => { setPage(0); }, [country, activeSheet, rateRows]);

  function locate(platforms: boolean) {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let left = 0;
    const platformStart = scroller.querySelector<HTMLElement>("[data-platform-start]");
    if (platforms && platformStart) {
      const frozenWidth = Array.from(scroller.querySelectorAll<HTMLElement>("thead tr:first-child [data-freeze]"))
        .filter((cell) => getComputedStyle(cell).position === "sticky" && getComputedStyle(cell).left !== "auto")
        .reduce((sum, cell) => sum + cell.getBoundingClientRect().width, 0);
      left = Math.max(0, platformStart.offsetLeft - frozenWidth);
    }
    scroller.scrollTo({ left, behavior: "auto" });
  }

  if (!rateRows.length) return <div className="rate-sheet-empty">没有匹配的三方费率资料</div>;

  return <div className={`rate-sheet rate-sheet-${view}`} data-view={view}>
    <div className="rate-sheet-controls">
    <div className="rate-sheet-toolbar">
      <div className="rate-sheet-tabs" role="group" aria-label="费率表格页签">
        {sheets.map((sheet) => <button key={sheet} type="button" aria-pressed={activeSheet === sheet}
          className={activeSheet === sheet ? "is-active" : ""} onClick={() => {
            if (selectedSheet === undefined) setInternalSheet(sheet);
            onSelectSheet?.(sheet);
          }}>{sheet || "未提供页签"}</button>)}
      </div>
    </div>
    <div className="rate-sheet-viewbar">
      <div className="rate-sheet-view-toggle" role="group" aria-label="费率列显示方式">
        {(["compact", "full"] as const).map((mode) => <button key={mode} type="button" data-view={mode} aria-pressed={view === mode} onClick={() => { setView(mode); locate(false); }}>{mode === "compact" ? "精简展示" : "原表全部列"}</button>)}
      </div>
      <div className="rate-sheet-locate" role="group" aria-label="表格横向定位"><span>定位</span><button type="button" aria-label="定位费率区" onClick={() => locate(false)}>费率区</button><button type="button" aria-label="定位平台区" disabled={!columns.length} onClick={() => locate(true)}>平台区 →</button></div>
    </div>
    </div>
    <div id={`${id}-hint`} className="rate-sheet-hint">
      <span>{rows.length} 条类型记录 · {columns.length} 个平台 · 保留原表行序</span>
      <span>{full ? "已采集原表全部列；完整备注可在单元格内滚动查看。" : "百分比 / 单笔分行，不相加；完整范围及备注见「原表全部列」。"}</span>
    </div>
    <div className="rate-sheet-config-notice">平台栏为配置 / 接入状态原文，不代表实际跑量；当前资料未提供每日代收、代付笔数。</div>
    <div ref={scrollRef} className="rate-sheet-scroll" tabIndex={0} role="region" aria-label={`${country || "当前国家"} ${activeSheet || "费率"} 表格对照`} aria-describedby={`${id}-hint`}>
      <table className="rate-sheet-table" style={{ width: `calc(var(--rate-sheet-origin) + var(--rate-sheet-party) + var(--rate-sheet-type) + var(--rate-sheet-data-width) + ${columns.length} * var(--rate-sheet-platform))` }}>
        <caption>{country || "当前国家"} · {activeSheet || "费率表"} · 已采集字段对照</caption>
        <colgroup><col className="rate-sheet-col-origin" /><col className="rate-sheet-col-party" /><col className="rate-sheet-col-type" />
          {full ? <><col className="rate-sheet-col-total" />{Array.from({ length: 8 }, (_, index) => <col key={index} className={index % 4 === 2 ? "rate-sheet-col-limit" : "rate-sheet-col-fee"} />)}<col className="rate-sheet-col-fee" /><col className="rate-sheet-col-notes" /></> : <><col className="rate-sheet-col-compact-fee" /><col className="rate-sheet-col-compact-fee" /></>}
          {columns.map((column) => <col className="rate-sheet-col-platform" key={column.platform} />)}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} scope="col" data-freeze className="rate-sheet-sticky-origin">原行</th>
            <th rowSpan={2} scope="col" data-freeze className="rate-sheet-sticky-party">三方</th>
            <th rowSpan={2} scope="col" data-freeze className="rate-sheet-sticky-type">类型 / 钱包</th>
            {full ? <><th rowSpan={2} scope="col">合计费率</th>
            <th colSpan={4} scope="colgroup" className="rate-sheet-collect-head">代收</th>
            <th colSpan={4} scope="colgroup" className="rate-sheet-payout-head">代付</th>
            <th rowSpan={2} scope="col">整体状态</th>
            <th rowSpan={2} scope="col">备注 / 通道信息</th></> : <>
              <th rowSpan={2} scope="col" data-freeze className="rate-sheet-sticky-collect rate-sheet-collect-head">代收费率<small>百分比 / 单笔</small></th>
              <th rowSpan={2} scope="col" data-freeze className="rate-sheet-sticky-payout rate-sheet-payout-head">代付费率<small>百分比 / 单笔</small></th>
            </>}
            {columns.length > 0 && <th colSpan={columns.length} scope="colgroup" data-platform-start className="rate-sheet-platform-head">盘口接入状态 · 原单元格</th>}
          </tr>
          <tr>
            {full && (["collect", "payout"] as const).flatMap((side) => ["费率", "单笔", "范围", "状态"].map((label) => <th key={`${side}-${label}`} scope="col" className={`rate-sheet-${side}-head`}>{label}</th>))}
            {columns.map((column) => <th key={column.platform} scope="col" className="rate-sheet-platform-head">{column.platform}</th>)}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => {
            const matches = rateSheetMatrixRows(row, relevantStatuses);
            return <tr key={`${row.id}-${index}`} data-rate-id={row.id} data-source-row={rateSheetSourceRow(row) ?? ""}>
              <td className="rate-sheet-sticky-origin">{rateSheetSourceRow(row) ?? "—"}</td>
              <th scope="row" className="rate-sheet-sticky-party">{row.thirdParty === "SUPER" && ["印度", "IN", "INDIA"].includes(row.country.trim().toUpperCase()) ? <><span>Superpay</span><small className="rate-sheet-original-name">原名：{row.thirdParty}</small></> : raw(row.thirdParty)}</th>
              <td className="rate-sheet-sticky-type">{raw(row.category)}</td>
              {full ? <><td>{raw(row.totalFee)}</td>
              <td>{raw(row.collectFee)}</td><td>{raw(row.collectSingleFee)}</td><td>{raw(row.collectLimit)}</td><td><StatusText value={rateSheetBusinessStatus(row, "collect")} /></td>
              <td>{raw(row.payoutFee)}</td><td>{raw(row.payoutSingleFee)}</td><td>{raw(row.payoutLimit)}</td><td><StatusText value={rateSheetBusinessStatus(row, "payout")} /></td>
              <td><StatusText value={row.status} /></td><td><RowNotes row={row} /></td></> : <>
                <td className="rate-sheet-sticky-collect"><span className="rate-sheet-fee-value">{raw(row.collectFee)}</span><small className="rate-sheet-single-value">单笔 {raw(row.collectSingleFee)}</small></td>
                <td className="rate-sheet-sticky-payout"><span className="rate-sheet-fee-value">{raw(row.payoutFee)}</span><small className="rate-sheet-single-value">单笔 {raw(row.payoutSingleFee)}</small></td>
              </>}
              {columns.map((column) => {
                const values = matches.filter((status) => status.platform === column.platform);
                return <td key={column.platform} data-platform={column.platform}>{values.length ? <div className="rate-sheet-matrix-values">{values.map((status, itemIndex) => <StatusText key={`${status.id}-${itemIndex}`} value={status.rawStatus || status.status} />)}</div> : <span className="rate-sheet-missing">—</span>}</td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <div className="rate-sheet-pagination">
      <span aria-live="polite">{rows.length ? `${currentPage * size + 1}–${Math.min(rows.length, (currentPage + 1) * size)} / ${rows.length} 条` : "0 / 0 条"}</span>
      <label>每页 <select aria-label="每页记录数" value={size} onChange={(event) => { const next = Number(event.target.value); if (next === 12 || next === 20 || next === 50) { setSize(next); setPage(0); } }}>{[12, 20, 50].map((count) => <option key={count} value={count}>{count} 条</option>)}</select></label>
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span className="rate-sheet-page-index">{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>下一页</button>
    </div>
    <div className="rate-sheet-footnote">仅调整费率展示，不改变费率读取、匹配或计算。原表的颜色、合并单元格及未采集列不在当前数据中。</div>
  </div>;
}
