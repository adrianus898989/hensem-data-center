create or replace function private.provider_snapshot_enqueue(p_target jsonb,p_request jsonb,p_component text,p_not_before timestamptz default now())
returns uuid language plpgsql volatile security invoker set search_path='' as $fn$
declare t jsonb;q jsonb;k jsonb;f timestamptz;e timestamptz;j uuid;
begin
 t:=private.provider_snapshot_target(p_target);
 if not private.provider_snapshot_target_current(t)then raise exception using errcode='22023',message='snapshot_target_not_current';end if;
 if p_component not in('orders','submission','intake')or p_component is null or p_not_before is null or not isfinite(p_not_before)
  or jsonb_typeof(p_request)is distinct from'object'or p_request-array['action','view','platformId','startAt','endAt','direction','status','currency','offset','limit']<>'{}'::jsonb
  or p_request->>'action'is distinct from'aggregate'or p_request->>'view'is distinct from'providers'or p_request->>'platformId'is distinct from t->>'id'
  or p_request->>'direction'is distinct from'charge'or p_request->>'status'is distinct from'all'or p_request->>'currency'is distinct from'INR'
  or coalesce(p_request->'offset','0'::jsonb)<>'0'::jsonb or coalesce(p_request->'limit','20'::jsonb)<>'20'::jsonb
  or jsonb_typeof(p_request->'startAt')is distinct from'string'or jsonb_typeof(p_request->'endAt')is distinct from'string'
  or p_request->>'startAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
  or p_request->>'endAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
 then raise exception using errcode='22023',message='invalid_snapshot_request';end if;
 f:=(p_request->>'startAt')::timestamptz;e:=(p_request->>'endAt')::timestamptz;
 if not isfinite(f)or not isfinite(e)or e<=f or(e at time zone(t->>'timezone'))-(f at time zone(t->>'timezone'))>interval'1day'then raise exception using errcode='22023',message='unsupported_snapshot_window';end if;
 q:=p_request||jsonb_build_object('startAt',private.provider_snapshot_iso(f),'endAt',private.provider_snapshot_iso(e),'offset',0,'limit',20);
 k:=jsonb_build_object('version',1,'target',t,'component',p_component,'request',q);
 -- Bounded shadow footprint; do not evict last-good heads or silently truncate.
 -- Independent atomic quota admission is enforced by the table accounting trigger.
 insert into private.provider_snapshot_jobs(request_key,target,request,component,platform_id,window_from,window_to,dependency_token,not_before)
 values(k,t,q,p_component,(t->>'id')::uuid,f,e,private.provider_snapshot_dependency_token(t),p_not_before)
 on conflict(request_key)do nothing returning id into j;
 if j is null then select id into j from private.provider_snapshot_jobs where request_key=k;end if;return j;
end;$fn$;
revoke all on function private.provider_snapshot_enqueue(jsonb,jsonb,text,timestamptz)from public,anon,authenticated,service_role;

