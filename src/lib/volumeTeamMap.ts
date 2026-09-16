/**
 * Explicit team ownership for volume rows.
 * Raw sources may provide the team (for example game66_charge_orders). Older
 * third_party_volume rows do not, so only confirmed platform names belong here.
 * Add the Hong Kong platform names after they are confirmed; do not infer team
 * ownership from a similar-looking channel name.
 */
const TEAM_PLATFORM_RULES: Array<{ team: string; platforms: string[] }> = [
  {
    team: "红膏蟹",
    platforms: [
      "66GAME", "66GAME 平台 01", "YYGAME", "XX7", "XX6", "XX5", "YY9", "PE7", "W5W",
    ],
  },
  {
    team: "香港·团队",
    platforms: [
      "EZ777", "8GAME", "KA9", "WR777", "HU777", "GG9", "WW9", "MM9", "777IN",
      "365IN", "INDIA2026", "FT7",
    ],
  },
];

function compact(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "");
}

export function resolveVolumeTeam(platform: string, rawTeam?: unknown): string {
  const direct = String(rawTeam || "").trim();
  if (direct) return direct;
  const key = compact(platform);
  if (!key) return "";
  const rule = TEAM_PLATFORM_RULES.find((item) => item.platforms.some((candidate) => compact(candidate) === key));
  return rule?.team || "";
}
