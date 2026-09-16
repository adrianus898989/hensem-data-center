import type { AutoWithdrawRow } from "./types.ts";
import { formatDuration, parseDurationToSeconds } from "./format.ts";
import { withPlatformDisplayCountry } from "./platformDisplayCountry.ts";

export function aggregateWithdrawRows(rows: AutoWithdrawRow[]): AutoWithdrawRow[] {
  const grouped = new Map<string, AutoWithdrawRow & { weightedSeconds: number; timeWeight: number }>();
  for (const source of rows) {
    const row = withPlatformDisplayCountry(source);
    const key = `${row.country}|||${row.platform}|||${row.sourceSheet}`;
    const weight = row.total || row.success + row.rejected || 0;
    const seconds = parseDurationToSeconds(row.avgTime);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {...row, successRate: 0, rejectRate: 0, autoRate: 0, manualRate: 0,
        avgTime: "0秒", yesterdayAvgTime: "-", comparePercent: "-",
        weightedSeconds: seconds > 0 && weight > 0 ? seconds * weight : 0,
        timeWeight: seconds > 0 && weight > 0 ? weight : 0});
      continue;
    }
    current.total += row.total;
    current.success += row.success;
    current.rejected += row.rejected;
    current.autoCount += row.autoCount;
    current.manualCount += row.manualCount;
    if (seconds > 0 && weight > 0) { current.weightedSeconds += seconds * weight; current.timeWeight += weight; }
  }
  return [...grouped.values()].map(({weightedSeconds, timeWeight, ...row}) => ({...row,
    successRate: row.total ? row.success / row.total : 0,
    rejectRate: row.total ? row.rejected / row.total : 0,
    autoRate: row.total ? row.autoCount / row.total : 0,
    manualRate: row.total ? row.manualCount / row.total : 0,
    avgTime: formatDuration(timeWeight ? weightedSeconds / timeWeight : 0),
  })).sort((a, b) => b.total - a.total);
}
