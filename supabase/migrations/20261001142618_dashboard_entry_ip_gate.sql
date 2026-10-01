-- This opening check is callable only by the trusted server. It does not
-- grant login, a session, role permissions or any ingestion/database access.
begin;
create or replace function public.application_dashboard_entry_allowed(p_ip text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare entry_ip inet; enabled boolean;
begin
 if p_ip is null or length(p_ip)>64 or p_ip<>btrim(p_ip) then return false; end if;
 begin entry_ip:=p_ip::inet; exception when invalid_text_representation then return false; end;
 if masklen(entry_ip)<>(case family(entry_ip) when 4 then 32 else 128 end) then return false; end if;
 select ip_whitelist_enabled into enabled from public.dashboard_security_settings where id=1;
 -- Backend opening is always protected. Missing/disabled settings fail closed.
 if enabled is distinct from true then return false; end if;
 if exists(select 1 from public.dashboard_ip_whitelist r
  where r.active and entry_ip <<= private.application_network(r.ip)) then return true; end if;
 -- A bound rule may open the login page, but only its account can subsequently
 -- authenticate from that address. Inactive/locked/banned account rules do not
 -- open an otherwise unlisted address; dormant inherited rules do not either.
 return exists(select 1 from private.application_account_ip_rules r
  join private.application_account_security s on s.user_id=r.user_id and s.surface=r.surface
  join auth.users u on u.id=r.user_id
  where r.surface='dashboard' and r.active and entry_ip <<= r.network
   and s.ip_mode='allowlist' and s.locked_at is null
   and private.application_account_exists(r.user_id,'dashboard',true)
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()));
end $$;
revoke all on function public.application_dashboard_entry_allowed(text) from public,anon,authenticated;
grant execute on function public.application_dashboard_entry_allowed(text) to service_role;
comment on function public.application_dashboard_entry_allowed(text) is
 'Server-only dashboard opening decision: global IP or eligible bound account IP. Never creates a login or bypasses account authorization.';
commit;
