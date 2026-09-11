-- NEWAR's order remark and member userRemark are independent note channels.
-- Keep v1 clients and all other sources unchanged; never fabricate order remarks.
do $migration$
declare definition text; original text;
begin
  select pg_catalog.pg_get_functiondef('public.withdraw_reasons_assert_snapshot(jsonb)'::regprocedure) into definition;
  original := definition;
  definition := replace(definition,
    '''classifier_version'',''coverage'',''totals'',''groups'']',
    '''classifier_version'',''coverage'',''totals'',''groups'',''note_field'',''member_notes'']');
  definition := replace(definition, '  v_coverage := p_snapshot->''coverage'';', $guard$
  if p_snapshot ? 'note_field' or p_snapshot ? 'member_notes' then
    if p_snapshot->>'source_system' is distinct from 'NEWAR'
      or p_snapshot->>'note_field' is distinct from 'remark' then
      raise exception using errcode = '22023', message = 'WR_INVALID_NOTE_FIELD';
    end if;
    if p_snapshot ? 'member_notes' then
      if pg_catalog.jsonb_typeof(p_snapshot->'member_notes') is distinct from 'object'
        or (p_snapshot->'member_notes') ? 'note_field'
        or (p_snapshot->'member_notes') ? 'member_notes' then
        raise exception using errcode = '22023', message = 'WR_INVALID_MEMBER_NOTES';
      end if;
      perform public.withdraw_reasons_assert_snapshot(p_snapshot->'member_notes');
      foreach v_key in array array['source_system','country_code','platform','stat_date','timezone','snapshot_at','totals'] loop
        if p_snapshot#>array['member_notes',v_key] is distinct from p_snapshot->v_key then
          raise exception using errcode = '22023', message = 'WR_INVALID_MEMBER_SCOPE';
        end if;
      end loop;
      foreach v_key in array array['expected_count','fetched_count','unique_count'] loop
        if p_snapshot#>array['member_notes','coverage',v_key] is distinct from p_snapshot#>array['coverage',v_key] then
          raise exception using errcode = '22023', message = 'WR_INVALID_MEMBER_COVERAGE';
        end if;
      end loop;
    end if;
  end if;
  v_coverage := p_snapshot->'coverage';$guard$);
  if definition = original or position('WR_INVALID_MEMBER_SCOPE' in definition) = 0 then
    raise exception 'Unexpected snapshot validator definition';
  end if;
  execute definition;

  select pg_catalog.pg_get_functiondef('public.publish_withdraw_reasons_snapshot(text,jsonb)'::regprocedure) into definition;
  original := definition;
  definition := replace(definition, 'where excluded.snapshot_at > current_day.snapshot_at',
    $guard$where excluded.snapshot_at > current_day.snapshot_at
        and not (current_day.source_system = 'NEWAR'
          and current_day.snapshot->>'note_field' is not distinct from 'remark'
          and excluded.snapshot->>'note_field' is distinct from 'remark')$guard$);
  if definition = original then raise exception 'Unexpected publication definition'; end if;
  execute definition;
end;
$migration$;

-- Preserve the last complete member-note channel, including the 20 legacy days.
-- An omitted member channel must not erase a previously received one.
create table public.withdraw_member_notes_daily (
  source_system text not null check (source_system = 'NEWAR'),
  country_code text not null,
  platform text not null,
  stat_date date not null,
  snapshot_at timestamptz not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (source_system,country_code,platform,stat_date),
  check (snapshot->>'source_system' = source_system),
  check (snapshot->>'country_code' = country_code),
  check (snapshot->>'platform' = platform),
  check ((snapshot->>'stat_date')::date = stat_date),
  check ((snapshot->>'snapshot_at')::timestamptz = snapshot_at),
  check (snapshot#>'{coverage,complete}' = 'true'::jsonb)
);
alter table public.withdraw_member_notes_daily enable row level security;
revoke all on public.withdraw_member_notes_daily from public,anon,authenticated;
grant select on public.withdraw_member_notes_daily to authenticated;
grant select,insert,update on public.withdraw_member_notes_daily to service_role;
create policy withdraw_member_notes_dashboard_read on public.withdraw_member_notes_daily
  for select to authenticated using ((select public.dashboard_has_permission('auto_withdraw')));

create function public.withdraw_preserve_member_notes()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare member jsonb;
begin
  if new.source_system <> 'NEWAR' then return new; end if;
  member := case when new.snapshot->>'note_field' = 'remark' then new.snapshot->'member_notes' else new.snapshot end;
  if member is null then return new; end if;
  perform public.withdraw_reasons_assert_snapshot(member);
  insert into public.withdraw_member_notes_daily as saved
    (source_system,country_code,platform,stat_date,snapshot_at,snapshot)
  values (new.source_system,new.country_code,new.platform,new.stat_date,
    (member->>'snapshot_at')::timestamptz,member)
  on conflict (source_system,country_code,platform,stat_date) do update
    set snapshot_at=excluded.snapshot_at,snapshot=excluded.snapshot,updated_at=pg_catalog.clock_timestamp()
    where excluded.snapshot_at > saved.snapshot_at;
  return new;
end;
$$;
revoke all on function public.withdraw_preserve_member_notes() from public,anon,authenticated;
grant execute on function public.withdraw_preserve_member_notes() to service_role;
create trigger withdraw_member_notes_after_publish after insert or update on public.withdraw_reasons_daily
  for each row execute function public.withdraw_preserve_member_notes();

insert into public.withdraw_member_notes_daily (source_system,country_code,platform,stat_date,snapshot_at,snapshot,updated_at)
select source_system,country_code,platform,stat_date,snapshot_at,snapshot,updated_at
from public.withdraw_reasons_daily where source_system='NEWAR' and not snapshot ? 'note_field';

create or replace view public.withdraw_reasons_daily_grouped with (security_invoker=true) as
select d.source_system,d.country_code,d.platform,d.stat_date,d.snapshot_id,d.snapshot_at,d.updated_at,
  'reason-category-v1'::text as grouping_version,
  case when d.source_system='NEWAR' and not d.snapshot ? 'note_field' then d.snapshot
    else public.withdraw_reasons_group_snapshot(d.snapshot) end as snapshot,
  m.snapshot as member_notes_snapshot
from public.withdraw_reasons_daily d
left join public.withdraw_member_notes_daily m
  on m.source_system=d.source_system and m.country_code=d.country_code
    and m.platform=d.platform and m.stat_date=d.stat_date;
revoke all on public.withdraw_reasons_daily_grouped from public,anon;
grant select on public.withdraw_reasons_daily_grouped to authenticated,service_role;
notify pgrst, 'reload schema';
