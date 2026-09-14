-- Additive original-sheet presentation snapshots. No fee/business/cron objects are changed.
begin;

create table public.third_party_rate_original_workbooks (
  source_key text primary key default 'default' check (source_key = 'default'),
  run_id uuid,
  metadata jsonb,
  collected_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  check ((run_id is null and metadata is null and collected_at is null)
    or (run_id is not null and metadata is not null and collected_at is not null)),
  check ((lease_id is null) = (lease_until is null)),
  check (last_error is null or last_error ~ '^[a-z][a-z0-9_]{0,79}$')
);
create table public.third_party_rate_original_sheets (
  run_id uuid not null,
  sheet_id bigint not null check (sheet_id between 0 and 2147483647),
  payload jsonb not null,
  collected_at timestamptz not null default now(),
  primary key (run_id, sheet_id),
  check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16777216)
);
insert into public.third_party_rate_original_workbooks(source_key) values ('default');

alter table public.third_party_rate_original_workbooks enable row level security;
alter table public.third_party_rate_original_sheets enable row level security;
revoke all on public.third_party_rate_original_workbooks, public.third_party_rate_original_sheets from public, anon, authenticated;
grant all on public.third_party_rate_original_workbooks, public.third_party_rate_original_sheets to service_role;
-- INVOKER reader needs SELECT, but neither lease diagnostics nor writes are exposed.
grant select (source_key,run_id,metadata,collected_at) on public.third_party_rate_original_workbooks to authenticated;
grant select on public.third_party_rate_original_sheets to authenticated;

create policy original_workbook_read on public.third_party_rate_original_workbooks
  for select to authenticated using (
    run_id is not null and (select auth.uid()) is not null
    and (select public.dashboard_has_permission('third_party')) is true
    and ((select private.dashboard_current_data_scope())->>'mode') = 'all'
  );
create policy original_sheet_read on public.third_party_rate_original_sheets
  for select to authenticated using (
    (select auth.uid()) is not null
    and (select public.dashboard_has_permission('third_party')) is true
    and ((select private.dashboard_current_data_scope())->>'mode') = 'all'
    and run_id = (select w.run_id from public.third_party_rate_original_workbooks w where w.source_key = 'default')
  );

create function private.original_rate_uint(p_value jsonb, p_max bigint)
returns boolean language sql immutable security invoker set search_path = '' as $fn$
  select case when jsonb_typeof(p_value) = 'number' and p_value::text ~ '^(0|[1-9][0-9]*)$'
    then (p_value::text)::numeric <= p_max else false end;
$fn$;

create function private.original_rate_meta_valid(p_meta jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $fn$
declare s jsonb; ids bigint[] := '{}'; positions bigint[] := '{}'; sid bigint; pos bigint;
begin
  if jsonb_typeof(p_meta) is distinct from 'object'
    or not (p_meta ?& array['title','sheets','fetchedAt'])
    or p_meta - array['title','sheets','fetchedAt'] <> '{}'::jsonb
    or jsonb_typeof(p_meta->'title') is distinct from 'string' or length(p_meta->>'title') > 1000
    or jsonb_typeof(p_meta->'fetchedAt') is distinct from 'string'
    or (p_meta->>'fetchedAt') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
    or jsonb_typeof(p_meta->'sheets') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_meta->'sheets') not between 1 and 64 or octet_length(p_meta::text) > 262144 then return false; end if;
  perform (p_meta->>'fetchedAt')::timestamptz;
  for s in select value from jsonb_array_elements(p_meta->'sheets') loop
    if jsonb_typeof(s) is distinct from 'object'
      or not (s ?& array['sheetId','title','index','rowCount','columnCount','frozenRowCount','frozenColumnCount'])
      or s - array['sheetId','title','index','rowCount','columnCount','frozenRowCount','frozenColumnCount','hidden'] <> '{}'::jsonb
      or jsonb_typeof(s->'title') is distinct from 'string' or length(s->>'title') not between 1 and 1000
      or not private.original_rate_uint(s->'sheetId',2147483647)
      or not private.original_rate_uint(s->'index',2147483647)
      or not private.original_rate_uint(s->'rowCount',10000)
      or not private.original_rate_uint(s->'columnCount',512)
      or not private.original_rate_uint(s->'frozenRowCount',10000)
      or not private.original_rate_uint(s->'frozenColumnCount',512)
      or (s ? 'hidden' and s->'hidden' is distinct from 'false'::jsonb) then return false; end if;
    if (s->>'rowCount')::int < 1 or (s->>'columnCount')::int < 1
      or (s->>'rowCount')::int * (s->>'columnCount')::int > 250000
      or (s->>'frozenRowCount')::int > (s->>'rowCount')::int
      or (s->>'frozenColumnCount')::int > (s->>'columnCount')::int then return false; end if;
    sid := (s->>'sheetId')::bigint; pos := (s->>'index')::bigint;
    if sid = any(ids) or pos = any(positions) then return false; end if;
    ids := array_append(ids,sid); positions := array_append(positions,pos);
  end loop;
  return true;
