CREATE OR REPLACE FUNCTION private.dashboard_admin_live_sync_health(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare v_result jsonb;v_offset int:=coalesce((p_request->>'offset')::int,0);v_limit int:=coalesce((p_request->>'limit')::int,100);v_scope jsonb:=private.dashboard_admin_live_scope();v_key text;
begin
 if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>1024 or p_request-array['offset','limit']<>'{}'::jsonb then raise exception using errcode='22023',message='invalid_health_request';end if;
 foreach v_key in array array['offset','limit'] loop if p_request?v_key and (jsonb_typeof(p_request->v_key)<>'number' or p_request->>v_key !~ '^[0-9]{1,5}$') then raise exception using errcode='22023',message='invalid_health_pagination';end if;end loop;
 if v_offset not between 0 and 50000 or v_limit not in(50,100,200,5000) then raise exception using errcode='22023',message='invalid_health_pagination';end if;
 with checked as materialized(select * from private.dashboard_admin_live_sync_health_rows(statement_timestamp())),issues as materialized(select * from checked where status<>'received'),paged as(select * from issues order by data_date desc nulls last,country,platform,dataset,direction,source_kind offset v_offset limit v_limit)
 select jsonb_build_object('checkedAt',statement_timestamp(),'days',7,'coverage','registered_and_received_business_sources','total',(select count(*) from issues),'offset',v_offset,'limit',v_limit,
  'summary',jsonb_build_object('checked',(select count(*) from checked),'received',(select count(*) from checked where status='received'),'notReceived',(select count(*) from checked where status='not_received'),'failed',(select count(*) from checked where status='failed'),'pending',(select count(*) from checked where status='pending'),'unverified',(select count(*) from checked where status='unverified')),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('country',country,'team',team,'platform',platform,'platformId',platform_id,'source',source_system,'sourceKind',source_kind,'dataset',dataset,'direction',direction,'date',data_date,'timezone',timezone,'status',status,'received',received,'evidence',evidence,'recordReceivedAt',last_received_at)) from paged),'[]'::jsonb)) into v_result;
 return v_result;
end;$function$

