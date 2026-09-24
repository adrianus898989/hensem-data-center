// Explicit public request shapes. Database functions recheck permissions and scope.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateConfigurationRequest(p: Record<string, unknown>): Record<string, unknown> {
  if (p.action === "configurationAccess") {
    if (Object.keys(p).some(k => k !== "action")) throw Error("归类权限参数无效");
    return {...p};
  }
  if (p.action === "providerOptions") {
    if (Object.keys(p).some(k => !["action", "platformIds", "direction"].includes(k))
      || !Array.isArray(p.platformIds) || p.platformIds.length > 200
      || p.platformIds.some(v => typeof v !== "string" || !uuid.test(v))
      || (p.direction !== undefined && (typeof p.direction !== "string" || !["all", "charge", "withdraw"].includes(p.direction)))) throw Error("三方目录范围无效");
    return {...p};
  }
  const fields: Record<string, string[]> = {
    provider: ["country", "platform", "rawProvider", "canonicalProvider", "expectedVersion"],
    platform: ["mappingId", "team", "system", "sourceSystem", "country", "countryCode", "sourceCountry", "sourcePlatform", "platformName", "expectedVersion"],
    grant: ["userId", "canManage"],
  };
  const keys = typeof p.operation === "string" ? fields[p.operation] : undefined;
  if (!keys || Object.keys(p).some(k => !["action", "operation", ...keys].includes(k))) throw Error("归类保存参数无效");
  for (const key of keys) {
    if (key === "canManage") { if (typeof p[key] !== "boolean") throw Error("归类权限值无效"); continue; }
    if (key === "mappingId" && p[key] === undefined) continue;
    const value = p[key];
    if (typeof value !== "string" || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)
      || (!["rawProvider", "mappingId"].includes(key) && !value.trim())) throw Error("请完整填写归类信息");
  }
  for (const key of ["userId", "mappingId"]) if (p[key] && !uuid.test(String(p[key]))) throw Error("归类对象无效");
  if (p.expectedVersion !== undefined && !/^[0-9a-f]{32}$/.test(String(p.expectedVersion))) throw Error("请刷新后再归类");
  return {...p};
}
