-- Owner-confirmed native withdrawal unit for fifteen exact current AR identities.
-- Preserve source currency, collector ACK, evidence validation, archive immutability
-- and midnight classification. No existing archive/order/catalog/fee data changes.
begin;
set local lock_timeout='3s';set local statement_timeout='15s';
do $unit$
declare original text;patched text;old_metadata jsonb;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into original,old_metadata from pg_proc p
 where p.oid='private.archive_withdraw_pending_capture(text,text,text,timestamptz)'::regprocedure;
 if old_metadata->>'proowner'<>'postgres'::regrole::oid::text
   or old_metadata->>'prosecdef'<>'true' or old_metadata->>'provolatile'<>'v'
   or old_metadata->'proconfig' is distinct from to_jsonb(array['search_path=""']::text[])
   or old_metadata->'proacl' is distinct from to_jsonb(array['postgres=X/postgres','service_role=X/postgres']::text[]) then
  raise exception 'pending_ar_unit_metadata_drift';end if;
 if (select md5(prosrc) from pg_proc where oid='private.archive_withdraw_pending_capture(text,text,text,timestamptz)'::regprocedure)='28310f670814b20201c42c7af64b0ebd'
   and md5(original)='b8b6aef156347f7292427f71a46ace2b' then return;end if;
 if (select md5(prosrc) from pg_proc where oid='private.archive_withdraw_pending_capture(text,text,text,timestamptz)'::regprocedure)<>'150cd34b42791d3baef03e9e12a73676'
   or md5(original)<>'ca40eddbdd9f4c940d92ee1550f18ed7' then raise exception 'pending_ar_unit_baseline_drift';end if;
 patched:=original;
  if length(original)-length(replace(original,$needle0$  bad_partitions boolean; bad_orders boolean; native_candidates jsonb; identity jsonb;$needle0$,''))<>length($needle0$  bad_partitions boolean; bad_orders boolean; native_candidates jsonb; identity jsonb;$needle0$) then raise exception 'pending_ar_unit_patch_location_drift';end if;
  patched:=replace(patched,$needle0$  bad_partitions boolean; bad_orders boolean; native_candidates jsonb; identity jsonb;$needle0$,$replacement0$  bad_partitions boolean; bad_orders boolean; native_candidates jsonb; identity jsonb; source_currency_absent boolean;$replacement0$);
  if length(original)-length(replace(original,$needle1$'pending_count',n,'pending_amount',amount) order by raw_channel,channel_type),'[]'::jsonb) from provider_totals)
  into partition_count$needle1$,''))<>length($needle1$'pending_count',n,'pending_amount',amount) order by raw_channel,channel_type),'[]'::jsonb) from provider_totals)
  into partition_count$needle1$) then raise exception 'pending_ar_unit_patch_location_drift';end if;
  patched:=replace(patched,$needle1$'pending_count',n,'pending_amount',amount) order by raw_channel,channel_type),'[]'::jsonb) from provider_totals)
  into partition_count$needle1$,$replacement1$'pending_count',n,'pending_amount',amount) order by raw_channel,channel_type),'[]'::jsonb) from provider_totals),
    (select coalesce(bool_and(not(d.snapshot ?| array['currency','currency_code','amount_currency'])),true) from days d)
  into partition_count$replacement1$);
  if length(original)-length(replace(original,$needle2$partitions,detail_rows,groups_actual;$needle2$,''))<>length($needle2$partitions,detail_rows,groups_actual;$needle2$) then raise exception 'pending_ar_unit_patch_location_drift';end if;
  patched:=replace(patched,$needle2$partitions,detail_rows,groups_actual;$needle2$,$replacement2$partitions,detail_rows,groups_actual,source_currency_absent;$replacement2$);
  if length(original)-length(replace(original,$needle3$  insert into private.withdraw_pending_capture_archive(source_system$needle3$,''))<>length($needle3$  insert into private.withdraw_pending_capture_archive(source_system$needle3$) then raise exception 'pending_ar_unit_patch_location_drift';end if;
  patched:=replace(patched,$needle3$  insert into private.withdraw_pending_capture_archive(source_system$needle3$,$replacement3$  -- The owner confirmed the native withdrawal amount unit for these exact
  -- current M8/AR identities. This is a withdrawal-only unit rule, not a fee,
  -- deposit, country-wide or shared catalog currency default. Original source
  -- currencies win; unsupported explicit payload currency blocks this fallback.
  -- The rule starts with the current capture calendar, never rebinding older
  -- observations or updating any existing immutable archive on replay.
  if identity is not null and identity->>'currency' is null
    and h.source_system='WITHDRAW_REVIEW' and h.country_code='IN'
    and identity->>'source_system'='AR' and identity->>'team_name'='M8'
    and h.snapshot->>'timezone'='Asia/Kolkata' and h.capture_date>=date '2026-10-04'
    and source_currency_absent and not(h.snapshot ?| array['currency','currency_code','amount_currency'])
    and (h.platform,(identity->>'platform_id')::uuid) in (
      ('51GAME','e7c4101c-bd8e-d51d-436a-6ffa61077937'::uuid),
      ('55CLUB','5004c450-fef5-1ce9-d4b1-a61055cc0e2f'::uuid),
      ('6CLUB','731dd8f6-db82-eef0-da03-99211387e514'::uuid),
      ('82LOTTERY','3aa6d428-6da6-fa9b-3a61-2b269ce2c8f0'::uuid),
      ('91CLUB','5e952cbb-e42f-d6b1-a24a-a0d42d165df9'::uuid),
      ('BIGMUMBAI','b40ec767-829c-db68-d774-a940150deb2a'::uuid),
      ('IN999','0c93b920-a24b-84f1-bba4-f4df868f6910'::uuid),
      ('JAICLUB','5c4e9b73-6a94-053f-c42c-22a35e03f959'::uuid),
      ('JALWA','72b27b17-4cdd-8d41-e39a-875ff42cd25a'::uuid),
      ('LOTTERY7','40433510-a19b-1810-6ec0-2b32be9e1f72'::uuid),
      ('OKWIN','43766f8a-87dd-8aab-e8c7-9d4853cdbca2'::uuid),
      ('RAJA','f6de813a-d0da-804d-e1e1-d38e4cc287a8'::uuid),
      ('Shree.Win','fef148af-9325-e1b7-5daf-73c0e796d8a4'::uuid),
      ('TPPLAY','57cd0f0e-c685-8be1-dc2b-52c9672e33df'::uuid),
      ('Veer.Game','dba5345b-e924-e014-5bda-f4abc8895925'::uuid)
    ) then
    identity:=jsonb_set(identity,'{currency}','"INR"'::jsonb);
  end if;
  insert into private.withdraw_pending_capture_archive(source_system$replacement3$);
 execute patched;
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.archive_withdraw_pending_capture(text,text,text,timestamptz)'::regprocedure) is distinct from old_metadata
   or (select md5(prosrc) from pg_proc where oid='private.archive_withdraw_pending_capture(text,text,text,timestamptz)'::regprocedure)<>'28310f670814b20201c42c7af64b0ebd'
   or md5(pg_get_functiondef('private.archive_withdraw_pending_capture(text,text,text,timestamptz)'::regprocedure))<>'b8b6aef156347f7292427f71a46ace2b' then
  raise exception 'pending_ar_unit_target_drift';end if;
end $unit$;
notify pgrst,'reload schema';commit;
