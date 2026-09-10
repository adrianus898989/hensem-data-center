-- Older daily reports can come from immutable snapshots rather than the live
-- auto_withdraw_daily table. Keep the same editor permissions for their notes.
alter policy auto_withdraw_notes_insert on public.auto_withdraw_notes
with check (
  (select public.dashboard_has_permission('auto_withdraw'))
  and exists (
    select 1 from public.dashboard_profiles p
    where p.auth_user_id = (select auth.uid()) and p.active and p.role in ('owner', 'admin')
  )
  and updated_by = (select auth.uid())
);
