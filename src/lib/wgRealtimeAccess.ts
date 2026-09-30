import type {DashboardProfile} from './dashboardAuthClient';
import type {DashboardRoleAccess} from './dashboardRoleAccess';

// This endpoint deliberately retains the existing coarse-module gateway.
// Assigned roles must not gain a new unregistered page/action implicitly.
export function wgRealtimeAllowed(profile: DashboardProfile, access: DashboardRoleAccess | null): boolean {
  return profile.active === true && !!access?.canView && access.mode !== 'assigned'
    && (profile.role === 'owner' || profile.permissions?.auto_withdraw === true);
}
export function wgRealtimeFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('wg') === 'realtime';
}
