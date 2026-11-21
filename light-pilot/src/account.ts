// A digest of the selected profile's immutable ID, not a credential or a data permission.
export const PILOT_ACCOUNT_DIGEST = "468fe05c2a3f535b3736211f1e684aa5dba36ee25ac458ba0bafe66178e34fd7";

export type PilotProfile = { active: boolean; username: string; auth_user_id: string };

export async function isAdminLightPilot(profile: PilotProfile, sessionId: string): Promise<boolean> {
  if (profile.active !== true || profile.username !== "admin" || profile.auth_user_id !== sessionId) return false;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(sessionId)) return false;
  if (!globalThis.crypto?.subtle) return false;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionId));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("") === PILOT_ACCOUNT_DIGEST;
}
