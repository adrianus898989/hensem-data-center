CREATE OR REPLACE FUNCTION private.dashboard_withdraw_country_catalog(q jsonb, c jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 -- Preserve every native record for the real country, including the existing
 -- report-team source aliases used by withdraw_prepared_validate. The original
 -- request/scope still selects teams and platforms; neither is rewritten here.
 with targets as(
  select case t->>'country'when'胖虎巴西'then'巴西'when'香港'then'印度'
   when'红膏蟹'then'印度'when'LG'then'菲律宾'else t->>'country'end country
  from jsonb_array_elements(case when q?'scopeTargets'then q->'scopeTargets'
   else jsonb_build_array(jsonb_build_object('country',q->>'country'))end)t)
 select coalesce(jsonb_agg(p order by p->>'id'),'[]'::jsonb)
 from jsonb_array_elements(c)p
 where exists(select 1 from targets t where t.country=case p->>'country'
  when'胖虎巴西'then'巴西'when'香港'then'印度'when'红膏蟹'then'印度'
  when'LG'then'菲律宾'else p->>'country'end);
$function$
