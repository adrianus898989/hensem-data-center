import type { AutoWithdrawPayload } from "./types";
import { withPlatformDisplayCountry } from "./platformDisplayCountry";

/** Project fresh and archived data identically; never rewrite stored snapshots. */
export function autoWithdrawDisplayPayload(payload: AutoWithdrawPayload | null): AutoWithdrawPayload | null {
  if (!payload) return null;
  return {
    ...payload,
    monthlyRows: payload.monthlyRows.map(withPlatformDisplayCountry),
    dailyRows: payload.dailyRows.map(withPlatformDisplayCountry),
    operatorRows: payload.operatorRows.map(withPlatformDisplayCountry),
  };
}