exception when others then return false;
end;
$fn$;

-- Allocation dimensions in payload.sheet are native metadata; payload.rowCount
-- and columnCount may be a smaller, fully rectangular used range. Never pad/truncate.
create function private.original_rate_grid_valid(p_payload jsonb, p_sheet jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $fn$
declare nr integer; nc integer; r jsonb; c jsonb; v jsonb; a text; seen bigint[]; n bigint;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or not (p_payload ?& array['sheet','cells','merges','rowHeights','columnWidths','hiddenRows','hiddenColumns','fetchedAt','rowCount','columnCount'])
    or p_payload - array['sheet','cells','merges','rowHeights','columnWidths','hiddenRows','hiddenColumns','fetchedAt','rowCount','columnCount'] <> '{}'::jsonb
    or p_payload->'sheet' is distinct from p_sheet
    or octet_length(p_payload::text) > 16777216
    or not private.original_rate_uint(p_payload->'rowCount',10000)
    or not private.original_rate_uint(p_payload->'columnCount',512)
    or jsonb_typeof(p_payload->'fetchedAt') is distinct from 'string'
    or (p_payload->>'fetchedAt') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' then return false; end if;
  perform (p_payload->>'fetchedAt')::timestamptz;
  nr := (p_payload->>'rowCount')::int; nc := (p_payload->>'columnCount')::int;
  if nr < 1 or nc < 1 or nr*nc > 250000
    or nr > (p_sheet->>'rowCount')::int or nc > (p_sheet->>'columnCount')::int
    or nr < (p_sheet->>'frozenRowCount')::int or nc < (p_sheet->>'frozenColumnCount')::int then return false; end if;
  foreach a in array array['cells','merges','rowHeights','columnWidths','hiddenRows','hiddenColumns'] loop
    if jsonb_typeof(p_payload->a) is distinct from 'array' then return false; end if;
  end loop;
  if jsonb_array_length(p_payload->'cells') <> nr or jsonb_array_length(p_payload->'rowHeights') <> nr
    or jsonb_array_length(p_payload->'columnWidths') <> nc or jsonb_array_length(p_payload->'merges') > 10000 then return false; end if;
  for r in select value from jsonb_array_elements(p_payload->'cells') loop
    if jsonb_typeof(r) is distinct from 'array' or jsonb_array_length(r) <> nc then return false; end if;
    for c in select value from jsonb_array_elements(r) loop
      if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'text') is distinct from 'string'
        or c - array['text','format','runs'] <> '{}'::jsonb
        or (c ? 'format' and jsonb_typeof(c->'format') is distinct from 'object')
        or (c ? 'runs' and jsonb_typeof(c->'runs') is distinct from 'array') then return false; end if;
    end loop;
  end loop;
  foreach a in array array['rowHeights','columnWidths'] loop
    for v in select value from jsonb_array_elements(p_payload->a) loop
      if not private.original_rate_uint(v,10000) then return false; end if;
    end loop;
  end loop;
  foreach a in array array['hiddenRows','hiddenColumns'] loop
    seen := '{}';
    for v in select value from jsonb_array_elements(p_payload->a) loop
      if not private.original_rate_uint(v,case when a='hiddenRows' then nr-1 else nc-1 end) then return false; end if;
      n := (v::text)::bigint; if n = any(seen) then return false; end if; seen := array_append(seen,n);
    end loop;
  end loop;
  for v in select value from jsonb_array_elements(p_payload->'merges') loop
    if jsonb_typeof(v) is distinct from 'object'
      or not (v ?& array['startRowIndex','endRowIndex','startColumnIndex','endColumnIndex'])
      or v - array['startRowIndex','endRowIndex','startColumnIndex','endColumnIndex'] <> '{}'::jsonb
      or not private.original_rate_uint(v->'startRowIndex',nr-1) or not private.original_rate_uint(v->'endRowIndex',nr)
      or not private.original_rate_uint(v->'startColumnIndex',nc-1) or not private.original_rate_uint(v->'endColumnIndex',nc) then return false; end if;
    if (v->>'startRowIndex')::int >= (v->>'endRowIndex')::int or (v->>'startColumnIndex')::int >= (v->>'endColumnIndex')::int then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$fn$;

