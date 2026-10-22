CREATE OR REPLACE FUNCTION private.prepared_aggregate_echo(payload jsonb, q jsonb, t jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select ((payload-'_preparedDirectionCapabilities')||jsonb_build_object('offset',coalesce((q->>'offset')::integer,0),'limit',coalesce((q->>'limit')::integer,20),
 'hasMore',case when payload->>'total'is null then null else(payload->>'total')::numeric>coalesce((q->>'offset')::integer,0)+coalesce((q->>'limit')::integer,20)end,'startAt',q->>'startAt','endAt',q->>'endAt','successStartAt',coalesce(q->>'successStartAt',q->>'startAt'),
 'successEndAt',coalesce(q->>'successEndAt',q->>'endAt'),'successBasis',coalesce(q->>'successBasis',case when t->>'source'='duoli' then 'source_updated' else 'success' end))
 ||case when q?'amountBands'then jsonb_build_object('amountBands',q->'amountBands','amountBandsVersion',1)else '{}'::jsonb end)-case when q->>'successBasis'='created'then array['successStartAt','successEndAt']else array[]::text[]end;
$function$
