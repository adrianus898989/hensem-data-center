-- Guarded code-only lifecycle repair; no source scan, worker reset or new lane.
begin;
set local statement_timeout='8s';set local lock_timeout='500ms';
lock table private.daily_provider_base_jobs in share row exclusive mode;
do $preflight$
declare e jsonb;p pg_proc%rowtype;s jsonb;d jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_day_admission_owner_required';end if;
 if exists(select 1 from private.daily_provider_base_jobs where status='running'and lease_until>clock_timestamp())then raise exception'daily_provider_base_live_lease';end if;
 for e in select value from jsonb_array_elements($guard$[{"signature":"private.daily_provider_base_claim()","body":"f3b25be0e0bc27cf3dc921aeede543aa","definition":"4472b2026c37879acca0ea70dda072c4","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_claim","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_current(jsonb,jsonb)","body":"b90f4e12c10f6eff54cc74f713b42d6d","definition":"3085c2eef73f7cf5aae356a129fca821","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_current","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_key","p_metadata"],"proargtypes":["3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":"({CONST :consttype 3802 :consttypmod -1 :constcollid 0 :constlen -1 :constbyval false :constisnull true :location -1 :constvalue <>})","pronargdefaults":1},"language":"plpgsql"},{"signature":"private.daily_provider_base_enqueue(jsonb)","body":"1612561a1d4789b627982d1c8a8bf83b","definition":"af95392a96fbcc314d8536df2571027f","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_enqueue","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_pending"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)","body":"23b803f922a76c04900ca4bf6eca6169","definition":"c2b02acd41dd41e5806484c2d8337125","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_exact_read","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_request","p_targets","p_mappings","p_metadata"],"proargtypes":["3802","3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)","body":"480ca3b477bda870fd4b35606429216f","definition":"0f925406c76f576e05d6e921a16b2186","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_identity","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_items","p_request","p_target","p_dependency"],"proargtypes":["3802","3802","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)","body":"823d756a9df2d4a8e2bcce7e6cfffe55","definition":"c68306dbb0eca5e44d421557f2ea9d10","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_lookup","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_items","p_request","p_target","p_dependency"],"proargtypes":["3802","3802","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_manifest_matches(jsonb)","body":"7b28ca322f500d36fcf3195b51b94f27","definition":"2954df9d970eaf0db6c7424ca8017d56","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_manifest_matches","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosupport":"-","proargmodes":null,"proargnames":["p_key"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.daily_provider_base_run_claimed()","body":"b5fec15fc16e71045bcc8b36ee05acf2","definition":"45231fe0a488af813dfb64f3eaf74486","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_run_claimed","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.dashboard_admin_live_confirmed_provider(text,text,text)","body":"9d4130cb5173fb19f8e232331b2b9797","definition":"39f46b1156cf190aca0e8fa8906eafee","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_confirmed_provider","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_platform","p_raw"],"proargtypes":["25","25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.dashboard_admin_live_provider_alias(text,text)","body":"016e7206225e117f316e289c55c083e3","definition":"60bbe2bcbc92862785370daefa03bedb","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_provider_alias","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_name"],"proargtypes":["25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.dashboard_admin_live_provider_alias_values(text,text[])","body":"42b415a5cc8f38550e523836465da17f","definition":"ebc37751eb78fe9069de63d5cd798d3d","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_provider_alias_values","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"1009","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_names"],"proargtypes":["25","1009"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.dashboard_admin_live_provider_canonical(text,text,text)","body":"008e5cee3a4f6ac9e90706c45bee56da","definition":"4cda5f3c69719886903b149adc206e20","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_live_provider_canonical","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":["p_country","p_platform","p_raw"],"proargtypes":["25","25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.dashboard_admin_wg_provider_aliases()","body":"5dedf6cf8a430e21b69ca81069db8b3b","definition":"9f08368371bb9a914ecf5d4b025a329e","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_wg_provider_aliases","prorows":1000,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":true,"prosecdef":false,"prorettype":"2249","prosupport":"-","proargmodes":["t","t","t","t","t","t"],"proargnames":["country_code","country","platform","raw_provider","canonical_provider","display_label"],"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":["25","25","25","25","25","25"],"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)","body":"58fee45de05fe5567a62e69b297cee88","definition":"d9b05fd54abe3f0e1c4b9a940b47afb6","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_prepared_provider_projection","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_payload","p_base_request","p_request"],"proargtypes":["3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.prepared_aggregate_canonical_request(jsonb,jsonb)","body":"56218033e0849e0744f34ba92ad96e72","definition":"e019b146b7532b636c396d44aaf345dd","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_canonical_request","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["q","t"],"proargtypes":["3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.prepared_aggregate_echo(jsonb,jsonb,jsonb)","body":"f72bd9afabd7c74de273f02f5e46499d","definition":"f02a1cfe6f62ee193c7da91b71fa9a8f","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_echo","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["payload","q","t"],"proargtypes":["3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.daily_provider_base_reuse_build(jsonb,jsonb,text)","body":"f4f4aac6c631c11af7b149bdcc3b386a","definition":"4e774cb54968557a8a20dd850b5437f1","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_build","prorows":0,"pronargs":3,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_item","p_target","p_dependency"],"proargtypes":["3802","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_reuse_current(jsonb,text,jsonb,text)","body":"ecfef84ce4f2c9ac4da3d558af433434","definition":"595b8b759bf167c6cdc91734cc206454","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_current","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"16","prosupport":"-","proargmodes":null,"proargnames":["p_metadata","p_item_digest","p_target","p_dependency"],"proargtypes":["3802","25","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.daily_provider_base_reuse_names(text)","body":"103873605ed6d5ec68ee4ff02682ec11","definition":"e5ad0759398d0734da25984f9b03acd4","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_names","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_country"],"proargtypes":["25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"i","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.daily_provider_base_reuse_packet(jsonb,jsonb,jsonb,jsonb,text,text)","body":"394123cdb37492f3ba84b27394617508","definition":"9747c874780169ec726b17588077ccf3","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_packet","prorows":0,"pronargs":6,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_metadata","p_request","p_target","p_publication","p_item_digest","p_dependency"],"proargtypes":["3802","3802","3802","3802","25","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_reuse_semantics()","body":"deb96d97077456846bafe8125bd7fd9d","definition":"bb1b0c252e6966319e7741283648bfd8","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_reuse_semantics","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"25","prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"sql"},{"signature":"private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)","body":"a4e4e1a403bf0aa2dc70c7bb7ad4e6c9","definition":"51ab15b2eaedf6e682e9c5fbde1e3da4","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_enqueue","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"2950","prosupport":"-","proargmodes":null,"proargnames":["q","t","dep","p_priority"],"proargtypes":["3802","3802","25","21"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":"({FUNCEXPR :funcid 314 :funcresulttype 21 :funcretset false :funcvariadic false :funcformat 2 :funccollid 0 :inputcollid 0 :args ({CONST :consttype 23 :consttypmod -1 :constcollid 0 :constlen 4 :constbyval true :constisnull false :location -1 :constvalue 4 [ 0 0 0 0 0 0 0 0 ]}) :location -1})","pronargdefaults":1},"language":"plpgsql"},{"signature":"private.prepared_aggregate_read(text,jsonb)","body":"4a38ca3d9bbfbed3cc94250db95064da","definition":"df7914b8375708f883617b3d09265423","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"prepared_aggregate_read","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_page","p_request"],"proargtypes":["25","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.dashboard_admin_daily_provider_prepared_read(text,jsonb)","body":"988291994779d7d25919e57db8715a82","definition":"e671aa71833ba75dc5f3812897ed4307","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_daily_provider_prepared_read","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_page","p_request"],"proargtypes":["25","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_prewarm(jsonb)","body":"a47e0e34ee7530d2dc8fc63b3461fc9e","definition":"739d3ef7c8acbea783bf5e1e1441f5d4","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_prewarm","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_requests"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"}]$guard$::jsonb)loop
 select *into p from pg_proc where oid=to_regprocedure(e->>'signature');
 if p.oid is null or md5(p.prosrc)is distinct from e->>'body'or md5(pg_get_functiondef(p.oid))is distinct from e->>'definition'
  or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from e->'metadata'
  or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)is distinct from e->>'language'
 then raise exception'daily_provider_day_admission_function_cas:%',e->>'signature';end if;
 end loop;
 for e in select value from jsonb_array_elements($guard$[{"bodyMd5":"220e789b11f814a39784fbf63ebdc30c","signature":"private.prepared_aggregate_key(jsonb,jsonb)","definitionMd5":"0de6aafc75fe287ebd177f24c505da21"},{"bodyMd5":"e05bf399932d1441b3425a548e0af7ed","signature":"private.prepared_aggregate_base_request(jsonb,jsonb,timestamp with time zone)","definitionMd5":"9aa161e7cc2ace98b3fac2fca1d292df"}]$guard$::jsonb)loop
  select *into p from pg_proc where oid=to_regprocedure(e->>'signature');
  if p.oid is null or md5(p.prosrc)is distinct from e->>'bodyMd5'or md5(pg_get_functiondef(p.oid))is distinct from e->>'definitionMd5'then raise exception'daily_provider_day_normalizer_drift';end if;
 end loop;
 
 if to_regprocedure('private.daily_provider_base_admit_days(jsonb,boolean)')is not null then raise exception'daily_provider_day_helper_exists';end if;if to_regprocedure('private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)')is not null then raise exception'daily_provider_day_helper_exists';end if;
 select(select jsonb_agg(jsonb_build_array(snapshot_fn.oid,case when snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_claim()'),to_regprocedure('private.daily_provider_base_enqueue(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm(jsonb)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)')])then null else md5(pg_get_functiondef(snapshot_fn.oid))end,to_jsonb(snapshot_fn)-array['prosrc','prosqlbody'])order by snapshot_fn.oid)from pg_proc snapshot_fn where snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_claim()'),to_regprocedure('private.daily_provider_base_current(jsonb,jsonb)'),to_regprocedure('private.daily_provider_base_enqueue(jsonb)'),to_regprocedure('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'),to_regprocedure('private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)'),to_regprocedure('private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)'),to_regprocedure('private.daily_provider_base_manifest_matches(jsonb)'),to_regprocedure('private.daily_provider_base_run_claimed()'),to_regprocedure('private.dashboard_admin_live_confirmed_provider(text,text,text)'),to_regprocedure('private.dashboard_admin_live_provider_alias(text,text)'),to_regprocedure('private.dashboard_admin_live_provider_alias_values(text,text[])'),to_regprocedure('private.dashboard_admin_live_provider_canonical(text,text,text)'),to_regprocedure('private.dashboard_admin_wg_provider_aliases()'),to_regprocedure('private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'),to_regprocedure('private.prepared_aggregate_canonical_request(jsonb,jsonb)'),to_regprocedure('private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'),to_regprocedure('private.daily_provider_base_reuse_build(jsonb,jsonb,text)'),to_regprocedure('private.daily_provider_base_reuse_current(jsonb,text,jsonb,text)'),to_regprocedure('private.daily_provider_base_reuse_names(text)'),to_regprocedure('private.daily_provider_base_reuse_packet(jsonb,jsonb,jsonb,jsonb,text,text)'),to_regprocedure('private.daily_provider_base_reuse_semantics()'),to_regprocedure('private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)'),to_regprocedure('private.prepared_aggregate_read(text,jsonb)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'),to_regprocedure('private.daily_provider_base_prewarm(jsonb)')]))into s;perform set_config('audit.provider_day_function_snapshot',s::text,true);
 select(select jsonb_build_object('common',c.value,'targets',(select jsonb_agg(jsonb_build_array(to_jsonb(n),private.prepared_aggregate_dependency(to_jsonb(n),c.value))order by n.id)from private.prepared_aggregate_native_catalog()n where n.team='M8'and n.country='印度'and n.scope_group='IN'and n.source in('ar','newar','kb')))from(select private.prepared_aggregate_dependency_common('IN')value)c)into d;perform set_config('audit.provider_day_dependency_snapshot',d::text,true);