create function public.original_rate_sync_claim(p_run_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $fn$
declare w public.third_party_rate_original_workbooks%rowtype;
begin
  if p_run_id is null then return false; end if;
  select * into w from public.third_party_rate_original_workbooks where source_key='default' for update;
  if not found or w.run_id = p_run_id or w.lease_until > clock_timestamp()
    or exists(select 1 from public.third_party_rate_original_sheets where run_id=p_run_id) then return false; end if;
  update public.third_party_rate_original_workbooks set lease_id=p_run_id,
    lease_until=clock_timestamp()+interval '8 minutes',last_attempt_at=clock_timestamp(),last_error=null where source_key='default';
  return true;
end;
$fn$;

-- Concurrent staging and publication share the same single-row lock. A late
-- HTTP retry cannot edit a generation after publication or after losing a lease.
create function private.original_rate_stage_guard()
returns trigger language plpgsql security invoker set search_path = '' as $fn$
declare w public.third_party_rate_original_workbooks%rowtype;
begin
  select * into w from public.third_party_rate_original_workbooks where source_key='default' for share;
  if not found or w.lease_id is distinct from new.run_id or w.lease_until is null
    or w.lease_until <= clock_timestamp() or w.run_id = new.run_id
    or (tg_op='UPDATE' and (old.run_id is distinct from new.run_id or old.sheet_id is distinct from new.sheet_id)) then
    raise exception 'original_rate_lease_lost' using errcode='55000';
  end if;
  return new;
end;
$fn$;
create trigger original_rate_stage_guard before insert or update on public.third_party_rate_original_sheets
  for each row execute function private.original_rate_stage_guard();

create function public.original_rate_sync_publish(p_run_id uuid, p_meta jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $fn$
declare w public.third_party_rate_original_workbooks%rowtype; s jsonb; staged jsonb; previous_run uuid;
begin
  if p_run_id is null then return false; end if;
  select * into w from public.third_party_rate_original_workbooks where source_key='default' for update;
  if not found then return false; end if;
  -- A lost successful ACK may be retried without changing any published data.
  if w.run_id = p_run_id then return w.metadata = p_meta; end if;
  if w.lease_id is distinct from p_run_id or w.lease_until is null or w.lease_until <= clock_timestamp()
    or not private.original_rate_meta_valid(p_meta) then return false; end if;
  if (select count(*) from public.third_party_rate_original_sheets where run_id=p_run_id) <> jsonb_array_length(p_meta->'sheets') then return false; end if;
  for s in select value from jsonb_array_elements(p_meta->'sheets') loop
    select payload into staged from public.third_party_rate_original_sheets where run_id=p_run_id and sheet_id=(s->>'sheetId')::bigint;
    if not found or not private.original_rate_grid_valid(staged,s) then return false; end if;
  end loop;
  -- Validation itself must not outlive the claim; never publish an expired run.
  if w.lease_until <= clock_timestamp() then return false; end if;
  previous_run := w.run_id;
  update public.third_party_rate_original_workbooks set run_id=p_run_id,metadata=p_meta,
    collected_at=clock_timestamp(),lease_id=null,lease_until=null,last_error=null where source_key='default';
  -- Transactional cleanup only touches this feature's generations, retaining
  -- the new publication and its immediately preceding successful publication.
  delete from public.third_party_rate_original_sheets
    where run_id <> p_run_id and (previous_run is null or run_id <> previous_run);
  return true;
end;
$fn$;

create function public.original_rate_sync_fail(p_run_id uuid, p_message text)
returns void language plpgsql security invoker set search_path = '' as $fn$
begin
  update public.third_party_rate_original_workbooks set lease_id=null,lease_until=null,
    last_error=case when p_message ~ '^original_[a-z0-9_]{1,70}$' then p_message else 'original_source_unavailable' end
    where source_key='default' and lease_id=p_run_id;
end;
$fn$;

create function public.dashboard_original_rate_sheet(p_sheet_id bigint default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $fn$
declare result jsonb;
begin
  if (select auth.uid()) is null or (select public.dashboard_has_permission('third_party')) is not true
    or ((select private.dashboard_current_data_scope())->>'mode') is distinct from 'all' then
    raise exception 'original_rate_permission_denied' using errcode='42501';
  end if;
  if p_sheet_id is not null and (p_sheet_id < 0 or p_sheet_id > 2147483647) then return null; end if;
  if p_sheet_id is null then
    select metadata into result from public.third_party_rate_original_workbooks where source_key='default' and run_id is not null;
  else
    select s.payload into result from public.third_party_rate_original_sheets s
      join public.third_party_rate_original_workbooks w on w.source_key='default' and s.run_id=w.run_id
      where s.sheet_id=p_sheet_id;
  end if;
  return result;
end;
$fn$;

revoke all on function private.original_rate_uint(jsonb,bigint), private.original_rate_meta_valid(jsonb),
  private.original_rate_grid_valid(jsonb,jsonb), private.original_rate_stage_guard() from public, anon, authenticated;
grant execute on function private.original_rate_uint(jsonb,bigint), private.original_rate_meta_valid(jsonb),
  private.original_rate_grid_valid(jsonb,jsonb), private.original_rate_stage_guard() to service_role;
revoke all on function public.original_rate_sync_claim(uuid), public.original_rate_sync_publish(uuid,jsonb),
  public.original_rate_sync_fail(uuid,text) from public, anon, authenticated;
grant execute on function public.original_rate_sync_claim(uuid), public.original_rate_sync_publish(uuid,jsonb),
  public.original_rate_sync_fail(uuid,text) to service_role;
revoke all on function public.dashboard_original_rate_sheet(bigint) from public, anon, authenticated;
grant execute on function public.dashboard_original_rate_sheet(bigint) to authenticated, service_role;

commit;
