CREATE OR REPLACE FUNCTION private.prepared_aggregate_secondary_reason(q jsonb, t jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare s text:=t->>'source';basis text:=coalesce(q->>'successBasis',case when s='duoli'then 'source_updated'else 'success'end);direction text:=coalesce(q->>'direction','all');
begin
 -- Creation-cohort success is a status selection, not a payment clock.
 if basis='created'then return null;end if;
 if basis='source_updated'then
  if s not in('newar','duoli','wg','game66')or s='wg'and direction<>'charge'or s='game66'and direction<>'withdraw'then return 'source_update_time_unavailable';end if;
  if s='newar'and not exists(select 1 from pg_index where indexrelid=to_regclass('public.newar_detail_source_updated_success_idx')and indrelid=to_regclass('public.newar_detail_records')and indisvalid and indisready and pg_get_indexdef(indexrelid)like '%(platform, dataset, source_updated_at)%'and pg_get_expr(indpred,indrelid)like '%status_group%success%')then return 'source_update_index_not_ready';end if;
 elsif s='duoli'then return 'payment_success_time_unavailable';end if;
 if s='wg'and direction<>'charge'then return 'payment_success_time_unavailable_for_withdraw';end if;
 if s='panda'then return 'success_window_coverage_unavailable';end if;
 return null;
end;$function$