end;$preflight$;

-- BEGIN admit-days
-- Shared metadata-only admission for the already-authorized closed daily plan.
create function private.daily_provider_base_admit_days(p_entries jsonb, p_force boolean)returns jsonb
language plpgsql volatile set search_path=''as $function$
declare entry jsonb;q jsonb;t jsonb;b jsonb;k jsonb;dep text;scope text;common text;commons jsonb:='{}';validated jsonb:='[]';states jsonb:='[]';seen jsonb:='{}';permits jsonb:='{}';fingerprint text;
 j private.prepared_aggregate_jobs%rowtype;a record;actor_id uuid:=coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid);budget integer;job_id uuid;state text;reason text;readable boolean;was_missing boolean;local_a timestamp;local_b timestamp;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if jsonb_typeof(p_entries)is distinct from'array'or jsonb_array_length(p_entries)>93 then raise exception using errcode='22023',message='daily_provider_days_invalid';end if;
 if not exists(select 1 from pg_proc where oid='private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)'::regprocedure and md5(prosrc)='a4e4e1a403bf0aa2dc70c7bb7ad4e6c9')then raise exception'daily_provider_days_enqueue_drift';end if;
 -- Validate the ENTIRE plan before the first admission. No partial mutation of
 -- an unauthorized or unsupported later native/date/filter is permitted.
 for entry in select value from jsonb_array_elements(p_entries)loop
  q:=entry->'request';t:=entry->'target';
  if private.prepared_aggregate_target_current(t)is distinct from true or private.prepared_aggregate_request_reason(q,t)is not null
   or t->>'source'not in('ar','newar','kb')or q->>'view'is distinct from'providers'or q->>'direction'is distinct from'all'or q->>'successBasis'is distinct from'success'or coalesce(q->>'status','all')<>'all'
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','currency','offset','limit']<>'{}'::jsonb
   or q?'currency'and q->'currency'<>'null'::jsonb and q->>'currency'is distinct from t->>'currency'
   or(q->>'startAt')::timestamptz is distinct from(q->>'successStartAt')::timestamptz or(q->>'endAt')::timestamptz is distinct from(q->>'successEndAt')::timestamptz
   or(q->>'endAt')::timestamptz>clock_timestamp()then raise exception using errcode='22023',message='daily_provider_days_unsupported';end if;
  local_a:=(q->>'startAt')::timestamptz at time zone(t->>'timezone');local_b:=(q->>'endAt')::timestamptz at time zone(t->>'timezone');
  if local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)or local_b::date-local_a::date<>1 then raise exception using errcode='22023',message='daily_provider_days_invalid_window';end if;
  scope:=t->>'scope_group';common:=commons->>scope;if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  if dep is distinct from entry->>'dependency'then raise exception using errcode='55000',message='daily_provider_days_dependency_changed';end if;
  b:=private.prepared_aggregate_base_request(q,t);k:=private.prepared_aggregate_key(b,t);
  validated:=validated||jsonb_build_array(entry||jsonb_build_object('base',b,'key',k));
 end loop;
 -- Original actor/day budget is acquired before any source-job row lock.
 -- This does not introduce a job->actor lock inversion for mixed daily plans.
 for entry in select value from jsonb_array_elements(validated)order by md5((value->'key')::text),(value->'key')::text collate"C"loop
  k:=entry->'key';fingerprint:=md5(k::text);
  if permits?fingerprint then continue;end if;
  if not exists(select 1 from private.prepared_aggregate_jobs where request_fingerprint=fingerprint and request_key=k)then
   budget:=null;
   insert into private.prepared_aggregate_admissions(actor,day,total)values(actor_id,current_date,1)
    on conflict(actor,day)do update set total=private.prepared_aggregate_admissions.total+1 where private.prepared_aggregate_admissions.total<1000 returning total into budget;
   permits:=permits||jsonb_build_object(fingerprint,budget is not null);
  end if;
 end loop;
 for entry in select value from jsonb_array_elements(validated)order by md5((value->'key')::text),(value->'key')::text collate"C"loop
  q:=entry->'request';t:=entry->'target';b:=entry->'base';k:=entry->'key';dep:=entry->>'dependency';fingerprint:=md5(k::text);reason:=null;
  -- Repeated exact source days share one admission and one original quota debit.
  if seen?fingerprint then
   if seen->fingerprint->'key'is distinct from k then raise exception'daily_provider_days_identity_collision';end if;
   states:=states||jsonb_build_array(((seen->fingerprint)-'key')||jsonb_build_object('owner',entry->'owner'));continue;end if;
  select *into j from private.prepared_aggregate_jobs where request_fingerprint=fingerprint and request_key=k for update;
  select a0.id,a0.revision,a0.dependency,a0.cutoff,a0.computed_at,a0.expires_at,a0.source_complete into a
   from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
  readable:=a.id is not null and j.target=t and j.dependency=dep and a.dependency=dep and a.revision=j.revision
   and a.cutoff>=(q->>'endAt')::timestamptz and a.computed_at is not null and a.expires_at>a.computed_at and a.source_complete is not null;
  if readable is true then
   -- Exact original V2 force bookkeeping; it does not recompute, invalidate or
   -- replace the immutable publication, and failed/running jobs are not reset.
   if p_force then
    update private.prepared_aggregate_jobs z set status='queued',attempts=0,not_before=clock_timestamp()
     where z.id=j.id and z.status='ready'and z.revision=a.revision and z.dependency=dep and z.target=t;
   end if;
   state:='ready';
  elsif j.status='running'then state:=case when j.target=t and j.dependency=dep then'running'else'failed'end;reason:=case when state='failed'then'daily_provider_day_running_scope_changed'end;
  elsif j.status='failed'and(j.last_error='superseded_by_full_master'and j.target=t and j.dependency=dep and(j.lease_until is null or j.lease_until<=clock_timestamp()))is not true then
   state:='failed';reason:='daily_provider_day_failed';
  elsif j.lease_until>clock_timestamp()then state:='failed';reason:='daily_provider_day_active_lease';
  else
   job_id:=null;budget:=null;was_missing:=j.id is null;
   if j.id is null then
    if permits->fingerprint='true'::jsonb then budget:=1;job_id:=private.prepared_aggregate_enqueue(b,t,dep,20::smallint);end if;
   else
    job_id:=private.prepared_aggregate_enqueue(b,t,dep,20::smallint);
    -- Only an ordinary READY job with no usable publication is repaired here.
    -- Running leases and all ordinary failed retry budgets remain untouched.
    update private.prepared_aggregate_jobs z set status='queued',not_before=clock_timestamp()
     where z.id=job_id and z.status='ready'and z.target=t and z.dependency=dep
      and(z.lease_until is null or z.lease_until<=clock_timestamp())and z.revision=j.revision;
   end if;
   select *into j from private.prepared_aggregate_jobs where id=job_id;
   state:=case when job_id is null then'failed'when j.target=t and j.dependency=dep and j.status in('queued','running')then j.status else'failed'end;
   reason:=case when job_id is null and was_missing and budget is null then'daily_provider_day_admission_limited'when job_id is null then'daily_provider_day_capacity'when state='failed'then'daily_provider_day_unavailable'end;
  end if;
  seen:=seen||jsonb_build_object(fingerprint,jsonb_build_object('key',k,'status',state,'reason',reason));
  states:=states||jsonb_build_array(jsonb_build_object('owner',entry->'owner','status',state,'reason',reason));
 end loop;
 return states;
