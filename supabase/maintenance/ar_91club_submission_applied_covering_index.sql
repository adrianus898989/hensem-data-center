-- pg-delta: transaction=false
-- Run as a single standalone maintenance statement AFTER the metadata preflight.
-- Do not wrap in BEGIN/DO, use IF NOT EXISTS, or automatically drop a failed index.
create index concurrently ar_91club_recharge_applied_cover_idx
 on public.ar_collected_orders(applied_at)
 include(order_no,member_id,status,raw_channel,member_level,recharge_count)
 where source_system='AR' and country_code='IN' and platform='91CLUB' and order_kind='recharge';
