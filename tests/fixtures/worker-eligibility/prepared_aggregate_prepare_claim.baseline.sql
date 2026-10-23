CREATE OR REPLACE FUNCTION private.prepared_aggregate_prepare_claim(p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j jsonb;budget interval:=current_setting('statement_timeout')::interval;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='prepared_worker_denied';end if;
 if budget<=interval'0seconds'or budget>interval'3seconds'then raise exception using errcode='22023',message='prepared_claim_deadline_required';end if;
 perform set_config('prepared_aggregate.claim','',false);j:=private.prepared_aggregate_claim(p_worker);
 if j is not null then perform set_config('prepared_aggregate.claim',j::text,false);end if;return j;
end;$function$
