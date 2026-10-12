-- Code-only NEWAR memberDaily core from private.dashboard_admin_live_member_daily.
-- Source/aggregation SQL is unchanged; request literals are parameterized below.
-- No production statistics, result rows, order IDs, credentials or auth claims.
-- This is a local regression fixture, not a callable/authenticated RPC wrapper.
-- $1 platform; $2 direction (all/charge/withdraw); $3 inclusive start;
-- $4 exclusive end; $5 time zone; $6 provider filter (NULL for cover eligibility);
-- $7 currency filter. Whole-day grouping keeps created/success clocks separate.
with events as (
        select 'created'::text as basis,n.created_at as event_at,n.dataset as direction,n.member_id,
          case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
            when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
            else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,n.currency
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where n.platform=$1::text and n.dataset=any(case $2::text when 'all' then array['charge','withdraw'] else array[$2::text] end)
          and n.created_at>=$3::timestamptz and n.created_at<$4::timestamptz and (t.launch_at is null or n.created_at>=t.launch_at)
       union all
        select 'success'::text as basis,n.success_at as event_at,n.dataset as direction,n.member_id,
          case when n.dataset='charge' and coalesce(btrim(n.provider),'')='' and n.channel_type='ManualRecharge' then '人工充值'
            when n.dataset='withdraw' and n.status_group in ('failed','rejected') and coalesce(btrim(n.provider),'') in ('','人工取消') then '无三方（驳回）'
            else coalesce(nullif(btrim(n.provider),''),'未识别通道') end as provider,n.currency
        from public.newar_detail_records n join public.newar_detail_platforms t on t.platform=n.platform
        where n.platform=$1::text and n.dataset=any(case $2::text when 'all' then array['charge','withdraw'] else array[$2::text] end)
          and n.success_at>=$3::timestamptz and n.success_at<$4::timestamptz and (t.launch_at is null or n.created_at>=t.launch_at)
       and n.status_group='success'), filtered as (
    select basis,(event_at at time zone $5::text)::date as date,direction,nullif(btrim(member_id),'') as member_id
    from events where ($6::text[] is null or provider=any($6::text[])) and ($7::text is null or currency=$7::text)
  ), member_orders as (
    -- member_daily_single_group_v1: include NULL IDs to preserve missing-order
    -- coverage; they never count as a member or a frequency-threshold member.
    select date,direction,member_id,
      count(*) filter(where basis='created') as created_count,
      count(*) filter(where basis='success') as success_count
    from filtered group by date,direction,member_id
  ), counts as (
    select date,direction,
      count(*) filter(where member_id is not null and created_count>0) as created_member_count,
      count(*) filter(where member_id is not null and success_count>0) as success_member_count,
      sum(created_count) as created_order_count,
      sum(success_count) as success_order_count,
      coalesce(sum(created_count) filter(where member_id is null),0) as created_missing_member_count,
      coalesce(sum(success_count) filter(where member_id is null),0) as success_missing_member_count,
      count(*) filter(where member_id is not null and created_count>=2) as created_members_ge2,
      count(*) filter(where member_id is not null and created_count>=3) as created_members_ge3,
      count(*) filter(where member_id is not null and created_count>=4) as created_members_ge4,
      count(*) filter(where member_id is not null and created_count>=5) as created_members_ge5,
      count(*) filter(where member_id is not null and success_count>=2) as success_members_ge2,
      count(*) filter(where member_id is not null and success_count>=3) as success_members_ge3,
      count(*) filter(where member_id is not null and success_count>=4) as success_members_ge4,
      count(*) filter(where member_id is not null and success_count>=5) as success_members_ge5
    from member_orders group by date,direction
  ), days as (
    select d::date as date from generate_series(($3::timestamptz at time zone $5::text)::date::timestamp,
      (($4::timestamptz-interval '1 microsecond') at time zone $5::text)::date::timestamp,interval '1 day') d
  ), rows as (
    select days.date,d.direction,coalesce(c.created_member_count,0) as created_member_count,
      coalesce(c.success_member_count,0) as success_member_count,
      coalesce(c.created_order_count,0) as created_order_count,coalesce(c.success_order_count,0) as success_order_count,
      coalesce(c.created_missing_member_count,0) as created_missing_member_count,
      coalesce(c.success_missing_member_count,0) as success_missing_member_count,
      coalesce(c.created_members_ge2,0) as created_members_ge2,
      coalesce(c.created_members_ge3,0) as created_members_ge3,
      coalesce(c.created_members_ge4,0) as created_members_ge4,
      coalesce(c.created_members_ge5,0) as created_members_ge5,
      coalesce(c.success_members_ge2,0) as success_members_ge2,
      coalesce(c.success_members_ge3,0) as success_members_ge3,
      coalesce(c.success_members_ge4,0) as success_members_ge4,
      coalesce(c.success_members_ge5,0) as success_members_ge5
    from days cross join unnest(case $2::text when 'all' then array['charge','withdraw'] else array[$2::text] end) d(direction)
    left join counts c on c.date=days.date and c.direction=d.direction
  ) select coalesce(jsonb_agg(to_jsonb(r) order by r.date,r.direction),'[]'::jsonb) from rows r;
