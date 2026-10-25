CREATE OR REPLACE FUNCTION private.prepared_aggregate_canonical_request(q jsonb, t jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare c jsonb:=q-array['offset','limit'];k text;v text;
begin
 c:=c||jsonb_build_object('view',coalesce(q->>'view','full'),'direction',coalesce(q->>'direction','all'),'status',coalesce(q->>'status','all'),
 'successStartAt',coalesce(q->>'successStartAt',q->>'startAt'),'successEndAt',coalesce(q->>'successEndAt',q->>'endAt'),
 'successBasis',coalesce(q->>'successBasis',case when t->>'source'='duoli' then 'source_updated' else 'success' end));
 if q->>'successBasis'='created'then c:=c-array['successStartAt','successEndAt'];end if;
 foreach k in array array['startAt','endAt','successStartAt','successEndAt']loop if c?k then c:=jsonb_set(c,array[k],to_jsonb(to_char((c->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));end if;end loop;
 if c->>'view'='providers'then c:=c-'amountBands';end if;
 foreach k in array array['providers','channelTypes']loop
  if c->k='null'::jsonb or c->k='[]'::jsonb then c:=c-k;
  elsif jsonb_typeof(c->k)='array'then c:=jsonb_set(c,array[k],(select jsonb_agg(x order by x)from(select distinct value x from jsonb_array_elements(c->k))a));end if;
 end loop;
 foreach k in array array['currency','amountMin','amountMax','durationRange']loop if c->k='null'::jsonb then c:=c-k;end if;end loop;
 return c;
end;$function$

