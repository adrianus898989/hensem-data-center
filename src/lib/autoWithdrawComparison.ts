import type { AutoWithdrawCounts, AutoWithdrawPreviousDay, AutoWithdrawRow } from "./types";
import { formatDuration, parseDurationToSeconds } from "./format";

/** Aggregate the selected dates only; comparison values do not contribute to totals. */
export function aggregateAutoWithdrawByPlatform(rows: readonly AutoWithdrawRow[]): AutoWithdrawRow[] {
  const dates = rows.map((row) => (row as AutoWithdrawRow & { date?: string }).date);
  // Check the entire selection, not each platform separately: a sparse platform
  // in a multi-day selection must not appear to have a single-day comparison.
  const singleDate = dates.length > 0 && dates.every((date) => !!date && date === dates[0]);
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
    yesterdayAvgTime: singleDate && rowCount === 1 ? row.yesterdayAvgTime || "-" : "-",
    comparePercent: singleDate && rowCount === 1 ? row.comparePercent || "-" : "-",
    previousDay: singleDate && rowCount === 1 ? row.previousDay ?? null : null,
  })).sort((a, b) => b.total - a.total);
}

const countKeys = ["total", "success", "rejected", "autoCount", "manualCount"] as const;

/** Summarize the same filtered platform population on the preceding day. */
export function summarizePreviousDay(rows: readonly AutoWithdrawRow[]): {
  totals: AutoWithdrawCounts | null;
  matchedPlatforms: number;
  totalPlatforms: number;
  date: string | null;
} {
  const platforms = new Map<string, AutoWithdrawPreviousDay | null>();
  for (const row of rows) {
    const key = JSON.stringify([row.country, row.platform]);
    const previous = row.previousDay ?? null;
    if (!platforms.has(key)) {
      platforms.set(key, previous);
    } else {
      const existing = platforms.get(key);
      // Repeated identical rows must not double-count a platform; conflicting
      // dates/counts cannot safely be presented as one previous-day population.
      if (!existing || !previous || existing.date !== previous.date
        || countKeys.some((field) => existing[field] !== previous[field])) {
        platforms.set(key, null);
      }
    }
  }
  const matched = [...platforms.values()].filter((row): row is AutoWithdrawPreviousDay => row !== null);
  const dates = new Set(matched.map((row) => row.date));
  const date = dates.size === 1 ? matched[0].date : null;
  const complete = platforms.size > 0 && matched.length === platforms.size && !!date;
  const totals: AutoWithdrawCounts | null = complete
    ? { total: 0, success: 0, rejected: 0, autoCount: 0, manualCount: 0 } : null;
  if (totals) {
    for (const row of matched) for (const field of countKeys) totals[field] += row[field];
  }
  return { totals, matchedPlatforms: matched.length, totalPlatforms: platforms.size, date };
}

/** Difference in percentage points, using summed counts rather than mean rates. */
export function percentagePointChange(
  currentCount: number, currentTotal: number, previousCount: number, previousTotal: number,
): number | null {
  if (![currentCount, currentTotal, previousCount, previousTotal].every(Number.isFinite)
    || currentTotal <= 0 || previousTotal <= 0 || currentCount < 0 || previousCount < 0) return null;
  return (currentCount / currentTotal - previousCount / previousTotal) * 100;
}

export function formatPercentagePointChange(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const fixed = value.toFixed(2);
  // Avoid visually misleading -0.00 and +0.00 from floating-point noise.
  if (Number(fixed) === 0) return "0.00 pp";
  return `${value > 0 ? "+" : ""}${fixed} pp`;
}
