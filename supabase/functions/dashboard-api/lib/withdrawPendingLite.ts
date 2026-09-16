import { platformDisplayCountry } from "./platformDisplayCountry.ts";

const COUNTRIES: Record<string, string> = {
  IN: "印度", INDIA: "印度", 印度线下: "印度", 印度盘口: "印度",
  BR: "巴西", PK: "巴基斯坦", ID: "印尼", VN: "越南", PH: "菲律宾", MY: "马来",
  MM: "缅甸", NG: "尼日利亚", CO: "哥伦比亚", MX: "墨西哥", CL: "智利",
};

export function withdrawPendingCountry(country: string, platform = ""): string {
  const value = String(country || "").trim();
  return platformDisplayCountry(COUNTRIES[value.toUpperCase()] || COUNTRIES[value] || value, platform);
}
