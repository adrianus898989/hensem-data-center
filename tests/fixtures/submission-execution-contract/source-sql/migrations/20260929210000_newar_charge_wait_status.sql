-- The collector recognized Payed and Cancel but left rechargeState=Wait as
-- unknown. Normalize this exact pending state at the storage boundary so old
-- collectors cannot reintroduce it; preserve the source code and raw payload.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

create or replace function private.newar_detail_normalize_wait_status()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.dataset='charge' and new.status_code='Wait' and new.status_group='unknown'
  and coalesce(nullif(new.raw->>'rechargeState',''),'Wait')='Wait'
  and new.success_at is null then
  new.status_group:='pending';
 end if;
 return new;
end;
$$;
revoke all on function private.newar_detail_normalize_wait_status() from public,anon,authenticated;
drop trigger if exists newar_detail_normalize_wait_status on public.newar_detail_records;
create trigger newar_detail_normalize_wait_status
before insert or update of dataset,status_code,status_group,raw,success_at
on public.newar_detail_records for each row
execute function private.newar_detail_normalize_wait_status();

update public.newar_detail_records
set status_group='pending'
where dataset='charge' and status_code='Wait' and status_group='unknown'
 and coalesce(nullif(raw->>'rechargeState',''),'Wait')='Wait'
 and success_at is null;

notify pgrst,'reload schema';
commit;
