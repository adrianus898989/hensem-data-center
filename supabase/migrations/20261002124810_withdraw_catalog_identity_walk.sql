-- Enumerate report identities once per raw tuple, retaining every historical source.
-- Regular narrow indexes: fail within 2s if realtime writers prevent locking.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $preflight$
declare p pg_proc%rowtype; relation regclass; name text; column_name text;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_live_withdraw_platforms()');
 if p.oid is null or md5(p.prosrc) is distinct from '347e97b40e6c5469c0b537dd08b7d0a9'
  then raise exception 'withdraw_catalog_baseline_drift';end if;
 if p.proowner is distinct from 'postgres'::regrole
  or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.prosecdef is distinct from true or p.provolatile is distinct from 's'
  or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""']
  or p.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
  or p.procost is distinct from 100::real or p.prorows is distinct from 1000::real
  or p.proleakproof is distinct from false or p.proisstrict is distinct from false
  or pg_get_function_result(p.oid) is distinct from 'TABLE(id uuid, name text, team text, country text, scope_group text, source text, timezone text, currency text, source_name text)'
  then raise exception 'withdraw_catalog_metadata_drift';end if;
 foreach name in array array['auto_withdraw_daily','withdraw_operator_daily'] loop
  relation:=to_regclass('public.'||name);
  if relation is null or not exists(select 1 from pg_class c where c.oid=relation and c.relkind='r'
    and c.relowner='postgres'::regrole and c.relrowsecurity and not c.relforcerowsecurity)
   then raise exception 'withdraw_catalog_relation_contract: %',name;end if;
  foreach column_name in array array['country','platform'] loop
   if not exists(select 1 from pg_attribute a join pg_collation c on c.oid=a.attcollation
      where a.attrelid=relation and a.attname=column_name and a.atttypid='text'::regtype
       and a.attnum>0 and not a.attisdropped and c.collisdeterministic)
    then raise exception 'withdraw_catalog_column_contract: %.%',name,column_name;end if;
  end loop;
 end loop;
end;
$preflight$;
create index auto_withdraw_daily_country_platform_identity_idx on public.auto_withdraw_daily(country,platform);
create index withdraw_operator_daily_country_platform_identity_idx on public.withdraw_operator_daily(country,platform);
do $index_contract$
declare relation regclass; name text;
begin
 foreach name in array array['auto_withdraw_daily','withdraw_operator_daily'] loop
  relation:=('public.'||name)::regclass;
  if not exists(select 1 from pg_index i join pg_class ix on ix.oid=i.indexrelid join pg_am am on am.oid=ix.relam
    where i.indrelid=relation and ix.oid=to_regclass('public.'||name||'_country_platform_identity_idx')
      and am.amname='btree' and i.indisvalid and i.indisready and i.indnkeyatts=2
      and i.indexprs is null and i.indpred is null
      and (select array_agg(a.attname::text order by k.ordinality)
        from unnest(i.indkey) with ordinality k(attnum,ordinality)
        join pg_attribute a on a.attrelid=relation and a.attnum=k.attnum)=array['country','platform']
      and not exists(select 1 from unnest(i.indkey,i.indcollation) with ordinality k(attnum,collation_oid,ordinality)
        join pg_attribute a on a.attrelid=relation and a.attnum=k.attnum
        where k.collation_oid is distinct from a.attcollation))
   then raise exception 'withdraw_catalog_index_contract: %',name;end if;
 end loop;
end;
$index_contract$;
do $patch$
declare target regprocedure:='private.dashboard_admin_live_withdraw_platforms()'::regprocedure;
 p pg_proc%rowtype; metadata jsonb; definition text; old_fragment text; new_fragment text;
begin
 select * into p from pg_proc where oid=target;
 metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(target);
 old_fragment:=$old$ return query with
  withdraw_raw as ($old$;
 new_fragment:=$new$ return query with recursive
  -- Keep the raw text ordering identical to each column's deterministic index
  -- collation. Normalize only afterwards, as in the original DISTINCT/UNION.
  auto_keys(country,platform) as (
    (select a.country,a.platform from public.auto_withdraw_daily a
      where a.country is not null and a.platform is not null
      order by a.country,a.platform limit 1)
    union all
    select n.country,n.platform from auto_keys k cross join lateral (
      select a.country,a.platform from public.auto_withdraw_daily a
      where a.country is not null and a.platform is not null
        and (a.country,a.platform)>(k.country,k.platform)
      order by a.country,a.platform limit 1
    ) n
  ),
  operator_keys(country,platform) as (
    (select o.country,o.platform from public.withdraw_operator_daily o
      where o.country is not null and o.platform is not null
      order by o.country,o.platform limit 1)
    union all
    select n.country,n.platform from operator_keys k cross join lateral (
      select o.country,o.platform from public.withdraw_operator_daily o
      where o.country is not null and o.platform is not null
        and (o.country,o.platform)>(k.country,k.platform)
      order by o.country,o.platform limit 1
    ) n
  ),
  withdraw_raw as ($new$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  then raise exception 'withdraw_catalog_anchor_drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:='from public.auto_withdraw_daily a
    where nullif(btrim(a.country),'''') is not null and nullif(btrim(a.platform),'''') is not null';
 new_fragment:='from auto_keys a
    where nullif(btrim(a.country),'''') is not null and nullif(btrim(a.platform),'''') is not null';
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  then raise exception 'withdraw_catalog_auto_anchor_drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:='from public.withdraw_operator_daily o
    where nullif(btrim(o.country),'''') is not null and nullif(btrim(o.platform),'''') is not null';
 new_fragment:='from operator_keys o
    where nullif(btrim(o.country),'''') is not null and nullif(btrim(o.platform),'''') is not null';
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  then raise exception 'withdraw_catalog_operator_anchor_drift';end if;
 execute replace(definition,old_fragment,new_fragment);
 if (select to_jsonb(after_patch)-'prosrc' from pg_proc after_patch where oid=target) is distinct from metadata
  then raise exception 'withdraw_catalog_metadata_changed';end if;
end;
$patch$;
commit;
