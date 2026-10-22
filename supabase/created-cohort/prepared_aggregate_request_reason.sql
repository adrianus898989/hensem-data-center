CREATE OR REPLACE FUNCTION private.prepared_aggregate_request_reason(q jsonb, t jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare k text;a timestamptz;b timestamptz;c timestamptz;d timestamptz;s text:=t->>'source';basis text:=q->>'successBasis';direction text:=coalesce(q->>'direction','all');n numeric;
begin
 if q is null or jsonb_typeof(q)<>'object' or octet_length(q::text)>32768
  or q->>'action' is distinct from 'aggregate' or coalesce(q->>'view','full')not in('providers','full')
  or q->>'platformId' is distinct from t->>'id' or t->>'source' not in('ar','newar','lg','game66','wg','duoli','kb','panda') then return 'unsupported_request';end if;
 if exists(select 1 from jsonb_object_keys(q)x where x<>all(array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','channelTypes','currency','amountMin','amountMax','amountMaxExclusive','amountBands','durationVersion','durationRange','offset','limit'])) then return 'unsupported_filter';end if;
 foreach k in array array['startAt','endAt','successStartAt','successEndAt'] loop
  if k in('startAt','endAt') or q?k then
   if jsonb_typeof(q->k)is distinct from 'string' or q->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then return 'invalid_time';end if;
  end if;
 end loop;
 a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;c:=coalesce(q->>'successStartAt',q->>'startAt')::timestamptz;d:=coalesce(q->>'successEndAt',q->>'endAt')::timestamptz;
 if not(isfinite(a)and isfinite(b)and isfinite(c)and isfinite(d))or a>=b or c>=d or b-a>interval'32days'or d-c>interval'32days'or ((b-interval'1microsecond')at time zone(t->>'timezone'))::date-(a at time zone(t->>'timezone'))::date>30 or ((d-interval'1microsecond')at time zone(t->>'timezone'))::date-(c at time zone(t->>'timezone'))::date>30 then return 'invalid_time_range';end if;
 if (q?'successStartAt')<>(q?'successEndAt') or (q?'successBasis' and (jsonb_typeof(q->'successBasis')is distinct from 'string' or basis not in('success','source_updated','created'))) then return 'invalid_success_clock';end if;
 if basis='created'and(q?'successStartAt'or q?'successEndAt')then return'invalid_success_clock';end if;
 if coalesce(q->>'view','full')='providers'and coalesce(q->>'status','all')<>'all'then return'unsupported_providers_status';end if;
 if direction not in('all','charge','withdraw')or coalesce(q->>'status','all')not in('all','success','pending','failed','rejected','unknown') then return 'invalid_status_or_direction';end if;
 foreach k in array array['providers','channelTypes']loop
  if q?k and q->k<>'null'::jsonb then
   if jsonb_typeof(q->k)<>'array'or jsonb_array_length(q->k)>200 or exists(select 1 from jsonb_array_elements(q->k)x where jsonb_typeof(x)<>'string'or length(x#>>'{}')not between 1 and 200 or x#>>'{}'~'[[:cntrl:]]')then return 'invalid_filter';end if;
  end if;
 end loop;
 if q?'currency'and q->'currency'<>'null'::jsonb and(jsonb_typeof(q->'currency')<>'string'or length(q->>'currency')>16)then return 'invalid_currency';end if;
 foreach k in array array['amountMin','amountMax']loop if q?k and q->k<>'null'::jsonb then n:=(q->>k)::numeric;if n::text in('NaN','Infinity','-Infinity')then return 'invalid_amount';end if;end if;end loop;
 if (q->>'amountMin')::numeric>(q->>'amountMax')::numeric or (q->>'amountMaxExclusive')::boolean and(q->>'amountMin')::numeric>=(q->>'amountMax')::numeric then return 'invalid_amount';end if;
 if q?'amountMaxExclusive'and(jsonb_typeof(q->'amountMaxExclusive')<>'boolean'or q->>'amountMax'is null)then return 'invalid_amount';end if;
 if q?'offset'and coalesce(q->>'offset','')<>'0'then return 'unsupported_offset';end if;
 if q?'limit'and coalesce(q->>'limit','')not in('20','30','50','100','500')then return 'invalid_limit';end if;
 perform private.dashboard_admin_validate_duration(q);perform private.dashboard_admin_validate_amount_bands(q->'amountBands',direction);
 return null;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then return 'invalid_filter';
end;$function$
