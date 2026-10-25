CREATE OR REPLACE FUNCTION private.prepared_aggregate_scheduled_due(q jsonb, t jsonb, p_computed timestamp with time zone, p_now timestamp with time zone DEFAULT now())
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare state private.prepared_aggregate_schedule%rowtype;local_computed timestamp;local_day date;window_day date;
begin
 select *into state from private.prepared_aggregate_schedule where singleton;
 if not state.enabled or not exists(select 1 from jsonb_array_elements(state.approved_targets)x where x=t)then return null;end if;
 local_computed:=p_computed at time zone(t->>'timezone');local_day:=(p_now at time zone(t->>'timezone'))::date;
 window_day:=((greatest((q->>'endAt')::timestamptz,coalesce(q->>'successEndAt',q->>'endAt')::timestamptz)-interval'1microsecond')at time zone(t->>'timezone'))::date;
 if window_day>=local_day then return p_computed+make_interval(secs=>state.current_interval_seconds);end if;
 return(case when local_computed::time<time'08:00'then local_computed::date+time'08:00'
  when local_computed::time<time'20:00'then local_computed::date+time'20:00'
  else local_computed::date+1+time'08:00'end)at time zone(t->>'timezone');
end;$function$

