-- MAANWIN is already the registered NEW_AR key, permitted by the receiver,
-- credential scope and workorder validator. The older head-table CHECK alone
-- still rejects it. Keep MAAN.WIN as a client/display alias, never a second key.
-- Only this validated CHECK changes; no grants, scopes, registry or data writes.
begin;
set local lock_timeout = '1s';
set local statement_timeout = '15s';

do $migration$
declare
  before_security jsonb;
  after_security jsonb;
  current_hash text;
  current_validated boolean;
begin
  -- Hold the same lock through guard and replacement so concurrent DDL cannot
  -- invalidate the inspected baseline. Timeout rather than waiting on writers.
  lock table public.workorder_issue_snapshot_heads in access exclusive mode;
  select jsonb_build_array(oid, relowner, relacl::text,
    relrowsecurity, relforcerowsecurity)
    into before_security
    from pg_class where oid='public.workorder_issue_snapshot_heads'::regclass;
  select md5(pg_get_constraintdef(oid)), convalidated
    into current_hash, current_validated
    from pg_constraint
    where conrelid='public.workorder_issue_snapshot_heads'::regclass
      and conname='workorder_issue_snapshot_heads_check' and contype='c';

  if current_validated is distinct from true
    or current_hash is null
    or current_hash not in ('1e4e6ddac7b2a5fa3e41c03082673c4d',
                           '364c8fe11ea369b8ea74cdd1358f9288') then
    raise exception 'MAAN_WORKORDER_HEAD_CHECK_DRIFT';
  end if;
  if current_hash='1e4e6ddac7b2a5fa3e41c03082673c4d' then
    alter table public.workorder_issue_snapshot_heads
      drop constraint workorder_issue_snapshot_heads_check;
    alter table public.workorder_issue_snapshot_heads
      add constraint workorder_issue_snapshot_heads_check check (
        (country_code='PK' and platform in ('POPZAR','92BLAZE')
          and timezone='Asia/Karachi')
        or (country_code='IN' and platform in ('DhaniWin','MAANWIN')
          and timezone='Asia/Kolkata')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.workorder_issue_snapshot_heads'::regclass
      and conname='workorder_issue_snapshot_heads_check' and contype='c'
      and convalidated
      and md5(pg_get_constraintdef(oid))='364c8fe11ea369b8ea74cdd1358f9288'
  ) then
    raise exception 'MAAN_WORKORDER_HEAD_CHECK_POSTCONDITION';
  end if;
  select jsonb_build_array(oid, relowner, relacl::text,
    relrowsecurity, relforcerowsecurity)
    into after_security
    from pg_class where oid='public.workorder_issue_snapshot_heads'::regclass;
  if after_security is distinct from before_security then
    raise exception 'MAAN_WORKORDER_HEAD_SECURITY_CHANGED';
  end if;
end;
$migration$;

commit;
