CREATE OR REPLACE FUNCTION private.dashboard_prepared_direction_projection(p_payload jsonb, p_base_request jsonb, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare r jsonb:=p_payload; groups jsonb; rows jsonb; summaries jsonb;k text;total numeric;invalid boolean;count_key text;d text:=p_request->>'direction';
begin
 if jsonb_typeof(p_base_request)is distinct from'object'or jsonb_typeof(p_request)is distinct from'object'
 or p_base_request->>'action'is distinct from'aggregate'or p_request->>'action'is distinct from'aggregate'
 or p_base_request->>'view'is distinct from'full'or p_request->>'view'is distinct from'full'
 or p_base_request->>'direction'is distinct from'all'or d is null or d not in('all','charge','withdraw')
 or(p_base_request-'direction')is distinct from(p_request-'direction')
 or jsonb_typeof(r)is distinct from'object'or r->>'version'is distinct from'1'
 or r->'rows'is distinct from'[]'::jsonb or jsonb_typeof(r->'summary')is distinct from'array'
 or jsonb_typeof(r->'groups')is distinct from'object' or r ?| array['error','partial','_parts']
 or r#>>'{platform,id}'is distinct from p_request->>'platformId'
 or(r->>'startAt')::timestamptz is distinct from(p_request->>'startAt')::timestamptz
 or(r->>'endAt')::timestamptz is distinct from(p_request->>'endAt')::timestamptz
 or(r->>'successStartAt')::timestamptz is distinct from(p_request->>'successStartAt')::timestamptz
 or(r->>'successEndAt')::timestamptz is distinct from(p_request->>'successEndAt')::timestamptz
 or r->>'successBasis'is distinct from p_request->>'successBasis'
 then raise exception using errcode='22023',message='prepared_direction_scope_mismatch';end if;
 if d='all'then return r;end if;
 select coalesce(jsonb_agg(x order by n),'[]'::jsonb)into summaries from jsonb_array_elements(r->'summary')with ordinality a(x,n)where x->>'direction'=d;
 groups:=r->'groups';
 for k in select jsonb_object_keys(groups)loop
  if jsonb_typeof(groups->k)is distinct from'array'then raise exception 'prepared_direction_invalid_group';end if;
  if exists(select 1 from jsonb_array_elements(groups->k)x where coalesce(x->>'direction','')not in('charge','withdraw'))then raise exception 'prepared_direction_unscoped_row';end if;
  select coalesce(jsonb_agg(x order by n),'[]'::jsonb)into rows from jsonb_array_elements(groups->k)with ordinality a(x,n)where x->>'direction'=d;
  groups:=jsonb_set(groups,array[k],rows);
 end loop;
 foreach k in array array['latencySummary','pendingSummary']loop
  if r ? k then
   if jsonb_typeof(r->k)is distinct from'array'then raise exception 'prepared_direction_invalid_summary';end if;
   select coalesce(jsonb_agg(x order by n),'[]'::jsonb)into rows from jsonb_array_elements(r->k)with ordinality a(x,n)where x->>'direction'=d;
   r:=jsonb_set(r,array[k],rows);
  end if;
 end loop;
 count_key:=case when p_request->>'status'='success'then'success_count'else'all_count'end;
 select coalesce(bool_or(x->>count_key is null or coalesce(x->>count_key,'')!~'^[0-9]+$'),false),
  coalesce(sum(case when x->>count_key~'^[0-9]+$'then(x->>count_key)::numeric end),0)
  into invalid,total from jsonb_array_elements(summaries)x;
 if invalid or(count_key='success_count'and(r#>>array['capabilities',d||'SuccessTimeAvailable'])='false')then total:=null;end if;
 return r||jsonb_build_object('summary',summaries,'groups',groups,'total',total,
  'hasMore',case when total is null then null else total>coalesce((r->>'offset')::integer,0)+coalesce((r->>'limit')::integer,20)end);
end;
$function$
