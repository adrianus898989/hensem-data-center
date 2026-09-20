import type { TimeQueryResult, TimeQuerySelection } from "./orderTimeVolume";

export type TimeComparisonState = {
  status: "loading" | "ready" | "error";
  previous?: TimeQueryResult;
};

/** Shift calendar dates, not the browser timezone or the selected clock hours. */
export function previousTimeSelection(selection: TimeQuerySelection): TimeQuerySelection {
  const startDay = Date.parse(`${selection.start.slice(0, 10)}T00:00:00Z`);
  const endDay = Date.parse(`${selection.end.slice(0, 10)}T00:00:00Z`);
  const days = Math.round((endDay - startDay) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 31) throw new Error("对比时间范围无效。");
  const shift = (value: string) => value
    ? new Date(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10) + value.slice(10)
    : "";
  return { ...selection, start: shift(selection.start), end: shift(selection.end),
    createdStart: shift(selection.createdStart), createdEnd: shift(selection.createdEnd) };
}

export function timeComparisonLabel(selection: TimeQuerySelection): string {
  return selection.start.slice(0, 10) === selection.end.slice(0, 10) ? "较昨日" : "较前期";
}
