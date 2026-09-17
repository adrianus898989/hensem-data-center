alter table if exists public.workorder_deposit_daily
  add column if not exists withdraw_success_count bigint not null default 0,
  add column if not exists withdraw_success_amount numeric(24,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workorder_deposit_daily'::regclass
      and conname = 'workorder_deposit_daily_withdraw_success_count_check'
  ) then
    alter table public.workorder_deposit_daily
      add constraint workorder_deposit_daily_withdraw_success_count_check
      check (withdraw_success_count >= 0 and withdraw_success_count <= withdraw_not_received_count);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workorder_deposit_daily'::regclass
      and conname = 'workorder_deposit_daily_withdraw_success_amount_check'
  ) then
    alter table public.workorder_deposit_daily
      add constraint workorder_deposit_daily_withdraw_success_amount_check
      check (withdraw_success_amount >= 0 and withdraw_success_amount <= withdraw_not_received_amount);
  end if;
end
$$;
