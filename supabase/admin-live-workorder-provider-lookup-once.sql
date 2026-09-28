-- Resolve one canonical provider per distinct source identity in this request,
-- rather than repeating the same registry/alias lookup for every daily fact.
-- Only the existing mapped CTE changes; all source filters, aliases, catalog
-- identities, summary math, coverage, output fields and ACL remain intact.
begin;
do $patch$
declare
  definition text;
  original text:=$anchor$  ), mapped as materialized (
    select s.*,private.dashboard_admin_live_workorder_provider(s.country,s.platform,s.raw_provider,nullif(s.channel_type,'未识别通道')) as canonical_provider from scoped s
$anchor$;
  replacement text:=$replacement$  ), workorder_provider_names_v1 as materialized (
    select names.*,private.dashboard_admin_live_workorder_provider(names.country,names.platform,names.raw_provider,
      nullif(names.channel_type,'未识别通道')) as canonical_provider
    from (select distinct country,platform,raw_provider,channel_type from scoped) names
  ), mapped as materialized (
    select s.*,names.canonical_provider from scoped s
    join workorder_provider_names_v1 names
      using(country,platform,raw_provider,channel_type)
$replacement$;
begin
  select pg_get_functiondef('private.dashboard_admin_live_workorders(jsonb)'::regprocedure) into definition;
  if position('workorder_provider_names_v1 as materialized' in definition)>0 then return;end if;
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
    raise exception 'Workorder provider lookup baseline changed; review before applying';
  end if;
  execute replace(definition,original,replacement);
end;
$patch$;
notify pgrst,'reload schema';
commit;
