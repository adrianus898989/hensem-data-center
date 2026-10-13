begin;
set local lock_timeout='2s';
set local statement_timeout='8s';
create table private.newar_withdraw_reason_facts (
 record_id uuid primary key references public.newar_detail_records(id) on update cascade on delete cascade,
 platform text not null, created_at timestamptz not null,
 order_number text, amount numeric, display_state text, source_label text,
 received_at timestamptz not null,
 check(display_state is null or (length(display_state) between 1 and 200 and display_state !~ '[[:cntrl:]]')),
 check(source_label is null or (length(source_label)<=256 and source_label !~ '[[:cntrl:]]'))
);
alter table private.newar_withdraw_reason_facts enable row level security;
revoke all on private.newar_withdraw_reason_facts from public,anon,authenticated,service_role;
create index newar_withdraw_reason_facts_platform_created_idx on private.newar_withdraw_reason_facts(platform,created_at);
create function private.newar_withdraw_reason_fact(p public.newar_detail_records)
returns table(record_id uuid,platform text,created_at timestamptz,order_number text,amount numeric,display_state text,source_label text,received_at timestamptz)
language sql immutable set search_path='' as $projector$
 select p.id,p.platform,p.created_at,p.order_number,p.amount,
  case when jsonb_typeof(r."withdrawDisplayState") in('string','number')
   and length(r."withdrawDisplayState" #>> '{}') between 1 and 200 and r."withdrawDisplayState" #>> '{}' !~ '[[:cntrl:]]'
   then r."withdrawDisplayState" #>> '{}' end,
  case when r."businessSchemaVersion" #>> '{}'='2' and r."automaticReasonSource" #>> '{}'='remark'
   and jsonb_typeof(r."automaticReasonLabel")='string'
   and length(r."automaticReasonLabel" #>> '{}')<=256 and r."automaticReasonLabel" #>> '{}' !~ '[[:cntrl:]]'
   then nullif(btrim(r."automaticReasonLabel" #>> '{}'),'') end,p.received_at
 from jsonb_to_record(case when jsonb_typeof(p.raw)='object' then p.raw else '{}'::jsonb end)
  r("businessSchemaVersion" jsonb,"automaticReasonSource" jsonb,"automaticReasonLabel" jsonb,"withdrawDisplayState" jsonb)
 where p.dataset='withdraw';
$projector$;
revoke all on function private.newar_withdraw_reason_fact(public.newar_detail_records) from public,anon,authenticated,service_role;
create function private.sync_newar_withdraw_reason_fact() returns trigger
language plpgsql security definer set search_path='' as $trigger$
begin
 if TG_RELID<>'public.newar_detail_records'::regclass or TG_WHEN<>'AFTER' or TG_LEVEL<>'ROW' then
  raise exception 'newar_withdraw_reason_trigger_context_invalid';
 end if;
 if TG_OP='INSERT' and NEW.dataset<>'withdraw' then return NEW;end if;
 if TG_OP='UPDATE' and OLD.dataset<>'withdraw' and NEW.dataset<>'withdraw' then return NEW;end if;
 if TG_OP='UPDATE' and OLD.id is distinct from NEW.id then
  delete from private.newar_withdraw_reason_facts where record_id=OLD.id;
 end if;
 if NEW.dataset='withdraw' then
  insert into private.newar_withdraw_reason_facts
  select * from private.newar_withdraw_reason_fact(NEW)
  on conflict(record_id) do update set platform=excluded.platform,created_at=excluded.created_at,
   order_number=excluded.order_number,amount=excluded.amount,display_state=excluded.display_state,
   source_label=excluded.source_label,received_at=excluded.received_at;
 else
  delete from private.newar_withdraw_reason_facts where record_id=NEW.id;
 end if;
 return NEW;
end;
$trigger$;
revoke all on function private.sync_newar_withdraw_reason_fact() from public,anon,authenticated,service_role;
create trigger newar_detail_withdraw_reason_sync after insert or update on public.newar_detail_records
 for each row execute function private.sync_newar_withdraw_reason_fact();
create function private.backfill_newar_withdraw_reason_facts(p_platform text,p_start timestamptz,p_end timestamptz,p_limit integer default 200)
returns integer language plpgsql set search_path='' as $backfill$
declare n integer;
begin
 if p_platform is null or p_start is null or p_end is null or p_start>=p_end or p_end-p_start>interval '1 day'
  or p_limit is null or p_limit<1 or p_limit>500 then raise exception 'invalid_reason_backfill_window';end if;
 with source_rows as materialized (
  select s.* from public.newar_detail_records s
  where s.platform=p_platform and s.dataset='withdraw' and s.created_at>=p_start and s.created_at<p_end
   and not exists(select 1 from private.newar_withdraw_reason_facts r where r.record_id=s.id)
  order by s.created_at,s.id limit p_limit for share of s skip locked
 ), inserted as (
  insert into private.newar_withdraw_reason_facts select r.* from source_rows s cross join lateral private.newar_withdraw_reason_fact(s) r
  on conflict(record_id) do nothing returning 1
 ) select count(*)::integer into n from inserted;
 return n;
end;
$backfill$;
revoke all on function private.backfill_newar_withdraw_reason_facts(text,timestamptz,timestamptz,integer) from public,anon,authenticated,service_role;
commit;
