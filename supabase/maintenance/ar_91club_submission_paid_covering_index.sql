-- pg-delta: transaction=false
-- Run sequentially, after the applied index has completed, not in parallel.
create index concurrently ar_91club_recharge_paid_cover_idx
 on public.ar_collected_orders(completed_at) include(member_id)
 where source_system='AR' and country_code='IN' and platform='91CLUB' and order_kind='recharge' and status='已支付';