end;$function$;
alter function private.daily_provider_base_admit_days(jsonb,boolean) owner to postgres;
revoke all on function private.daily_provider_base_admit_days(jsonb,boolean) from public,anon,authenticated,service_role;
-- END admit-days

-- BEGIN enqueue
CREATE OR REPLACE FUNCTION private.daily_provider_base_enqueue(p_pending jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare entry jsonb;identity jsonb;k jsonb;f jsonb;j private.daily_provider_base_jobs%rowtype;states jsonb:='{}';background_requested_at timestamptz;n integer;actor_id uuid:=coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid);
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
  background_requested_at:=(entry->>'backgroundRequestedAt')::timestamptz;
  if background_requested_at is not null and(not isfinite(background_requested_at)or background_requested_at>clock_timestamp())then continue;end if;
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
  if background_requested_at is not null then
   -- Inherit the last real reader touch, including concurrent committed ones.
   -- Background admission never makes its own family artificially recent.
   select greatest(background_requested_at,max(locked.last_requested_at))into background_requested_at from(select last_requested_at from private.daily_provider_base_jobs where family_digest=md5(f::text)and family_key=f for update)locked;
  end if;
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
   insert into private.daily_provider_base_jobs(digest,content_key,family_digest,family_key,target,request,dependency,daily_metadata,last_requested_at)
    values(md5(k::text),k,md5(f::text),f,entry->'target',entry->'request',entry->>'dependency',entry->'metadata',coalesce(background_requested_at,clock_timestamp()))on conflict(digest)do nothing;
  else
   update private.daily_provider_base_jobs set last_requested_at=clock_timestamp()where id=j.id and background_requested_at is null and last_requested_at<clock_timestamp()-interval'1minute';
   update private.daily_provider_base_jobs set status='queued',attempts=0,not_before=clock_timestamp()where id=j.id and status='ready'
    and not exists(select 1 from private.daily_provider_base_artifacts a where a.digest=j.digest and a.content_key=j.content_key and a.reuse_digest=md5(a.reuse_metadata::text)and private.daily_provider_base_reuse_current(a.reuse_metadata,a.item_digest,j.target,j.dependency));
  end if;
  update private.daily_provider_base_heads set last_requested_at=clock_timestamp()where family_digest=md5(f::text)and family_key=f and background_requested_at is null and last_requested_at<clock_timestamp()-interval'1minute';
 end loop;
 return states;
