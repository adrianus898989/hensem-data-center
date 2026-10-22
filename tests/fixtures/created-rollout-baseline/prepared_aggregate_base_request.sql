CREATE OR REPLACE FUNCTION private.prepared_aggregate_base_request(q jsonb, t jsonb, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
 -- Custom duration requests stay exact, including direction. Their native
 -- coverage/capability contract is not inferred from a broader default DTO.
 if q?'durationRange'then return q;end if;
 r:=case when coalesce(q->>'view','full')='providers'then(q-array['providers','amountBands'])||jsonb_build_object('direction','all')else q||jsonb_build_object('direction','all')end;
 if private.prepared_aggregate_request_reason(r,t)is not null then return q;end if;
 if not(r?'durationRange')and coalesce(r->>'durationVersion','1')in('1','2')then
  if coalesce(r->>'view','full')='full'then return r||jsonb_build_object('view','full','durationVersion',2);end if;
  if greatest((r->>'endAt')::timestamptz,coalesce(r->>'successEndAt',r->>'endAt')::timestamptz)>p_now-interval'24hours'then
   return r||jsonb_build_object('view','full','durationVersion',2,'amountBands','{"charge":[100,200,300,400,500,1000,2000,5000,10000,20000,50000],"withdraw":[100,200,300,400,500,1000,2000,5000,10000,20000,50000]}'::jsonb);
  end if;
 end if;
 return r;
end;$function$
