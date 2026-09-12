// Display grouping only. Never use this to change collector country codes,
// credentials, source identifiers, or the identity of a stored record.
// The Panda registry has 29 Panghu Brazil platforms; 5C555 is the existing
// non-Panda exception. Ordinary Brazil's three POP platforms are explicit so
// previously cached, incorrectly grouped rows can also be displayed correctly.
const PANGHU_BRAZIL_PLATFORMS = new Set([
  "VIP345", "KKVIP", "KK345", "FF555", "TPTP", "AA45", "F75", "25RR",
  "8599BET", "9596BET", "8566BET", "5V555", "58EE", "27FF", "222O",
  "32QQ", "67VIP", "222VIP", "345F", "234T", "888HH", "BET5697",
  "96F", "45FF", "76PP", "56L", "559K", "2V222", "776F", "5C555"
]);
const ORDINARY_BRAZIL_PLATFORMS = new Set(["POPNOV", "POPFEZ", "POPCRA"]);
const BRAZIL_PLATFORM_ALIASES: Record<string, string> = {
  "FF55": "FF555",
  "222VIP.COM": "222VIP",
  "222-VIP": "222VIP",
  "67-VIP": "67VIP"
};

function displayPlatformKey(platform: string): string {
  const key = platform.trim().toUpperCase();
  // Only observed aliases; removing arbitrary punctuation would merge distinct
  // platforms such as 776-F and 776F.
  return BRAZIL_PLATFORM_ALIASES[key] || key;
}

export function isPanghuBrazilPlatform(platform: string): boolean {
  return PANGHU_BRAZIL_PLATFORMS.has(displayPlatformKey(platform));
}

export function platformDisplayCountry(country: string, platform: string): string {
  const c = country.trim();
  if (c.toUpperCase() !== "BR" && c !== "巴西" && c !== "胖虎巴西") return country;
  const key = displayPlatformKey(platform);
  if (PANGHU_BRAZIL_PLATFORMS.has(key)) return "胖虎巴西";
  if (ORDINARY_BRAZIL_PLATFORMS.has(key) || c.toUpperCase() === "BR") return "巴西";
  return country;
}

export function withPlatformDisplayCountry<T extends {country: string; platform: string}>(row: T): T {
  const country = platformDisplayCountry(row.country, row.platform);
  return country === row.country ? row : {...row, country};
}
