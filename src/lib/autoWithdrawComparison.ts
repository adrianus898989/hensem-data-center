import type { AutoWithdrawRow } from "./types";
import { formatDuration, parseDurationToSeconds } from "./format";

/** Aggregate the selected dates only; comparison values do not contribute to totals. */
export function aggregateAutoWithdrawByPlatform(rows: AutoWithdrawRow[]): AutoWithdrawRow[] {
  const groups = new Map<string, {
    row: AutoWithdrawRow;
    seconds: number;
    weight: number;
    rowCount: number;
  }>();

  for (const row of rows) {
    // A source-sheet change at month-end must not split the same platform.
    const key = `${row.country}|||${row.platform}`;
    const weight = row.total || row.success + row.rejected || 0;
    const seconds = parseDurationToSeconds(row.avgTime);
    let group = groups.get(key);
    if (!group) {
      group = { row: { ...row }, seconds: 0, weight: 0, rowCount: 0 };
      groups.set(key, group);
    } else {
      group.row.total += row.total;
      group.row.success += row.success;
      group.row.rejected += row.rejected;
      group.row.autoCount += row.autoCount;
      group.row.manualCount += row.manualCount;
    }
    group.rowCount += 1;
    if (seconds > 0 && weight > 0) {
      group.seconds += seconds * weight;
      group.weight += weight;
    }
  }

  return [...groups.values()].map(({ row, seconds, weight, rowCount }) => ({
    ...row,
    successRate: row.total ? row.success / row.total : 0,
    rejectRate: row.total ? row.rejected / row.total : 0,
    autoRate: row.total ? row.autoCount / row.total : 0,
    manualRate: row.total ? row.manualCount / row.total : 0,
    avgTime: formatDuration(weight ? seconds / weight : 0),
    // The API has already calculated yesterday for each daily row. Keeping that
    // row's comparison fixes the single-day table; a multi-day aggregate has no
    // single "yesterday" and must not inherit an arbitrary day's comparison.
    yesterdayAvgTime: rowCount === 1 ? row.yesterdayAvgTime || "-" : "-",
    comparePercent: rowCount === 1 ? row.comparePercent || "-" : "-",
  })).sort((a, b) => b.total - a.total);
}
