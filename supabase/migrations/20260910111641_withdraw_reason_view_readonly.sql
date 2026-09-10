-- Supabase default privileges may grant ALL on newly created views to service_role.
-- This derived read model must never be an alternative write path to raw snapshots.
revoke all on public.withdraw_reasons_daily_grouped from service_role;
grant select on public.withdraw_reasons_daily_grouped to service_role;
