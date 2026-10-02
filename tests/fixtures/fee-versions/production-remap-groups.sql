CREATE OR REPLACE FUNCTION private.dashboard_admin_live_remap_groups(p_rows jsonb, p_country text, p_platform text, p_daily boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r jsonb; old_row jsonb; out_rows jsonb := '{}'::jsonb; key text; canonical text;
  k text; n numeric; fields text[] := array['all_count','missing_amount_count','negative_amount_count',
    'success_count','created_success_count','pending_count','failed_count','rejected_count','unknown_count','fee_low_count','fee_high_count','fee_gap_count','fee_unpriced_count'];
  amount_fields text[] := array['all_amount','success_amount','pending_amount','failed_amount','rejected_amount','unknown_amount','fee_low_amount','fee_high_amount','fee_gap_amount'];
begin
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    canonical:=private.dashboard_admin_live_provider_canonical(p_country,p_platform,r->>'provider');
    key:=coalesce(r->>'direction','')||chr(31)||coalesce(r->>'currency','')||chr(31)||coalesce(canonical,'')||
      case when p_daily then chr(31)||coalesce(r->>'date','') else '' end;
    if not (out_rows ? key) then
      out_rows:=out_rows||jsonb_build_object(key,jsonb_set(r,'{provider}',to_jsonb(canonical),true));
    else
      old_row:=out_rows->key;
      foreach k in array fields loop
        if r->>k is null or old_row->>k is null then
          old_row:=jsonb_set(old_row,array[k],'null'::jsonb,true);
        else
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(n),true);
        end if;
      end loop;
      foreach k in array amount_fields loop
        if r->>k is null or old_row->>k is null then
          old_row:=jsonb_set(old_row,array[k],'null'::jsonb,true);
        else
          n:=coalesce((old_row->>k)::numeric,0)+coalesce((r->>k)::numeric,0);
          old_row:=jsonb_set(old_row,array[k],to_jsonb(trim(to_char(n,'FM999999999999999999999999999999990D99999999'))),true);
        end if;
      end loop;
      if coalesce(r->>'latest_synced_at','')>coalesce(old_row->>'latest_synced_at','') then
        old_row:=jsonb_set(old_row,'{latest_synced_at}',to_jsonb(r->>'latest_synced_at'),true);
      end if;
      out_rows:=jsonb_set(out_rows,array[key],old_row,true);
    end if;
  end loop;
  return coalesce((select jsonb_agg(value order by value->>'provider',value->>'direction',value->>'currency',value->>'date') from jsonb_each(out_rows)),'[]'::jsonb);
end;
$function$