end;$function$;
-- END enqueue

-- BEGIN prewarm
CREATE OR REPLACE FUNCTION private.daily_provider_base_prewarm_internal(p_requests jsonb, p_background_requested_at timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q jsonb;t jsonb;dep text;tz text;la timestamp;lb timestamp;d date;dq jsonb;baseq jsonb;k jsonb;
 j private.prepared_aggregate_jobs%rowtype;a private.prepared_aggregate_artifacts%rowtype;
 metadata jsonb;missing_days jsonb:='[]';day_states jsonb;request_index integer:=0;pending jsonb:='[]';identity jsonb;pub jsonb;valid boolean;n integer:=0;states jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if current_setting('statement_timeout')::interval<=interval'0seconds'or current_setting('statement_timeout')::interval>interval'3seconds'then raise exception 'daily_provider_base_claim_deadline_required';end if;
 if p_background_requested_at is not null and(not isfinite(p_background_requested_at)or p_background_requested_at>clock_timestamp())then raise exception using errcode='22023',message='daily_provider_background_activity_invalid';end if;
 if jsonb_typeof(p_requests)is distinct from'array'or jsonb_array_length(p_requests)not between 1 and 3 or octet_length(p_requests::text)>1048576 then raise exception 'daily_provider_base_prewarm_invalid';end if;
 for q in select value from jsonb_array_elements(p_requests)loop
  select to_jsonb(p)into t from private.prepared_aggregate_native_catalog()p join private.provider_snapshot_targets st on st.platform_id=p.id and st.enabled and st.target=to_jsonb(p)where p.id::text=q->>'platformId';
  if t is null then continue;end if;
  if private.prepared_aggregate_request_reason(q,t)is not null or t->>'source'not in('ar','newar','kb')or q->>'view'is distinct from'providers'
   or q->>'successBasis'is distinct from'success'or coalesce(q->>'status','all')<>'all'
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or(q->>'startAt')::timestamptz is distinct from(q->>'successStartAt')::timestamptz or(q->>'endAt')::timestamptz is distinct from(q->>'successEndAt')::timestamptz
   or(q->>'endAt')::timestamptz>clock_timestamp()then continue;end if;
  tz:=t->>'timezone';la:=(q->>'startAt')::timestamptz at time zone tz;lb:=(q->>'endAt')::timestamptz at time zone tz;
  if la<>date_trunc('day',la)or lb<>date_trunc('day',lb)or lb::date-la::date not between 2 and 31 then continue;end if;
  dep:=private.prepared_aggregate_dependency(t,private.prepared_aggregate_dependency_common(t->>'scope_group'));metadata:='[]';valid:=true;
  for d in select generate_series(la::date,lb::date-1,interval'1day')::date loop
   dq:=(q-array['providers','amountBands'])||jsonb_build_object('direction','all',
    'startAt',to_char(d::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char((d+1)::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successStartAt',to_char(d::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successEndAt',to_char((d+1)::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
   baseq:=private.prepared_aggregate_base_request(dq,t);k:=private.prepared_aggregate_key(baseq,t);
   select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   select a0.*into a from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
   if a.id is null or j.target is distinct from t or j.dependency is distinct from dep or a.dependency is distinct from dep or a.revision is distinct from j.revision
    or a.cutoff<(dq->>'endAt')::timestamptz or a.cutoff is null or a.computed_at is null or a.expires_at<=a.computed_at or a.source_complete is null then
    valid:=false;missing_days:=missing_days||jsonb_build_array(jsonb_build_object('owner',request_index,'request',dq,'target',t,'dependency',dep));continue;
   end if;
   pub:=jsonb_build_object('id',a.id,'generation',a.revision::text||':'||a.fence::text,'computedAt',a.computed_at,'expiresAt',a.expires_at,'cutoff',a.cutoff,
    'calculationComplete',true,'sourceComplete',a.source_complete,'freshness',case when a.expires_at>transaction_timestamp()then'fresh'else'refresh_due'end,
    'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end);
   metadata:=metadata||jsonb_build_array(jsonb_build_object('request',dq,'publication',pub));
  end loop;
  request_index:=request_index+1;
  if not valid then continue;end if;
  identity:=private.daily_provider_base_identity(metadata,q,t,dep);
  pending:=pending||jsonb_build_array(jsonb_build_object('identity',identity,'target',t,'request',identity->'base','dependency',dep,'metadata',metadata)||case when p_background_requested_at is null then'{}'::jsonb else jsonb_build_object('backgroundRequestedAt',p_background_requested_at)end);n:=n+1;
 end loop;
 day_states:=private.daily_provider_base_admit_days(missing_days,false);
 states:=private.daily_provider_base_enqueue(pending);
 return jsonb_build_object('eligibleWindows',n,'limitedWindows',(select count(*)from jsonb_object_keys(states)),'missingDays',jsonb_array_length(missing_days),'preparingDays',(select count(*)from jsonb_array_elements(day_states)e where e->>'status'in('queued','running','ready')),'failedDays',(select count(*)from jsonb_array_elements(day_states)e where e->>'status'='failed'));
end;$function$;

alter function private.daily_provider_base_prewarm_internal(jsonb,timestamptz) owner to postgres;
revoke all on function private.daily_provider_base_prewarm_internal(jsonb,timestamptz) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.daily_provider_base_prewarm(p_requests jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $function$
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 return private.daily_provider_base_prewarm_internal(p_requests,null);
end;$function$;
-- END prewarm

-- BEGIN claim
CREATE OR REPLACE FUNCTION private.daily_provider_base_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j private.daily_provider_base_jobs%rowtype;warm_job private.daily_provider_base_jobs%rowtype;warm_request jsonb;started timestamptz;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='daily_provider_base_worker_denied';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('provider_snapshot_claim_v1',0))then return null;end if;
 if exists(select 1 from private.provider_snapshot_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.prepared_aggregate_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.withdraw_prepared_jobs where status='running'and lease_until>clock_timestamp())
  or exists(select 1 from private.daily_provider_base_jobs where status='running'and lease_until>clock_timestamp())then return null;end if;
 -- Idle metadata maintenance runs BEFORE any base-row write/lock. Both this
 -- background path and the reader acquire actor/source rows before base rows.
 if not exists(select 1 from private.daily_provider_base_jobs where status='running')
  and not exists(select 1 from private.daily_provider_base_jobs where status in('queued','failed')and attempts<3 and not_before<=clock_timestamp())then
  select *into warm_job from private.daily_provider_base_jobs where last_requested_at>=clock_timestamp()-interval'1day'and not_before<=clock_timestamp()
   and(status='ready'or(status='failed'and attempts>=3 and last_error='daily_provider_base_obsolete'))
   order by not_before,last_requested_at desc,created_at limit 1;
  if warm_job.id is not null then
   -- The family contains original daily q key presence/types. Canonical job
   -- request alone loses offset/limit and would prewarm a different family.
   warm_request:=(warm_job.content_key->'dailyRequests'->0)||jsonb_build_object(
    'startAt',warm_job.request->>'startAt','endAt',warm_job.request->>'endAt',
    'successStartAt',warm_job.request->>'successStartAt','successEndAt',warm_job.request->>'successEndAt');
   begin
    perform private.daily_provider_base_prewarm_internal(jsonb_build_array(warm_request),warm_job.last_requested_at);
   exception when invalid_parameter_value or object_not_in_prerequisite_state or lock_not_available then
    null; -- Conservative drift/contention miss; no authority/deadline catch.
   end;
   -- A new content key may have retired this old non-running row. Zero rows is
   -- expected; no running lease/retry budget/activity timestamp is rewritten.
   update private.daily_provider_base_jobs set not_before=clock_timestamp()+interval'5minutes'
    where id=warm_job.id and content_key=warm_job.content_key
     and(status='ready'or(status='failed'and attempts>=3 and last_error='daily_provider_base_obsolete'));
  end if;
 end if;
 update private.daily_provider_base_jobs set status='failed',lease_until=null,last_error='daily_provider_base_lease_expired',not_before=clock_timestamp()+interval'1minute'
  where status='running'and lease_until<=clock_timestamp();
 select *into j from private.daily_provider_base_jobs where status in('queued','failed')and attempts<3 and not_before<=clock_timestamp()
  order by not_before,created_at for update skip locked limit 1;
 if not found then return null;end if;
 if not private.prepared_aggregate_take_turn('prepared')then return null;end if;
 select backend_start into started from pg_stat_activity where pid=pg_backend_pid();
 update private.daily_provider_base_jobs set status='running',attempts=attempts+1,fence=fence+1,run_id=gen_random_uuid(),
  lease_until=clock_timestamp()+interval'120seconds',claim_pid=pg_backend_pid(),claim_backend_start=started where id=j.id returning *into j;
 return jsonb_build_object('jobId',j.id,'runId',j.run_id,'fence',j.fence);
end;$function$;
-- END claim

-- BEGIN reader
CREATE OR REPLACE FUNCTION private.dashboard_admin_daily_provider_prepared_read(p_page text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 access jsonb;page jsonb;ctx jsonb;catalog jsonb;targets jsonb:='[]';q jsonb;t jsonb;dq jsonb;
 missing_days jsonb:='[]';all_days jsonb:='[]';day_states jsonb;day_entry jsonb;day_item jsonb;one_response jsonb;native_missing boolean;native_failed boolean;native_reason text;sourcedays_forced boolean:=false;
 commons jsonb:='{}';scope text;common text;dep text;baseq jsonb;k jsonb;
 metadata jsonb:='[]';parts jsonb:='[]';mappings jsonb:='[]';all_items jsonb:='[]';items jsonb:='[]';chunk jsonb;response jsonb;folded jsonb;
 a timestamptz;b timestamptz;local_a timestamp;local_b timestamp;day date;day_end timestamptz;tz text;
 i integer:=0;start_index integer;part_index integer:=0;mapping jsonb;selected jsonb;original_q jsonb;
 j private.prepared_aggregate_jobs%rowtype;artifact private.prepared_aggregate_artifacts%rowtype;prepared jsonb;pending jsonb:='[]';states jsonb;reason text;identity jsonb;
begin
 -- Same page, query grant and assigned-context checks as the unmodified reader.
 -- Do this before even looking up a prepared head or native platform metadata.
 access:=private.dashboard_role_access();
 if(access->>'canView')::boolean is not true then raise exception using errcode='42501',message='preview_denied';end if;
 select value into page from jsonb_array_elements(private.dashboard_role_catalog()->'pages')where value->>'id'=p_page;
 if page is null or not(page->'requests'?'aggregate')or not(page->'requests'?'aggregatePrepared')then raise exception using errcode='42501',message='page_action_denied';end if;
 if access->>'mode'='assigned'then
  if not private.dashboard_role_context_valid()or not(access->'permissions'?&array[p_page||'.view',p_page||'.query'])then raise exception using errcode='42501',message='role_permission_denied';end if;
  ctx:=nullif(current_setting('hensem.dashboard_role_context',true),'')::jsonb->'payload';
  if ctx->>'page'is distinct from p_page or ctx->>'rpc'is distinct from'dashboard_admin_live_aggregate_prepared'or ctx->>'action'is distinct from'aggregatePrepared'then raise exception using errcode='42501',message='page_action_denied';end if;
 end if;
 -- Optional display-name hints never become financial filters or identity.
 -- Invalid/oversized hints are omitted; valid main requests retain old behavior.
 if p_request?'providerReuseNames'then
  if p_request->'publicationVersion'is distinct from'2'::jsonb or jsonb_typeof(p_request->'providerReuseNames')is distinct from'array'then p_request:=p_request-'providerReuseNames';
  elsif jsonb_array_length(p_request->'providerReuseNames')>200 or octet_length((p_request->'providerReuseNames')::text)>8192 then p_request:=p_request-'providerReuseNames';
  elsif exists(select 1 from jsonb_array_elements(p_request->'providerReuseNames')n where jsonb_typeof(n)is distinct from'string'or length(btrim(n#>>'{}'))not between 1 and 200 or(n#>>'{}')~'[[:cntrl:]]')then p_request:=p_request-'providerReuseNames';end if;
 end if;
 if p_request is null or jsonb_typeof(p_request)is distinct from'object'
  or p_request-array['requests','publicationVersion','forceRefresh','providerReuseNames']<>'{}'::jsonb or octet_length(p_request::text)>1048576
  or p_request->'publicationVersion'is distinct from'2'::jsonb or jsonb_typeof(p_request->'requests')is distinct from'array'
  or jsonb_array_length(p_request->'requests')not between 1 and 3
  or p_request?'forceRefresh'and jsonb_typeof(p_request->'forceRefresh')is distinct from'boolean'
 then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
 <<complete_days>>
 begin
 select coalesce(jsonb_agg(to_jsonb(p)),'[]')into catalog from private.dashboard_admin_live_platforms()p;
 for q in select value from jsonb_array_elements(p_request->'requests')loop
  -- Invalid UUIDs are delegated to the original validation, never coerced.
  select value into t from jsonb_array_elements(catalog)where value->>'id'=q->>'platformId';
  if t is null then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
  if private.prepared_aggregate_request_reason(q,t)is not null or t->>'source'not in('ar','newar','kb')
   or q-array['action','view','platformId','startAt','endAt','successStartAt','successEndAt','successBasis','direction','status','providers','currency','offset','limit','amountBands']<>'{}'::jsonb
   or q->>'view'is distinct from'providers'or coalesce(q->>'status','all')<>'all'or q->>'successBasis'is distinct from'success'
   or q->>'successStartAt'is null or q->>'successEndAt'is null
   or q?'currency'and q->'currency'<>'null'::jsonb and q->>'currency'is distinct from t->>'currency'
  then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
  a:=(q->>'startAt')::timestamptz;b:=(q->>'endAt')::timestamptz;tz:=t->>'timezone';
  local_a:=a at time zone tz;local_b:=b at time zone tz;
  if a is distinct from(q->>'successStartAt')::timestamptz or b is distinct from(q->>'successEndAt')::timestamptz
   or local_a<>date_trunc('day',local_a)or local_b<>date_trunc('day',local_b)
   or local_b::date-local_a::date not between 2 and 31 or b>clock_timestamp()
  then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
  start_index:=jsonb_array_length(parts);targets:=targets||jsonb_build_array(t);
  scope:=t->>'scope_group';common:=commons->>scope;
  if common is null then common:=private.prepared_aggregate_dependency_common(scope);commons:=commons||jsonb_build_object(scope,common);end if;
  dep:=private.prepared_aggregate_dependency(t,common);
  for day in select generate_series(local_a::date,local_b::date-1,interval'1day')::date loop
   day_end:=(day+1)::timestamp at time zone tz;
   -- Provider totals ignore validated chart bands, just like the unchanged
   -- canonical/base request. Drop them before widening daily direction to all.
   dq:=(q-array['providers','amountBands'])||jsonb_build_object('direction','all',
    'startAt',to_char(day::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char(day_end at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successStartAt',to_char(day::timestamp at time zone tz at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'successEndAt',to_char(day_end at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
   baseq:=private.prepared_aggregate_base_request(dq,t);k:=private.prepared_aggregate_key(baseq,t);
   select *into j from private.prepared_aggregate_jobs where request_fingerprint=md5(k::text)and request_key=k;
   select a0.*into artifact from private.prepared_aggregate_heads h join private.prepared_aggregate_artifacts a0 on a0.id=h.artifact_id where h.job_id=j.id;
   if artifact.id is null or artifact.revision is distinct from j.revision or artifact.dependency is distinct from dep
    or j.dependency is distinct from dep or j.target is distinct from t or artifact.cutoff<day_end
    or artifact.cutoff is null or artifact.computed_at is null or artifact.expires_at<=artifact.computed_at
    or artifact.source_complete is null
   then
    missing_days:=missing_days||jsonb_build_array(jsonb_build_object('owner',i,'request',dq,'target',t,'dependency',dep));
    metadata:=metadata||jsonb_build_array(null::jsonb);
   else
   metadata:=metadata||jsonb_build_array(jsonb_build_object('request',dq,'jobId',j.id,'publication',jsonb_build_object(
    'id',artifact.id,'generation',artifact.revision::text||':'||artifact.fence::text,'computedAt',artifact.computed_at,
    'expiresAt',artifact.expires_at,'cutoff',artifact.cutoff,'calculationComplete',true,'sourceComplete',artifact.source_complete,
    'freshness',case when artifact.expires_at>clock_timestamp()then'fresh'else'refresh_due'end,
    'nextRefreshAt',j.next_due_at,'refreshState',case when j.status='ready'then'idle'else j.status end)));
   end if;
   all_days:=all_days||jsonb_build_array(jsonb_build_object('owner',i,'request',dq,'target',t,'dependency',dep));
   parts:=parts||jsonb_build_array(dq);
  end loop;
  mappings:=mappings||jsonb_build_array(jsonb_build_object('first',start_index,'count',jsonb_array_length(parts)-start_index,'dependency',dep));i:=i+1;
 end loop;
 if jsonb_array_length(missing_days)>0 then
  sourcedays_forced:=coalesce((p_request->>'forceRefresh')::boolean,false);
  -- Force and ordinary daily admission share actor->sorted source lock order.
  -- Already-readable ready days receive only the original V2 metadata update.
  day_states:=private.daily_provider_base_admit_days(case when sourcedays_forced then all_days else missing_days end,sourcedays_forced);exit complete_days;
 end if;
 -- 3 platforms ×31 local days, split sequentially. No client concurrency change,
 -- no broadened original RPC batch contract, no synchronous raw computation.
 if jsonb_array_length(parts)>93 then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
 -- Only exact completed batches can avoid the old full daily DTO path.
 -- Force, miss and last-complete retain the unchanged original admission.
 if not coalesce((p_request->>'forceRefresh')::boolean,false)then
  response:=private.daily_provider_base_exact_read(p_request,targets,mappings,metadata);
  if response is not null then return response;end if;
 end if;
 part_index:=0;
 while part_index<jsonb_array_length(parts)loop
  select jsonb_agg(value order by n)into chunk from jsonb_array_elements(parts)with ordinality p(value,n)where n>part_index and n<=part_index+50;
  response:=private.prepared_aggregate_read(p_page,(p_request-array['requests','providerReuseNames'])||jsonb_build_object('requests',chunk));
  if response->>'version'is distinct from'2'or jsonb_typeof(response->'items')is distinct from'array'
   or jsonb_array_length(response->'items')<>jsonb_array_length(chunk)
   or exists(select 1 from jsonb_array_elements(response->'items')with ordinality r(value,n)where value->>'status'is distinct from'ready'or value->'request'is distinct from chunk->(n::integer-1))
  then
   -- A head can change after preflight. Recheck/admit only daily keys, never
   -- enqueue the original broad window in parallel with its source-day work.
   missing_days:=all_days;day_states:=private.daily_provider_base_admit_days(missing_days,false);exit complete_days;
  end if;
  all_items:=all_items||(response->'items');part_index:=part_index+50;
 end loop;
 i:=0;
 for mapping in select value from jsonb_array_elements(mappings)loop
  original_q:=p_request->'requests'->i;t:=targets->i;
  select jsonb_agg(value order by n)into selected from jsonb_array_elements(all_items)with ordinality r(value,n)
   where n>(mapping->>'first')::integer and n<=(mapping->>'first')::integer+(mapping->>'count')::integer;
  begin
   prepared:=private.daily_provider_base_lookup(selected,original_q,t,mapping->>'dependency');
   if prepared->'fallback'='true'::jsonb then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
   folded:=prepared->'item';
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then folded:=null;end;
  if folded is null then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
  items:=items||jsonb_build_array(folded);
  pending:=pending||jsonb_build_array(prepared->'pending');i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 -- Match the existing prepared manager's 16 MiB encoded-response bound.
 -- Preserve original fallback behavior instead of truncating providers/leaves.
 if octet_length(response::text)>16*1024*1024 then return private.prepared_aggregate_read(p_page,p_request-'providerReuseNames');end if;
 states:=private.daily_provider_base_enqueue(pending);
 i:=0;
 for prepared in select value from jsonb_array_elements(pending)loop
  identity:=prepared->'identity';reason:=states->>md5((identity->'key')::text);
  if reason is not null then
   if response->'items'->i->>'status'='building'then
    response:=jsonb_set(response,array['items',i::text],(response->'items'->i)||jsonb_build_object('status','failed','reason',reason));
   elsif response->'items'->i->'publication'->'servedLastComplete'='true'::jsonb then
    response:=jsonb_set(response,array['items',i::text,'publication'],(response->'items'->i->'publication')||jsonb_build_object('refreshState','failed','refreshError',reason));
   end if;
  end if;
  i:=i+1;
 end loop;
 return response;
 end complete_days;
 -- Same existing bounded client poll contract: preparation now includes
 -- normally admitted source days before derived work. No publication/money is
 -- returned for a native whose required days are not all available yet.
 items:='[]';i:=0;
 for original_q in select value from jsonb_array_elements(p_request->'requests')loop
  native_missing:=exists(select 1 from jsonb_array_elements(missing_days)e where(e->>'owner')::integer=i);
  if native_missing then
   native_failed:=exists(select 1 from jsonb_array_elements(day_states)e where(e->>'owner')::integer=i and coalesce(e->>'status','')not in('ready','queued','running'));
   select e->>'reason'into native_reason from jsonb_array_elements(day_states)e where(e->>'owner')::integer=i and coalesce(e->>'status','')not in('ready','queued','running')limit 1;
   day_item:=jsonb_build_object('request',original_q,'status',case when native_failed then'failed'else'building'end,'reason',case when native_failed then coalesce(native_reason,'daily_provider_day_unavailable')else'daily_provider_base_preparing'end,'result',null,'publication',null);
  else
   -- Other fully prepared natives retain their exact ready/last-complete path
   -- and are delivered once; they do not join the missing native's polling.
   one_response:=private.dashboard_admin_daily_provider_prepared_read(p_page,jsonb_set(case when sourcedays_forced then p_request-'forceRefresh'else p_request end,'{requests}',jsonb_build_array(original_q)));
   day_item:=one_response->'items'->0;
  end if;
  items:=items||jsonb_build_array(day_item);i:=i+1;
 end loop;
 response:=jsonb_build_object('version',2,'items',items);
 if octet_length(response::text)>16*1024*1024 then
  select jsonb_agg(value-'providerReuse'order by ordinal)into items from jsonb_array_elements(items)with ordinality r(value,ordinal);response:=jsonb_build_object('version',2,'items',items);
  if octet_length(response::text)>16*1024*1024 then raise exception using errcode='54000',message='daily_provider_response_capacity';end if;
 end if;
 return response;
end;$function$;
-- END reader
do $verify$
declare e jsonb;p pg_proc%rowtype;s jsonb;d jsonb;
begin
 for e in select value from jsonb_array_elements($guard$[{"signature":"private.daily_provider_base_claim()","body":"3648171d9c60e0664eeb87eac4d7074e","definition":"7e62877a9196809f5c8e7f8b8309e36c","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_claim","prorows":0,"pronargs":0,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_enqueue(jsonb)","body":"3e91604fc68dd00b95cc2228465987a0","definition":"5885c2793fe673413574fdd60f509438","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_enqueue","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_pending"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_prewarm(jsonb)","body":"961373610e68a9ffb875aba9bba9bdf6","definition":"6486017965c6b31a3cb8f558b884f7dd","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_prewarm","prorows":0,"pronargs":1,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_requests"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.dashboard_admin_daily_provider_prepared_read(text,jsonb)","body":"2d192bb43a5fdfb07230bc8a5f6d859f","definition":"6dccfdb87ea7eef3b7b851eed8f9467b","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_daily_provider_prepared_read","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_page","p_request"],"proargtypes":["25","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_admit_days(jsonb,boolean)","body":"d7994c11a4e27615eb774e4a65a92ffa","definition":"748c5c28d9f8342b0996deff750bcf74","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_admit_days","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_entries","p_force"],"proargtypes":["3802","16"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"},{"signature":"private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)","body":"9aa3342e3095e492bb9a8c0d5903507e","definition":"732492ecaefd89ac6079dfc3aec2b801","metadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_prewarm_internal","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_requests","p_background_requested_at"],"proargtypes":["3802","1184"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"language":"plpgsql"}]$guard$::jsonb)loop
 select *into p from pg_proc where oid=to_regprocedure(e->>'signature');
 if p.oid is null or md5(p.prosrc)is distinct from e->>'body'or md5(pg_get_functiondef(p.oid))is distinct from e->>'definition'
  or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from e->'metadata'
  or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)is distinct from e->>'language'
 then raise exception'daily_provider_day_admission_function_cas:%',e->>'signature';end if;
 end loop;
 select(select jsonb_agg(jsonb_build_array(snapshot_fn.oid,case when snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_claim()'),to_regprocedure('private.daily_provider_base_enqueue(jsonb)'),to_regprocedure('private.daily_provider_base_prewarm(jsonb)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)')])then null else md5(pg_get_functiondef(snapshot_fn.oid))end,to_jsonb(snapshot_fn)-array['prosrc','prosqlbody'])order by snapshot_fn.oid)from pg_proc snapshot_fn where snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_claim()'),to_regprocedure('private.daily_provider_base_current(jsonb,jsonb)'),to_regprocedure('private.daily_provider_base_enqueue(jsonb)'),to_regprocedure('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'),to_regprocedure('private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)'),to_regprocedure('private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)'),to_regprocedure('private.daily_provider_base_manifest_matches(jsonb)'),to_regprocedure('private.daily_provider_base_run_claimed()'),to_regprocedure('private.dashboard_admin_live_confirmed_provider(text,text,text)'),to_regprocedure('private.dashboard_admin_live_provider_alias(text,text)'),to_regprocedure('private.dashboard_admin_live_provider_alias_values(text,text[])'),to_regprocedure('private.dashboard_admin_live_provider_canonical(text,text,text)'),to_regprocedure('private.dashboard_admin_wg_provider_aliases()'),to_regprocedure('private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)'),to_regprocedure('private.prepared_aggregate_canonical_request(jsonb,jsonb)'),to_regprocedure('private.prepared_aggregate_echo(jsonb,jsonb,jsonb)'),to_regprocedure('private.daily_provider_base_reuse_build(jsonb,jsonb,text)'),to_regprocedure('private.daily_provider_base_reuse_current(jsonb,text,jsonb,text)'),to_regprocedure('private.daily_provider_base_reuse_names(text)'),to_regprocedure('private.daily_provider_base_reuse_packet(jsonb,jsonb,jsonb,jsonb,text,text)'),to_regprocedure('private.daily_provider_base_reuse_semantics()'),to_regprocedure('private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)'),to_regprocedure('private.prepared_aggregate_read(text,jsonb)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)'),to_regprocedure('private.daily_provider_base_prewarm(jsonb)')]))into s;
 if s is distinct from current_setting('audit.provider_day_function_snapshot')::jsonb then raise exception'daily_provider_day_unexpected_function_metadata_change';end if;
 select(select jsonb_build_object('common',c.value,'targets',(select jsonb_agg(jsonb_build_array(to_jsonb(n),private.prepared_aggregate_dependency(to_jsonb(n),c.value))order by n.id)from private.prepared_aggregate_native_catalog()n where n.team='M8'and n.country='印度'and n.scope_group='IN'and n.source in('ar','newar','kb')))from(select private.prepared_aggregate_dependency_common('IN')value)c)into d;
 if d is distinct from current_setting('audit.provider_day_dependency_snapshot')::jsonb then raise exception'daily_provider_day_financial_dependency_changed';end if;
end;$verify$;
commit;
