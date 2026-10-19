-- Code-only guarded maintenance. No source facts, collection or new dispatch lane.
-- Run as the existing postgres owner, only while the base worker has no live lease.
begin;
set local statement_timeout='8s';
set local lock_timeout='500ms';
lock table private.daily_provider_base_jobs in share row exclusive mode;
lock table private.daily_provider_base_artifacts in access exclusive mode;
do $preflight$
declare e jsonb;p pg_proc%rowtype;rows_before jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='provider_reuse_owner_required';end if;
 if exists(select 1 from private.daily_provider_base_jobs where status='running'and lease_until>clock_timestamp())then raise exception'provider_base_live_lease';end if;
 for e in select value from jsonb_array_elements($guard_json$[{"signature":"private.daily_provider_base_enqueue(jsonb)","body":"1612561a1d4789b627982d1c8a8bf83b","definition":"af95392a96fbcc314d8536df2571027f","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_enqueue","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_pending"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)","body":"23b803f922a76c04900ca4bf6eca6169","definition":"c2b02acd41dd41e5806484c2d8337125","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_exact_read","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_request","p_targets","p_mappings","p_metadata"],"proargtypes":["3802","3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_reuse_build(jsonb,jsonb,text)","body":"f4f4aac6c631c11af7b149bdcc3b386a","definition":"4e774cb54968557a8a20dd850b5437f1","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_build","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_item","p_target","p_dependency"],"proargtypes":["3802","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_reuse_current(jsonb,text,jsonb,text)","body":"ecfef84ce4f2c9ac4da3d558af433434","definition":"595b8b759bf167c6cdc91734cc206454","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_current","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosupport":"-","proargmodes":null,"proargnames":["p_metadata","p_item_digest","p_target","p_dependency"],"proargtypes":["3802","25","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_reuse_names(text)","body":"103873605ed6d5ec68ee4ff02682ec11","definition":"e5ad0759398d0734da25984f9b03acd4","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_names","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_country"],"proargtypes":["25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_reuse_packet(jsonb,jsonb,jsonb,jsonb,text,text)","body":"394123cdb37492f3ba84b27394617508","definition":"9747c874780169ec726b17588077ccf3","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_packet","prorows":0,"pronargs":6,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_metadata","p_request","p_target","p_publication","p_item_digest","p_dependency"],"proargtypes":["3802","3802","3802","3802","25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_reuse_semantics()","body":"deb96d97077456846bafe8125bd7fd9d","definition":"bb1b0c252e6966319e7741283648bfd8","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_semantics","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_run_claimed()","body":"b5fec15fc16e71045bcc8b36ee05acf2","definition":"45231fe0a488af813dfb64f3eaf74486","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_run_claimed","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_claim()","body":"f3b25be0e0bc27cf3dc921aeede543aa","definition":"4472b2026c37879acca0ea70dda072c4","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_claim","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_current(jsonb,jsonb)","body":"b90f4e12c10f6eff54cc74f713b42d6d","definition":"3085c2eef73f7cf5aae356a129fca821","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_current","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_key","p_metadata"],"proargtypes":["3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":"({CONST :consttype 3802 :consttypmod -1 :constcollid 0 :constlen -1 :constbyval false :constisnull true :location -1 :constvalue <>})","pronargdefaults":1}},{"signature":"private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)","body":"480ca3b477bda870fd4b35606429216f","definition":"0f925406c76f576e05d6e921a16b2186","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_identity","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_items","p_request","p_target","p_dependency"],"proargtypes":["3802","3802","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)","body":"823d756a9df2d4a8e2bcce7e6cfffe55","definition":"c68306dbb0eca5e44d421557f2ea9d10","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_lookup","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_items","p_request","p_target","p_dependency"],"proargtypes":["3802","3802","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_manifest_matches(jsonb)","body":"7b28ca322f500d36fcf3195b51b94f27","definition":"2954df9d970eaf0db6c7424ca8017d56","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_manifest_matches","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosupport":"-","proargmodes":null,"proargnames":["p_key"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_live_confirmed_provider(text,text,text)","body":"9d4130cb5173fb19f8e232331b2b9797","definition":"39f46b1156cf190aca0e8fa8906eafee","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_confirmed_provider","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_platform","p_raw"],"proargtypes":["25","25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_live_provider_alias(text,text)","body":"016e7206225e117f316e289c55c083e3","definition":"60bbe2bcbc92862785370daefa03bedb","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_provider_alias","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_name"],"proargtypes":["25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_live_provider_alias_values(text,text[])","body":"42b415a5cc8f38550e523836465da17f","definition":"ebc37751eb78fe9069de63d5cd798d3d","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_provider_alias_values","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"1009","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_names"],"proargtypes":["25","1009"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_live_provider_canonical(text,text,text)","body":"008e5cee3a4f6ac9e90706c45bee56da","definition":"4cda5f3c69719886903b149adc206e20","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_provider_canonical","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_platform","p_raw"],"proargtypes":["25","25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_wg_provider_aliases()","body":"5dedf6cf8a430e21b69ca81069db8b3b","definition":"9f08368371bb9a914ecf5d4b025a329e","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_wg_provider_aliases","prorows":1000,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":true,"prosecdef":false,"prorettype":"2249","prosupport":"-","proargmodes":["t","t","t","t","t","t"],"proargnames":["country_code","country","platform","raw_provider","canonical_provider","display_label"],"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":["25","25","25","25","25","25"],"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)","body":"58fee45de05fe5567a62e69b297cee88","definition":"d9b05fd54abe3f0e1c4b9a940b47afb6","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_prepared_provider_projection","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_payload","p_base_request","p_request"],"proargtypes":["3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.prepared_aggregate_canonical_request(jsonb,jsonb)","body":"56218033e0849e0744f34ba92ad96e72","definition":"e019b146b7532b636c396d44aaf345dd","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_canonical_request","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["q","t"],"proargtypes":["3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.prepared_aggregate_echo(jsonb,jsonb,jsonb)","body":"f72bd9afabd7c74de273f02f5e46499d","definition":"f02a1cfe6f62ee193c7da91b71fa9a8f","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_echo","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["payload","q","t"],"proargtypes":["3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}]$guard_json$::jsonb)loop
  select *into p from pg_proc where oid=to_regprocedure(e->>'signature');
  if p.oid is null or md5(p.prosrc)is distinct from e->>'body'or md5(pg_get_functiondef(p.oid))is distinct from e->>'definition'
   or (to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from e->'metadata'
   or pg_get_userbyid(p.proowner)<>'postgres'or (select lanname from pg_language where oid=p.prolang)not in('sql','plpgsql')then raise exception'provider_reuse_function_cas:%',e->>'signature';end if;
 end loop;
 if not exists(select 1 from pg_class c where c.oid='private.daily_provider_base_artifacts'::regclass and c.relkind='r'and pg_get_userbyid(c.relowner)='postgres'and c.relrowsecurity and not c.relforcerowsecurity and c.relacl::text='{postgres=arwdDxtm/postgres}')then raise exception'provider_reuse_table_security_drift';end if;
 if exists(select 1 from pg_trigger where tgrelid='private.daily_provider_base_artifacts'::regclass and not tgisinternal)then raise exception'provider_reuse_artifact_trigger_drift';end if;
 select jsonb_agg(jsonb_build_object('signature',fn.oid::regprocedure::text,'metadata',to_jsonb(fn)-array['prosrc','prosqlbody'])order by fn.oid)into rows_before from pg_proc fn where fn.oid=any(array[to_regprocedure('private.daily_provider_base_enqueue(jsonb)'),to_regprocedure('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'),to_regprocedure('private.daily_provider_base_run_claimed()'),to_regprocedure('private.daily_provider_base_claim()'),to_regprocedure('private.daily_provider_base_current(jsonb,jsonb)'),to_regprocedure('private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)'),to_regprocedure('private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)'),to_regprocedure('private.daily_provider_base_manifest_matches(jsonb)'),to_regprocedure('private.dashboard_admin_live_confirmed_provider(text,text,text)'),to_regprocedure('private.dashboard_admin_live_provider_alias(text,text)'),to_regprocedure('private.dashboard_admin_live_provider_alias_values(text,text[])'),to_regprocedure('private.dashboard_admin_live_provider_canonical(text,text,text)'),to_regprocedure('private.dashboard_admin_wg_provider_aliases()'),to_regprocedure('private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'),to_regprocedure('private.prepared_aggregate_canonical_request(jsonb,jsonb)'),to_regprocedure('private.prepared_aggregate_echo(jsonb,jsonb,jsonb)')]);
 perform set_config('audit.provider_precompute_before',rows_before::text,true);
 perform set_config('audit.provider_precompute_dependency',private.prepared_aggregate_dependency_common('IN'),true);
end;$preflight$;

CREATE OR REPLACE FUNCTION private.daily_provider_base_reuse_pack(p_payload jsonb, p_base jsonb, p_request jsonb, p_target jsonb, p_publication jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare started timestamptz:=clock_timestamp();deadline timestamptz:=started+interval'250milliseconds';
 rows jsonb;resolved jsonb;names jsonb;name_map jsonb:='[]';entries jsonb:='[]';common jsonb;scope jsonb;packed jsonb;
 reuse_names jsonb;canonical_map jsonb;n record;resolved_key text;native_country text;native_platform text;entry_index integer;empty_index integer;all_index integer;timestamp_ambiguous boolean;
begin
 if current_user<>'postgres'then return null;end if;
 if not exists(select 1 from pg_proc where oid='private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='58fee45de05fe5567a62e69b297cee88')
  or not exists(select 1 from pg_proc where oid='private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='f72bd9afabd7c74de273f02f5e46499d')then return null;end if;
 reuse_names:=p_request->'providerReuseNames';p_request:=p_request-'providerReuseNames';
 if reuse_names is null or jsonb_typeof(reuse_names)is distinct from'array'then reuse_names:='[]';end if;
 if jsonb_array_length(reuse_names)>200 or octet_length(reuse_names::text)>8192 or exists(select 1 from jsonb_array_elements(reuse_names)hint(value)where jsonb_typeof(hint.value)is distinct from'string'or length(btrim(hint.value#>>'{}'))not between 1 and 200 or(hint.value#>>'{}')~'[[:cntrl:]]')then reuse_names:='[]';end if;
 if p_request->>'view'is distinct from'providers'or not coalesce(p_request->>'direction'in('charge','withdraw'),false)
  or coalesce(p_request->>'status','all')<>'all'
  or p_request-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
  or p_publication->'calculationComplete'is distinct from'true'::jsonb
  or p_publication->'servedLastComplete'='true'::jsonb or p_publication->>'kind'is distinct from'daily_provider_rollup'
  or p_payload->'rows'is distinct from'[]'::jsonb or p_payload->'partial'='true'::jsonb or p_payload->'complete'='false'::jsonb
  or jsonb_typeof(p_payload->'groups'->'provider')is distinct from'array'then return null;end if;
 rows:=p_payload->'groups'->'provider';if jsonb_array_length(rows)>256 then return null;end if;
 native_country:=p_payload->'platform'->>'country';native_platform:=p_payload->'platform'->>'sourceName';
 -- The scalar native resolver has expensive repeated configuration startup.
 -- Mirror its exact current single-step relation once for the bounded input set;
 -- on future resolver drift omit metadata instead of changing main statistics.
 if not exists(select 1 from pg_proc where oid='private.dashboard_admin_live_provider_canonical(text,text,text)'::regprocedure
  and md5(prosrc)='008e5cee3a4f6ac9e90706c45bee56da'and pg_get_userbyid(proowner)='postgres'and prosecdef and not proisstrict and provolatile='s'
  and prolang=(select oid from pg_language where lanname='sql')and to_jsonb(proconfig)='["search_path=\"\""]'::jsonb)then return null;end if;
 select coalesce(jsonb_agg(name order by name),'[]')into names from(
  select distinct name from(
   select r->>'provider'name from jsonb_array_elements(rows)r
   union all select x.name from jsonb_array_elements(rows)r cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r->'provider_names')='array'then r->'provider_names'else'[]'::jsonb end)x(name)
   union all select x.name from jsonb_array_elements_text(coalesce(p_request->'providers','[]'::jsonb))x(name)
   union all select x.name from jsonb_array_elements_text(reuse_names)x(name)
  )n where name is not null and length(name)between 1 and 200 and name!~'[[:cntrl:]]'
 )d;
 if jsonb_array_length(names)>200 or clock_timestamp()>deadline then return null;end if;
 with inputs as materialized (
  select distinct raw,case when raw='未识别通道'then''else coalesce(btrim(raw),'')end lookup_raw
  from(select r->>'provider'raw from jsonb_array_elements(rows)r union all select name from jsonb_array_elements_text(names)x(name))i
 ), approved as materialized (
  select a.*from private.dashboard_admin_wg_provider_aliases()a
   where native_country in(a.country_code,a.country)and native_platform=a.platform
 ), registry as materialized (
  select r.country,r.platform,r.raw_provider,r.canonical_values,o.canonical_provider override_name
   from private.dashboard_admin_provider_registry r left join private.dashboard_admin_provider_overrides o using(country,platform,raw_provider)
   where r.country=native_country and r.platform=native_platform and exists(select 1 from inputs i where i.lookup_raw=r.raw_provider)
 ), direct as materialized (
  select r.*,coalesce(r.override_name,private.dashboard_admin_live_confirmed_provider(r.country,r.platform,r.raw_provider))direct_name from registry r
 ), name_sets as materialized (
  select distinct d.country,d.canonical_values from direct d where d.direct_name is null
 ), aliases as materialized (
  select ns.country,ns.canonical_values,private.dashboard_admin_live_provider_alias_values(ns.country,ns.canonical_values)names from name_sets ns
 ), candidates as materialized (
  select i.raw,case when native_country in('IN','印度')and native_platform in('YASH.BET','YASHBET')and btrim(i.raw)='WinPay'
   then coalesce((select o.canonical_provider from private.dashboard_admin_provider_overrides o where o.country=native_country and o.platform=native_platform and o.raw_provider=btrim(i.raw)),'NewWinPay')
   else coalesce(
    (select coalesce(o.canonical_provider,a.canonical_provider)from approved a left join private.dashboard_admin_provider_overrides o on o.country=a.country and o.platform=a.platform and o.raw_provider=a.raw_provider where btrim(i.raw)=a.raw_provider),
    (select coalesce(d.direct_name,case when cardinality(a.names)=1 then a.names[1]end)from direct d left join aliases a on a.country=d.country and a.canonical_values is not distinct from d.canonical_values where d.raw_provider=i.lookup_raw),i.raw)end canonical_input
   from inputs i
 ), final_inputs as materialized (select distinct canonical_input from candidates),
 final_aliases as materialized (
  select f.canonical_input,private.dashboard_admin_live_provider_alias(native_country,f.canonical_input)result from final_inputs f
 )
 select coalesce(jsonb_agg(jsonb_build_object('raw',c.raw,'key',a.result)order by c.raw nulls first),'[]')into canonical_map
  from candidates c join final_aliases a on a.canonical_input is not distinct from c.canonical_input;
 if clock_timestamp()>deadline then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('ordinal',ordinal-1,'key',m->>'key','raw',r->>'provider')order by ordinal),'[]')into resolved
  from jsonb_array_elements(rows)with ordinality a(r,ordinal)join jsonb_array_elements(canonical_map)m on m->>'raw'is not distinct from r->>'provider';
 if(select count(distinct r->>'key')from jsonb_array_elements(resolved)r)>128 or clock_timestamp()>deadline then return null;end if;
 scope:=p_request-'providers';
 common:=private.prepared_aggregate_echo(p_payload,p_request,p_target)-array['summary','groups','total','hasMore','latencySummary','pendingSummary'];
 -- Retain the original function's complete ABI/date/native/row validation.
 -- Direction all and an empty provider selector return the validated payload
 -- before its per-bucket numeric loops. No canonical label is resolved twice.
 perform private.dashboard_prepared_provider_projection(p_payload,p_base,p_base);
 if clock_timestamp()>deadline then return null;end if;
 -- Exact original 58fee count/amount/evidence formulas, evaluated together for
 -- every already-resolved selection. Common provenance is never cloned into
 -- each temporary projection. Monetary arithmetic stays PostgreSQL NUMERIC.
 with canonical_groups as materialized (
  select r->>'key'key,(row_number()over(order by r->>'key')-1)::integer selection
   from jsonb_array_elements(resolved)r where r->>'key'is not null group by r->>'key'
 ), selections as materialized (
  select selection,key from canonical_groups
  union all select count(*)::integer,null::text from canonical_groups
  union all select count(*)::integer+1,null::text from canonical_groups
 ), chosen as materialized (
  select g.selection,(r->>'ordinal')::integer ordinal,rows->(r->>'ordinal')::integer leaf
   from canonical_groups g join jsonb_array_elements(resolved)r on r->>'key'=g.key
   where rows->(r->>'ordinal')::integer->>'direction'=p_request->>'direction'
  union all
  select (select count(*)::integer+1 from canonical_groups),ordinal::integer-1,leaf
   from jsonb_array_elements(rows)with ordinality a(leaf,ordinal)where leaf->>'direction'=p_request->>'direction'
 ), buckets as materialized (
  select selection,leaf->'direction'direction,leaf->'currency'currency from chosen
   group by selection,leaf->'direction',leaf->'currency'
 ), metric_keys(key,kind,optional)as (values
  ('all_count','count',false),('success_count','count',false),('pending_count','count',false),('failed_count','count',false),('rejected_count','count',false),('unknown_count','count',false),('missing_amount_count','count',false),('negative_amount_count','count',false),('created_success_count','count',false),('reviewed_pending_count','count',true),
  ('all_amount','amount',false),('success_amount','amount',false),('pending_amount','amount',false),('failed_amount','amount',false),('rejected_amount','amount',false),('unknown_amount','amount',false),('created_success_amount','amount',true),('reviewed_pending_amount','amount',true)
 ), numeric_fields as materialized (
  select c.selection,c.leaf->'direction'direction,c.leaf->'currency'currency,k.key,k.kind,k.optional,
   bool_or(c.leaf?k.key)leaf_has,
   bool_or(c.leaf->>k.key is null or coalesce(c.leaf->>k.key,'')!~case when k.kind='count'then'^[0-9]+$'else'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'end)invalid,
   sum(case when c.leaf->>k.key~case when k.kind='count'then'^[0-9]+$'else'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'end then(c.leaf->>k.key)::numeric end)value
   from chosen c cross join metric_keys k group by c.selection,c.leaf->'direction',c.leaf->'currency',k.key,k.kind,k.optional
 ), numeric_objects as materialized (
  select f.selection,f.direction,f.currency,jsonb_object_agg(f.key,
   case when f.kind='count'then to_jsonb(case when f.invalid then null else f.value end)
    else to_jsonb(case when f.invalid then null else f.value::text end)end)
   filter(where case when f.optional then f.leaf_has when f.kind='amount'then true
    else f.leaf_has or exists(select 1 from jsonb_array_elements(p_payload->'summary')summary_row where summary_row?f.key)end)fields
   from numeric_fields f group by f.selection,f.direction,f.currency
 ), evidence_keys(key)as(values('success_time_available'),('success_time_basis'),('success_available'),('success_unavailable_reason'),('fee_available'),('fee_unavailable_reason'),('pending_count_available')),
 evidence_fields as materialized (
  select c.selection,c.leaf->'direction'direction,c.leaf->'currency'currency,k.key,
   case when count(distinct c.leaf->k.key)=1 and bool_and(c.leaf?k.key)then(jsonb_agg(c.leaf->k.key order by c.ordinal))->0 end value
   from chosen c cross join evidence_keys k group by c.selection,c.leaf->'direction',c.leaf->'currency',k.key
 ), evidence_objects as materialized (
  select selection,direction,currency,jsonb_object_agg(key,value)filter(where value is not null)fields
   from evidence_fields group by selection,direction,currency
 ), stamp_values as materialized (
  select c.selection,c.leaf->'direction'direction,c.leaf->'currency'currency,c.ordinal,c.leaf->>'latest_synced_at'stamp,(c.leaf->>'latest_synced_at')::timestamptz instant
   from chosen c where c.leaf->>'latest_synced_at'is not null
 ), stamp_maxima as materialized (
  select selection,direction,currency,max(instant)instant from stamp_values group by selection,direction,currency
 ), stamps as materialized (
  select v.selection,v.direction,v.currency,(array_agg(v.stamp order by v.ordinal))[1]stamp,count(distinct v.stamp)>1 ambiguous
   from stamp_values v join stamp_maxima m on m.selection=v.selection and m.direction is not distinct from v.direction and m.currency is not distinct from v.currency and m.instant=v.instant
   group by v.selection,v.direction,v.currency
 ), summaries as materialized (
  select bk.selection,jsonb_agg(jsonb_build_object('direction',bk.direction,'currency',bk.currency,'provider',null,'latest_synced_at',st.stamp)||coalesce(nf.fields,'{}')||coalesce(ef.fields,'{}')order by bk.direction,bk.currency)summary
   from buckets bk left join numeric_objects nf on nf.selection=bk.selection and nf.direction is not distinct from bk.direction and nf.currency is not distinct from bk.currency
   left join evidence_objects ef on ef.selection=bk.selection and ef.direction is not distinct from bk.direction and ef.currency is not distinct from bk.currency
   left join stamps st on st.selection=bk.selection and st.direction is not distinct from bk.direction and st.currency is not distinct from bk.currency
   group by bk.selection
 ), totals as materialized (
  select selection,bool_or(leaf->>'all_count'is null or coalesce(leaf->>'all_count','')!~'^[0-9]+$')invalid,
   coalesce(sum(case when leaf->>'all_count'~'^[0-9]+$'then(leaf->>'all_count')::numeric end),0)value,
   jsonb_agg(ordinal order by ordinal)indices from chosen group by selection
 ), assembled as materialized (
  select sel.selection,sel.key,coalesce(tot.indices,'[]')indices,
   case when tot.invalid then null else coalesce(tot.value,0)end total,coalesce(su.summary,'[]')summary
   from selections sel left join totals tot using(selection)left join summaries su using(selection)
 )
 , projected as materialized (
  select a.selection,a.key,a.indices,jsonb_build_object('summary',a.summary,'total',a.total)
   ||case when p_payload?'hasMore'then jsonb_build_object('hasMore',case when a.total is null then null else a.total>coalesce((p_payload->>'offset')::bigint,0)+coalesce((p_payload->>'limit')::bigint,20)end)else'{}'::jsonb end
   ||case when p_payload?'latencySummary'then jsonb_build_object('latencySummary','[]'::jsonb)else'{}'::jsonb end
   ||case when p_payload?'pendingSummary'then jsonb_build_object('pendingSummary','[]'::jsonb)else'{}'::jsonb end result
   from assembled a
 )
 select jsonb_agg(jsonb_build_object('key',a.key,'indices',a.indices,'result',
   private.prepared_aggregate_echo(a.result,p_request,p_target)-array['offset','limit','startAt','endAt','successStartAt','successEndAt','successBasis','amountBands','amountBandsVersion'])order by a.selection),
   (select count(*)::integer from canonical_groups),(select count(*)::integer+1 from canonical_groups),coalesce((select bool_or(ambiguous)from stamps),false)
  into entries,empty_index,all_index,timestamp_ambiguous from projected a;
 -- The original stamp query has no text tie-break. Never substitute a chosen
 -- text when equal latest instants have different source spellings.
 if timestamp_ambiguous then return null;end if;
 if clock_timestamp()>deadline then return null;end if;
 for n in select name from jsonb_array_elements_text(names)x(name)loop
  if clock_timestamp()>deadline then return null;end if;
  select m->>'key'into resolved_key from jsonb_array_elements(canonical_map)m where m->>'raw'=n.name;
  select ordinal-1 into entry_index from jsonb_array_elements(entries)with ordinality e(entry,ordinal)where entry->>'key'=resolved_key;
  name_map:=name_map||jsonb_build_array(jsonb_build_array(n.name,coalesce(entry_index,empty_index)));
 end loop;
 packed:=jsonb_build_object('version',1,'scope',scope,'base',common,'providers',rows,'names',name_map,'entries',entries,'all',all_index,'generatedMs',round(extract(epoch from clock_timestamp()-started)*1000,3));
 if clock_timestamp()>deadline or octet_length(packed::text)>1048576 then return null;end if;
 return packed;
end;$function$;
revoke all on function private.daily_provider_base_reuse_pack(jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.daily_provider_base_enqueue(p_pending jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare entry jsonb;identity jsonb;k jsonb;f jsonb;j private.daily_provider_base_jobs%rowtype;states jsonb:='{}';n integer;actor_id uuid:=coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid);
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if jsonb_typeof(p_pending)is distinct from'array'or jsonb_array_length(p_pending)not between 1 and 3 then return states;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('daily_provider_base_admission_v1',0))then return states;end if;
 delete from private.daily_provider_base_admissions where day<current_date-1;
 -- Preserve active families' last complete artifact. Retire only cold families.
 delete from private.daily_provider_base_heads h where h.last_requested_at<clock_timestamp()-interval'1day'
  and not exists(select 1 from jsonb_array_elements(p_pending)x where x->'identity'->'family'=h.family_key)
  and not exists(select 1 from private.daily_provider_base_jobs j0 where j0.family_digest=h.family_digest and j0.status='running'and j0.lease_until>clock_timestamp());
 delete from private.daily_provider_base_artifacts a where not exists(select 1 from private.daily_provider_base_heads h where h.artifact_id=a.id)
  and a.created_at<clock_timestamp()-interval'10minutes';
 delete from private.daily_provider_base_jobs j0 where j0.status<>'running'and j0.last_requested_at<clock_timestamp()-interval'1day'
  and not exists(select 1 from private.daily_provider_base_heads h where h.family_digest=j0.family_digest);
 for entry in select value from jsonb_array_elements(p_pending)loop
  identity:=entry->'identity';k:=identity->'key';f:=identity->'family';
  if k is null or f is null or k-'dailyPublications'is distinct from f then continue;end if;
  if not private.daily_provider_base_manifest_matches(k)then states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_obsolete');continue;end if;
  if octet_length(k::text)+octet_length(f::text)+octet_length((entry->'metadata')::text)>=262144 then states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_capacity');continue;end if;
  if exists(select 1 from private.daily_provider_base_heads where family_digest=md5(f::text)and family_key<>f)
   or exists(select 1 from private.daily_provider_base_jobs where digest=md5(k::text)and content_key<>k)
   or exists(select 1 from private.daily_provider_base_artifacts where digest=md5(k::text)and content_key<>k)then
   states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_identity_collision');continue;
  end if;
  -- New current immutable facts supersede queued/failed older work. Preserve
  -- any running lease and every previous complete head/artifact.
  delete from private.daily_provider_base_jobs where family_digest=md5(f::text)and family_key=f and digest<>md5(k::text)and status<>'running';
  select *into j from private.daily_provider_base_jobs where digest=md5(k::text)and content_key=k;
  if j.id is null then
   if not exists(select 1 from private.daily_provider_base_admissions where actor=actor_id and day=current_date and family_digest=md5(f::text))then
    if(select count(*)from private.daily_provider_base_admissions where actor=actor_id and day=current_date)>=200
     or(select count(*)from private.daily_provider_base_admissions where day=current_date)>=4096 then
     states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_admission_limited');continue;
    end if;
    insert into private.daily_provider_base_admissions values(actor_id,current_date,md5(f::text));
   end if;
   select count(*)into n from private.daily_provider_base_jobs;
   if n>=1024 then states:=states||jsonb_build_object(md5(k::text),'daily_provider_base_capacity');continue;end if;
   insert into private.daily_provider_base_jobs(digest,content_key,family_digest,family_key,target,request,dependency,daily_metadata)
    values(md5(k::text),k,md5(f::text),f,entry->'target',entry->'request',entry->>'dependency',entry->'metadata')on conflict(digest)do nothing;
  else
   update private.daily_provider_base_jobs set last_requested_at=clock_timestamp()where id=j.id and last_requested_at<clock_timestamp()-interval'1minute';
   update private.daily_provider_base_jobs set status='queued',attempts=0,not_before=clock_timestamp()where id=j.id and status='ready'
    and not exists(select 1 from private.daily_provider_base_artifacts a where a.digest=j.digest and a.content_key=j.content_key);
  end if;
  update private.daily_provider_base_heads set last_requested_at=clock_timestamp()where family_digest=md5(f::text)and family_key=f and last_requested_at<clock_timestamp()-interval'1minute';
 end loop;
 return states;
end;$function$;
revoke all on function private.daily_provider_base_enqueue(jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.daily_provider_base_exact_read(p_request jsonb, p_targets jsonb, p_mappings jsonb, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare mapping jsonb;t jsonb;q jsonb;selected jsonb;identity jsonb;proofs jsonb:='[]';proof jsonb;part jsonb;c jsonb;pub jsonb;payload jsonb;
 current_items jsonb;items jsonb:='[]';ready jsonb;outcome jsonb;response jsonb;i integer:=0;j private.prepared_aggregate_jobs%rowtype;
 a private.daily_provider_base_artifacts%rowtype;reuse_pack jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if coalesce((p_request->>'forceRefresh')::boolean,false)then return null;end if;
 -- A future original-reader authorization/lifecycle change must fail closed to
 -- the unmodified pipeline until this narrow mirror is explicitly re-reviewed.
 if not exists(select 1 from pg_proc p where p.oid='private.prepared_aggregate_read(text,jsonb)'::regprocedure
  and md5(p.prosrc)='4a38ca3d9bbfbed3cc94250db95064da'and md5(pg_get_functiondef(p.oid))='df7914b8375708f883617b3d09265423'
  and pg_get_userbyid(p.proowner)='postgres'and p.proacl::text='{postgres=X/postgres}'and p.prosecdef
  and p.provolatile='v'and p.proparallel='u'and not p.proisstrict and not p.proleakproof
  and p.procost=100 and p.prorows=0 and not p.proretset and p.pronargs=2 and p.pronargdefaults=0
  and pg_get_function_arguments(p.oid)='p_page text, p_request jsonb'and pg_get_function_result(p.oid)='jsonb'
  and(select lanname from pg_language where oid=p.prolang)='plpgsql'and to_jsonb(p.proconfig)='["search_path=\"\""]'::jsonb)
 then return null;end if;
 -- Prove the entire batch exact before performing even refresh bookkeeping.
 -- Miss, last-complete and force remain wholly on the previous reader path.
 for mapping in select value from jsonb_array_elements(p_mappings)loop
  q:=p_request->'requests'->i;t:=p_targets->i;
  select jsonb_agg(value order by n)into selected from jsonb_array_elements(p_metadata)with ordinality r(value,n)
   where n>(mapping->>'first')::integer and n<=(mapping->>'first')::integer+(mapping->>'count')::integer;
  identity:=private.daily_provider_base_identity(selected,q,t,mapping->>'dependency');
  select *into a from private.daily_provider_base_artifacts where digest=md5((identity->'key')::text)and content_key=identity->'key';
  if a.id is null or a.item_digest is distinct from md5(a.item::text)or a.item->>'status'is distinct from'ready'
   or a.item->'request'is distinct from identity->'base'or a.item->'publication'->'calculationComplete'is distinct from'true'::jsonb
   or a.item->'result'->'platform'->>'id'is distinct from t->>'id'
   or jsonb_array_length(a.item->'publication'->'components')is distinct from jsonb_array_length(selected)
   or not private.daily_provider_base_manifest_matches(identity->'key')then return null;end if;
  proofs:=proofs||jsonb_build_array(jsonb_build_object('identity',identity,'selected',selected,'item',a.item,'target',t,'request',q,'dependency',mapping->>'dependency'));
  i:=i+1;
 end loop;
 for proof in select value from jsonb_array_elements(proofs)loop
  current_items:='[]';i:=0;t:=proof->'target';q:=proof->'request';identity:=proof->'identity';
  for part in select value from jsonb_array_elements(proof->'selected')loop
   pub:=part->'publication';
   select *into j from private.prepared_aggregate_jobs where id=(part->>'jobId')::uuid;
   if j.id is null or j.target is distinct from t or j.dependency is distinct from proof->>'dependency'
    or j.revision::text is distinct from split_part(pub->>'generation',':',1)then return null;end if;
   -- Exact original V2 ready-head lifecycle; force is deliberately not admitted.
   if(pub->>'expiresAt')::timestamptz<=clock_timestamp()and coalesce(j.next_due_at,(pub->>'expiresAt')::timestamptz)<=clock_timestamp()then
    update private.prepared_aggregate_jobs z set status='queued',attempts=0,not_before=clock_timestamp()
     where z.id=j.id and z.status='ready'and z.revision=j.revision and z.dependency=proof->>'dependency'and z.target=t;
    select *into j from private.prepared_aggregate_jobs where id=j.id;
    if j.revision::text is distinct from split_part(pub->>'generation',':',1)or j.dependency is distinct from proof->>'dependency'or j.target is distinct from t then return null;end if;
   end if;
   pub:=pub||jsonb_build_object('freshness',case when(pub->>'expiresAt')::timestamptz>clock_timestamp()then'fresh'else'refresh_due'end,
    'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end);
   update private.prepared_aggregate_jobs set last_requested_at=clock_timestamp()where id=j.id and last_requested_at<clock_timestamp()-interval'5minutes';
   c:=proof->'item'->'publication'->'components'->i;
   if c->'request'is distinct from part->'request'or((c->'publication')-array['freshness','refreshState','nextRefreshAt'])is distinct from((part->'publication')-array['freshness','refreshState','nextRefreshAt'])then return null;end if;
   -- Financial facts and immutable evidence were already fully validated by the
   -- worker for this exact publication vector. Reuse that evidence; V4 alone
   -- assembles the live publication from empty provider leaves.
   payload:=jsonb_build_object('version',1,'rows','[]'::jsonb,'summary','[]'::jsonb,'groups',jsonb_build_object('provider','[]'::jsonb),
    'platform',proof->'item'->'result'->'platform','startAt',part->'request'->>'startAt','endAt',part->'request'->>'endAt',
    'successStartAt',part->'request'->>'successStartAt','successEndAt',part->'request'->>'successEndAt','successBasis','success')||(c->'evidence');
   current_items:=current_items||jsonb_build_array(jsonb_build_object('request',part->'request','status','ready','result',payload,'publication',pub));i:=i+1;
  end loop;
  outcome:=private.daily_provider_base_lookup(current_items,q,t,proof->>'dependency');ready:=outcome->'item';
  if outcome->'fallback'='true'::jsonb or ready->>'status'is distinct from'ready'or ready->'publication'->'servedLastComplete'='true'::jsonb
   or(outcome->'pending'->'identity'->'key')is distinct from identity->'key'
   or not private.daily_provider_base_manifest_matches(identity->'key')
   or not private.prepared_aggregate_target_current(t)
   or private.prepared_aggregate_dependency(t,private.prepared_aggregate_dependency_common(t->>'scope_group'))is distinct from proof->>'dependency'then return null;end if;
  -- Optional ordinal-only reuse metadata; the main financial DTO is untouched.
  begin
   reuse_pack:=private.daily_provider_base_reuse_pack(proof->'item'->'result',identity->'base',q||case when p_request?'providerReuseNames'then jsonb_build_object('providerReuseNames',p_request->'providerReuseNames')else'{}'::jsonb end,t,ready->'publication');
  exception when insufficient_privilege then raise;
   when others then reuse_pack:=null;end; -- OTHERS excludes query_canceled (57014).
  if reuse_pack is not null then
   if not private.daily_provider_base_manifest_matches(identity->'key')or not private.prepared_aggregate_target_current(t)
    or private.prepared_aggregate_dependency(t,private.prepared_aggregate_dependency_common(t->>'scope_group'))is distinct from proof->>'dependency'then return null;end if;
   ready:=ready||jsonb_build_object('providerReuse',reuse_pack);
  end if;
  items:=items||jsonb_build_array(ready);
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 if octet_length(response::text)>16*1024*1024 then
  -- Optional metadata never causes a valid original response to be truncated
  -- or sent down the old daily-reader path solely due to its size.
  select jsonb_agg(value-'providerReuse'order by ordinal)into items from jsonb_array_elements(items)with ordinality r(value,ordinal);
  response:=jsonb_build_object('version',2,'items',items);
  if octet_length(response::text)>16*1024*1024 then return null;end if;
 end if;
 for proof in select value from jsonb_array_elements(proofs)loop
  identity:=proof->'identity';
  update private.daily_provider_base_jobs set last_requested_at=clock_timestamp()where digest=md5((identity->'key')::text)and content_key=identity->'key'and last_requested_at<clock_timestamp()-interval'1minute';
  update private.daily_provider_base_heads set last_requested_at=clock_timestamp()where family_digest=md5((identity->'family')::text)and family_key=identity->'family'and last_requested_at<clock_timestamp()-interval'1minute';
 end loop;
 return response;
end;$function$;
revoke all on function private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.daily_provider_base_run_claimed()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare claim jsonb:=nullif(current_setting('daily_provider_base.claim',true),'')::jsonb;
 j private.daily_provider_base_jobs%rowtype;items jsonb;folded_item jsonb;checked jsonb;aid uuid;size integer;stamp timestamptz;started timestamptz;n integer;b bigint;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if current_setting('statement_timeout')::interval<=interval'0seconds'or current_setting('statement_timeout')::interval>interval'50seconds'then raise exception 'daily_provider_base_deadline_required';end if;
 if current_setting('transaction_isolation')<>'read committed'then raise exception 'daily_provider_base_read_committed_required';end if;
 if claim is null then return jsonb_build_object('status','idle');end if;
 select *into j from private.daily_provider_base_jobs where id=(claim->>'jobId')::uuid;
 select backend_start into started from pg_stat_activity where pid=pg_backend_pid();
 if j.id is null or j.status<>'running'or j.claim_pid is distinct from pg_backend_pid()or j.claim_backend_start is distinct from started
  or j.run_id is distinct from(claim->>'runId')::uuid or j.fence is distinct from(claim->>'fence')::bigint or j.lease_until<=clock_timestamp()
 then return jsonb_build_object('status','obsolete');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_shadow_worker_v1',0))then
  update private.daily_provider_base_jobs set status='queued',attempts=greatest(attempts-1,0),lease_until=null,claim_pid=null,claim_backend_start=null,not_before=clock_timestamp()+interval'1second'
   where id=j.id and run_id=j.run_id and fence=j.fence;
  perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('status','busy');
 end if;
 begin
  items:=private.daily_provider_base_current(j.content_key,j.daily_metadata);
  if items is null then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_obsolete'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','obsolete_manifest');
  end if;
  -- This is the only full fold in the new read model. It runs in the existing
  -- bounded worker, not in a user query, with every original validation intact.
  folded_item:=private.dashboard_admin_daily_provider_fold(items,j.request,j.target);
  if folded_item is null then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='fold_incompatible'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','fold_incompatible');
  end if;
  checked:=private.daily_provider_base_current(j.content_key,j.daily_metadata);
  if checked is null then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_obsolete'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','obsolete_manifest');
  end if;
  size:=octet_length(j.content_key::text)+octet_length(j.family_key::text)+octet_length(folded_item::text)+256;
  if size>8388608 then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_oversized'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','capacity');
  end if;
  -- Admission and publication share one short capacity lock. No lock is held
  -- across a source reader or fold; contention discards this attempt safely.
  if not pg_try_advisory_xact_lock(hashtextextended('daily_provider_base_admission_v1',0))then
   update private.daily_provider_base_jobs set status='queued',attempts=greatest(attempts-1,0),lease_until=null,not_before=clock_timestamp()+interval'1second'where id=j.id and run_id=j.run_id and fence=j.fence;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('status','busy');
  end if;
  select *into j from private.daily_provider_base_jobs where id=j.id for update;
  if j.status<>'running'or j.run_id is distinct from(claim->>'runId')::uuid or j.fence is distinct from(claim->>'fence')::bigint
   or j.claim_pid is distinct from pg_backend_pid()or j.claim_backend_start is distinct from started or j.lease_until<=clock_timestamp()
  then return jsonb_build_object('status','obsolete');end if;
  select count(*)into n from private.daily_provider_base_heads;
  if n>=512 and not exists(select 1 from private.daily_provider_base_heads where family_digest=j.family_digest and family_key=j.family_key)then
   update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_capacity'where id=j.id;
   perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','capacity');
  end if;
  -- Replace only a fully calculated family head. The old head remains visible
  -- until this transaction commits; no new clocks are attached to its money.
  delete from private.daily_provider_base_artifacts a where not exists(select 1 from private.daily_provider_base_heads h where h.artifact_id=a.id);
  select count(*),coalesce(sum(bytes),0)into n,b from private.daily_provider_base_artifacts;
  if n>=512 or b+size>134217728 then
   -- The current family's previous publication can be retired atomically only
   -- after its replacement has passed all validation, never before a fold.
   size:=octet_length(j.content_key::text)+octet_length(j.family_key::text)+octet_length(folded_item::text)+256;
   if b+size-coalesce((select a0.bytes from private.daily_provider_base_heads h join private.daily_provider_base_artifacts a0 on a0.id=h.artifact_id where h.family_digest=j.family_digest and h.family_key=j.family_key),0)>134217728
    or (n+1-(case when exists(select 1 from private.daily_provider_base_heads where family_digest=j.family_digest and family_key=j.family_key)then 1 else 0 end))>512 then
    update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='daily_provider_base_capacity'where id=j.id;
    perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','capacity');
   end if;
  end if;
  insert into private.daily_provider_base_artifacts(digest,content_key,family_digest,family_key,item,item_digest,bytes)
   values(j.digest,j.content_key,j.family_digest,j.family_key,folded_item,md5(folded_item::text),size)on conflict(digest)do nothing;
  select id into aid from private.daily_provider_base_artifacts where digest=j.digest and content_key=j.content_key and item_digest=md5(folded_item::text);
  if aid is null then raise exception 'daily_provider_base_content_collision';end if;
  insert into private.daily_provider_base_heads(family_digest,family_key,artifact_id)values(j.family_digest,j.family_key,aid)
   on conflict(family_digest)do update set artifact_id=excluded.artifact_id,last_requested_at=clock_timestamp()where daily_provider_base_heads.family_key=excluded.family_key;
  delete from private.daily_provider_base_artifacts a where not exists(select 1 from private.daily_provider_base_heads h where h.artifact_id=a.id);
  update private.daily_provider_base_jobs set status='ready',attempts=0,lease_until=null,last_error=null where id=j.id;
 exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
  update private.daily_provider_base_jobs set status='failed',attempts=3,lease_until=null,last_error='fold_incompatible'where id=j.id and run_id=j.run_id and fence=j.fence;
  perform set_config('daily_provider_base.claim','',false);return jsonb_build_object('published',false,'reason','fold_incompatible');
 end;
 perform set_config('daily_provider_base.claim','',false);
 return jsonb_build_object('published',true,'id',aid);
end;$function$;
revoke all on function private.daily_provider_base_run_claimed() from public,anon,authenticated,service_role;

-- Removing metadata decreases derived storage; immutable financial item/digest/head stay intact.
update private.daily_provider_base_artifacts set reuse_metadata=null,reuse_digest=null,bytes=octet_length(content_key::text)+octet_length(family_key::text)+octet_length(item::text)+256;
alter table private.daily_provider_base_artifacts drop constraint daily_provider_base_artifacts_check1;
alter table private.daily_provider_base_artifacts add constraint daily_provider_base_artifacts_check1 check(bytes=octet_length(content_key::text)+octet_length(family_key::text)+octet_length(item::text)+256);
alter table private.daily_provider_base_artifacts drop constraint daily_provider_base_reuse_digest_check;
alter table private.daily_provider_base_artifacts drop column reuse_metadata;
alter table private.daily_provider_base_artifacts drop column reuse_digest;
drop function private.daily_provider_base_reuse_build(jsonb,jsonb,text);
drop function private.daily_provider_base_reuse_current(jsonb,text,jsonb,text);
drop function private.daily_provider_base_reuse_names(text);
drop function private.daily_provider_base_reuse_packet(jsonb,jsonb,jsonb,jsonb,text,text);
drop function private.daily_provider_base_reuse_semantics();
do $verified$
declare e jsonb;p pg_proc%rowtype;
begin
 if private.prepared_aggregate_dependency_common('IN')is distinct from current_setting('audit.provider_precompute_dependency')then raise exception'provider_reuse_financial_dependency_changed';end if;
 for e in select value from jsonb_array_elements(current_setting('audit.provider_precompute_before')::jsonb)loop
  select *into p from pg_proc where oid=to_regprocedure(e->>'signature');
  if p.oid is null or (to_jsonb(p)-array['prosrc','prosqlbody'])is distinct from e->'metadata'then raise exception'provider_reuse_existing_metadata_changed:%',e->>'signature';end if;
 end loop;
 for e in select value from jsonb_array_elements($guard_json$[{"signature":"private.daily_provider_base_claim()","body":"f3b25be0e0bc27cf3dc921aeede543aa","definition":"4472b2026c37879acca0ea70dda072c4","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_claim","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_current(jsonb,jsonb)","body":"b90f4e12c10f6eff54cc74f713b42d6d","definition":"3085c2eef73f7cf5aae356a129fca821","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_current","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_key","p_metadata"],"proargtypes":["3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":"({CONST :consttype 3802 :consttypmod -1 :constcollid 0 :constlen -1 :constbyval false :constisnull true :location -1 :constvalue <>})","pronargdefaults":1}},{"signature":"private.daily_provider_base_enqueue(jsonb)","body":"889c093d1ab76aa388d23b0f57a4cbf5","definition":"6dac86d72c0f8c823ac6cff95a6072a7","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_enqueue","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_pending"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)","body":"086664aa0861925c5dcdfd3040279055","definition":"39b8eecf4a25e9af632a6a6bb4b56edc","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_exact_read","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_request","p_targets","p_mappings","p_metadata"],"proargtypes":["3802","3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)","body":"480ca3b477bda870fd4b35606429216f","definition":"0f925406c76f576e05d6e921a16b2186","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_identity","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_items","p_request","p_target","p_dependency"],"proargtypes":["3802","3802","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)","body":"823d756a9df2d4a8e2bcce7e6cfffe55","definition":"c68306dbb0eca5e44d421557f2ea9d10","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_lookup","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_items","p_request","p_target","p_dependency"],"proargtypes":["3802","3802","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_manifest_matches(jsonb)","body":"7b28ca322f500d36fcf3195b51b94f27","definition":"2954df9d970eaf0db6c7424ca8017d56","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_manifest_matches","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosupport":"-","proargmodes":null,"proargnames":["p_key"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_run_claimed()","body":"526e5ed10164effd493031c34ce32064","definition":"5866b70c2deea1f6d620243314d678b8","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_run_claimed","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_live_confirmed_provider(text,text,text)","body":"9d4130cb5173fb19f8e232331b2b9797","definition":"39f46b1156cf190aca0e8fa8906eafee","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_confirmed_provider","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_platform","p_raw"],"proargtypes":["25","25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_live_provider_alias(text,text)","body":"016e7206225e117f316e289c55c083e3","definition":"60bbe2bcbc92862785370daefa03bedb","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_provider_alias","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_name"],"proargtypes":["25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_live_provider_alias_values(text,text[])","body":"42b415a5cc8f38550e523836465da17f","definition":"ebc37751eb78fe9069de63d5cd798d3d","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_provider_alias_values","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"1009","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_names"],"proargtypes":["25","1009"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_live_provider_canonical(text,text,text)","body":"008e5cee3a4f6ac9e90706c45bee56da","definition":"4cda5f3c69719886903b149adc206e20","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_provider_canonical","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_platform","p_raw"],"proargtypes":["25","25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_admin_wg_provider_aliases()","body":"5dedf6cf8a430e21b69ca81069db8b3b","definition":"9f08368371bb9a914ecf5d4b025a329e","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_wg_provider_aliases","prorows":1000,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":true,"prosecdef":false,"prorettype":"2249","prosupport":"-","proargmodes":["t","t","t","t","t","t"],"proargnames":["country_code","country","platform","raw_provider","canonical_provider","display_label"],"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":["25","25","25","25","25","25"],"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)","body":"58fee45de05fe5567a62e69b297cee88","definition":"d9b05fd54abe3f0e1c4b9a940b47afb6","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_prepared_provider_projection","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_payload","p_base_request","p_request"],"proargtypes":["3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.prepared_aggregate_canonical_request(jsonb,jsonb)","body":"56218033e0849e0744f34ba92ad96e72","definition":"e019b146b7532b636c396d44aaf345dd","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_canonical_request","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["q","t"],"proargtypes":["3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.prepared_aggregate_echo(jsonb,jsonb,jsonb)","body":"f72bd9afabd7c74de273f02f5e46499d","definition":"f02a1cfe6f62ee193c7da91b71fa9a8f","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_echo","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["payload","q","t"],"proargtypes":["3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"private.daily_provider_base_reuse_pack(jsonb,jsonb,jsonb,jsonb,jsonb)","body":"4f5e7484f1c81cc81bf622566aac620c","definition":"db01b9719a8b3b1355250488f85bd76c","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_pack","prorows":0,"pronargs":5,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_payload","p_base","p_request","p_target","p_publication"],"proargtypes":["3802","3802","3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}]$guard_json$::jsonb)loop
  select *into p from pg_proc where oid=to_regprocedure(e->>'signature');
  if p.oid is null or md5(p.prosrc)is distinct from e->>'body'or md5(pg_get_functiondef(p.oid))is distinct from e->>'definition'
   or (to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from e->'metadata'
   or p.proacl::text is distinct from'{postgres=X/postgres}'or pg_get_userbyid(p.proowner)<>'postgres'then raise exception'provider_reuse_after_cas:%',e->>'signature';end if;
 end loop;
end;$verified$;
commit;
