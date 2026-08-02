export function currentMonthKeyClient(now = new Date()): string {
  return `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyFromDateInput(value: string): string {
  const text = String(value || "").trim();
  const match = text.match(/^(20\d{2})[-\/.](\d{1,2})/);
  if (!match) return "";
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "";
  return `${match[1]}_${String(month).padStart(2, "0")}`;
}

export function monthKeysForDateRange(startDate = "", endDate = ""): string[] {
  const start = monthKeyFromDateInput(startDate);
  const end = monthKeyFromDateInput(endDate || startDate);
  if (!start || !end) return [currentMonthKeyClient()];
  if (start > end) return [start];
  const [sy, sm] = start.split("_").map(Number);
  const [ey, em] = end.split("_").map(Number);
  const cursor = new Date(sy, sm - 1, 1);
  const last = new Date(ey, em - 1, 1);
  const months: string[] = [];
  while (cursor <= last && months.length < 24) {
    months.push(currentMonthKeyClient(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

export function monthRangeSignature(startDate = "", endDate = ""): string {
  return monthKeysForDateRange(startDate, endDate).join(",");
}

export function rangeIncludesCurrentMonthClient(startDate = "", endDate = ""): boolean {
  const now = new Date();
  const months = monthKeysForDateRange(startDate, endDate);
  const active = new Set([currentMonthKeyClient(now)]);
  if (now.getDate() <= 7) {
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    active.add(currentMonthKeyClient(previous));
  }
  return months.some((month) => active.has(month));
}

export function monthlyApiUrl(base: string, startDate = "", endDate = "", version = ""): string {
  const params = new URLSearchParams();
  if (startDate) params.set("start", startDate);
  if (endDate || startDate) params.set("end", endDate || startDate);
  // V237：只有状态 checksum 真正变化时才改变 URL。
  // 同一版本反复 F5 可继续命中浏览器/CDN 缓存；新版本立即绕过旧 CDN 内容。
  if (version) params.set("v", version);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
