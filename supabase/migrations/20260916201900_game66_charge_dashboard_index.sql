-- The dashboard filters GAME66 charge orders by business-day range before
-- grouping them by team/platform.  A create_time-leading covering index keeps
-- that query bounded to the requested dates while collectors append history.
create index if not exists game66_charge_orders_dashboard_cover_idx
  on public.game66_charge_orders (create_time, platform_id)
  include (
    status_code,
    pay_method_name,
    pay_method_code,
    channel,
    pay_mode,
    amount_display,
    amount_minor,
    last_seen_at
  );
