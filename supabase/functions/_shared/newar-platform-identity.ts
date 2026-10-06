// One confirmed collector spelling, not a fuzzy platform or authorization map.
// Credentials/registries stay canonical; SQL rechecks the canonical scope.
type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const ROW_FIELDS = ["rows", "operator_rows", "employee_rows", "type_rows", "third_party_rows"];
export const canonicalNewarPlatform = (value: unknown): unknown => value === "MAAN.WIN" ? "MAANWIN" : value;

export function canonicalMaanScope<T>(value: T): T {
  return object(value) && value.country_code === "IN" && value.platform === "MAAN.WIN"
    ? {...value, platform: "MAANWIN"} as T : value;
}
export function canonicalMaanSnapshot<T>(value: T): T {
  const snapshot = canonicalMaanScope(value);
  return object(snapshot) && object(snapshot.member_notes)
    ? {...snapshot, member_notes: canonicalMaanScope(snapshot.member_notes)} as T : snapshot;
}
function mapRows(payload: unknown, from: string, to: string): unknown {
  if (!object(payload)) return payload;
  const result = {...payload};
  for (const field of ROW_FIELDS) if (Array.isArray(payload[field])) {
    result[field] = (payload[field] as unknown[]).map(row => object(row) && row.platform === from ? {...row, platform: to} : row);
  }
  return result;
}
export function canonicalNewarEnvelope<T>(value: T): T {
  if (!object(value) || canonicalNewarPlatform(value.platform) !== "MAANWIN") return value;
  return {...value, platform: "MAANWIN", ...("payload" in value ? {payload: mapRows(value.payload, "MAAN.WIN", "MAANWIN")} : {})} as T;
}
// Apply only after validating the canonical database acknowledgement.
export function echoMaanEnvelope<T>(value: T, requestedPlatform: unknown): T {
  if (requestedPlatform !== "MAAN.WIN" || !object(value) || value.platform !== "MAANWIN") return value;
  return {...value, platform: "MAAN.WIN", ...("payload" in value ? {payload: mapRows(value.payload, "MAANWIN", "MAAN.WIN")} : {})} as T;
}
export function echoMaanScope<T>(value: T, requestedPlatform: unknown): T {
  if (!object(value) || value.country_code !== "IN") return value;
  const result = echoMaanEnvelope(value, requestedPlatform);
  return {...result,
    ...(object(result.member_notes) ? {member_notes: echoMaanScope(result.member_notes, requestedPlatform)} : {}),
    ...(object(result.snapshot) ? {snapshot: echoMaanScope(result.snapshot, requestedPlatform)} : {})} as T;
}

export const MAAN_LAUNCH = Date.parse("2026-10-05T18:30:00Z");
// These checks apply to the exact platform in both spellings, even if country
// is wrong; they do not turn a foreign-country alias into an authorized scope.
export function validMaanSnapshot(value: Json, now: number, source: string | string[]): boolean {
  if (!["MAANWIN", "MAAN.WIN"].includes(String(value.platform))) return true;
  const sources = Array.isArray(source) ? source : [source];
  const observed = Date.parse(String(value.snapshot_at ?? value.observed_at));
  const day = value.stat_date ?? value.observed_local_date;
  return value.country_code === "IN" && value.timezone === "Asia/Kolkata"
    && sources.includes(String(value.source_system)) && typeof day === "string" && day >= "2026-10-06"
    && Number.isFinite(observed) && observed >= MAAN_LAUNCH && now >= MAAN_LAUNCH;
}
