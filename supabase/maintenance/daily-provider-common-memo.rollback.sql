-- Request-local common dependency memoization only. No financial producer,
-- request identity, immutable artifact, queue or source state is changed.
-- The original per-native target/dependency/manifest checks remain in both passes.
-- An original common-token re-read at the end rejects cross-SPI config drift.
-- 15s applies only to this metadata guarded DDL transaction, not query runtime.
begin;
set local statement_timeout='15s';set local lock_timeout='500ms';
do $preflight$
declare p pg_proc%rowtype;e jsonb;s jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='provider_common_memo_owner_required';end if;
 select *into p from pg_proc where oid=to_regprocedure('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)');
if p.oid is null or md5(p.prosrc)is distinct from '504776e61d176d655e236830899aeeb6'or md5(pg_get_functiondef(p.oid))is distinct from '985e3ec52e4d4a751ea2fb7dcb94a682'
or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from $guard${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_exact_read","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_request","p_targets","p_mappings","p_metadata"],"proargtypes":["3802","3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$guard$::jsonb
or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)<>'plpgsql'
then raise exception'provider_common_memo_cas:%','private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)';end if;
select *into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)');
if p.oid is null or md5(p.prosrc)is distinct from '67e36c0757c6ea85e8077932b21ea10e'or md5(pg_get_functiondef(p.oid))is distinct from 'd1dfeb85bb65ee9a3993a9a14b322417'
or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from $guard${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_daily_provider_prepared_read","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_page","p_request"],"proargtypes":["25","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$guard$::jsonb
or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)<>'plpgsql'
then raise exception'provider_common_memo_cas:%','private.dashboard_admin_daily_provider_prepared_read(text,jsonb)';end if;

 for e in select value from jsonb_array_elements($guard$[{"signature":"private.daily_provider_base_claim()","body":"3648171d9c60e0664eeb87eac4d7074e","definition":"7e62877a9196809f5c8e7f8b8309e36c"},{"signature":"private.daily_provider_base_current(jsonb,jsonb)","body":"b90f4e12c10f6eff54cc74f713b42d6d","definition":"3085c2eef73f7cf5aae356a129fca821"},{"signature":"private.daily_provider_base_enqueue(jsonb)","body":"3e91604fc68dd00b95cc2228465987a0","definition":"5885c2793fe673413574fdd60f509438"},{"signature":"private.daily_provider_base_identity(jsonb,jsonb,jsonb,text)","body":"480ca3b477bda870fd4b35606429216f","definition":"0f925406c76f576e05d6e921a16b2186"},{"signature":"private.daily_provider_base_lookup(jsonb,jsonb,jsonb,text)","body":"823d756a9df2d4a8e2bcce7e6cfffe55","definition":"c68306dbb0eca5e44d421557f2ea9d10"},{"signature":"private.daily_provider_base_manifest_matches(jsonb)","body":"7b28ca322f500d36fcf3195b51b94f27","definition":"2954df9d970eaf0db6c7424ca8017d56"},{"signature":"private.daily_provider_base_run_claimed()","body":"b5fec15fc16e71045bcc8b36ee05acf2","definition":"45231fe0a488af813dfb64f3eaf74486"},{"signature":"private.dashboard_admin_live_confirmed_provider(text,text,text)","body":"9d4130cb5173fb19f8e232331b2b9797","definition":"39f46b1156cf190aca0e8fa8906eafee"},{"signature":"private.dashboard_admin_live_provider_alias(text,text)","body":"016e7206225e117f316e289c55c083e3","definition":"60bbe2bcbc92862785370daefa03bedb"},{"signature":"private.dashboard_admin_live_provider_alias_values(text,text[])","body":"42b415a5cc8f38550e523836465da17f","definition":"ebc37751eb78fe9069de63d5cd798d3d"},{"signature":"private.dashboard_admin_live_provider_canonical(text,text,text)","body":"008e5cee3a4f6ac9e90706c45bee56da","definition":"4cda5f3c69719886903b149adc206e20"},{"signature":"private.dashboard_admin_wg_provider_aliases()","body":"5dedf6cf8a430e21b69ca81069db8b3b","definition":"9f08368371bb9a914ecf5d4b025a329e"},{"signature":"private.dashboard_prepared_provider_projection(jsonb,jsonb,jsonb)","body":"58fee45de05fe5567a62e69b297cee88","definition":"d9b05fd54abe3f0e1c4b9a940b47afb6"},{"signature":"private.prepared_aggregate_canonical_request(jsonb,jsonb)","body":"56218033e0849e0744f34ba92ad96e72","definition":"e019b146b7532b636c396d44aaf345dd"},{"signature":"private.prepared_aggregate_echo(jsonb,jsonb,jsonb)","body":"f72bd9afabd7c74de273f02f5e46499d","definition":"f02a1cfe6f62ee193c7da91b71fa9a8f"},{"signature":"private.daily_provider_base_reuse_build(jsonb,jsonb,text)","body":"f4f4aac6c631c11af7b149bdcc3b386a","definition":"4e774cb54968557a8a20dd850b5437f1"},{"signature":"private.daily_provider_base_reuse_current(jsonb,text,jsonb,text)","body":"ecfef84ce4f2c9ac4da3d558af433434","definition":"595b8b759bf167c6cdc91734cc206454"},{"signature":"private.daily_provider_base_reuse_names(text)","body":"103873605ed6d5ec68ee4ff02682ec11","definition":"e5ad0759398d0734da25984f9b03acd4"},{"signature":"private.daily_provider_base_reuse_packet(jsonb,jsonb,jsonb,jsonb,text,text)","body":"394123cdb37492f3ba84b27394617508","definition":"9747c874780169ec726b17588077ccf3"},{"signature":"private.daily_provider_base_reuse_semantics()","body":"deb96d97077456846bafe8125bd7fd9d","definition":"bb1b0c252e6966319e7741283648bfd8"},{"signature":"private.daily_provider_base_admit_days(jsonb,boolean)","body":"f8d31324b482e07d0e2afa9f1e25b554","definition":"071e6affae9b21beb485546ce8eb7279"},{"signature":"private.daily_provider_base_prewarm(jsonb)","body":"961373610e68a9ffb875aba9bba9bdf6","definition":"6486017965c6b31a3cb8f558b884f7dd"},{"signature":"private.daily_provider_base_prewarm_internal(jsonb,timestamp with time zone)","body":"9aa3342e3095e492bb9a8c0d5903507e","definition":"732492ecaefd89ac6079dfc3aec2b801"},{"signature":"private.prepared_aggregate_enqueue(jsonb,jsonb,text,smallint)","body":"a4e4e1a403bf0aa2dc70c7bb7ad4e6c9","definition":"51ab15b2eaedf6e682e9c5fbde1e3da4"},{"signature":"private.prepared_aggregate_read(text,jsonb)","body":"4a38ca3d9bbfbed3cc94250db95064da","definition":"df7914b8375708f883617b3d09265423"},{"signature":"private.prepared_aggregate_claim(text)","body":"f3d8d4bd4c21d52afe39c4149e39f46f","definition":"9a012a03870c50d7285dc78c07982a39"}]$guard$::jsonb)loop
  if not exists(select 1 from pg_proc x where x.oid=to_regprocedure(e->>'signature')and md5(x.prosrc)=e->>'body'and md5(pg_get_functiondef(x.oid))=e->>'definition')then raise exception'provider_common_memo_protected_cas:%',e->>'signature';end if;
 end loop;
 select(select jsonb_agg((to_jsonb(snapshot_fn)-case when snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)')])then array['prosrc','prosqlbody']else array[]::text[]end)order by snapshot_fn.oid)from pg_proc snapshot_fn where snapshot_fn.pronamespace in('private'::regnamespace,'public'::regnamespace))into s;perform set_config('audit.provider_common_memo_functions',s::text,true);
 select(select jsonb_build_object('common',c.value,'targets',(select jsonb_agg(jsonb_build_array(to_jsonb(n),private.prepared_aggregate_dependency(to_jsonb(n),c.value),private.provider_snapshot_dependency_token(to_jsonb(n)))order by n.id)from private.prepared_aggregate_native_catalog()n where n.team='M8'and n.country='印度'and n.scope_group='IN'and n.source in('ar','newar','kb')))from(select private.prepared_aggregate_dependency_common('IN')value)c)into s;perform set_config('audit.provider_common_memo_dependency',s::text,true);
end;$preflight$;
-- BEGIN 1
CREATE OR REPLACE FUNCTION private.daily_provider_base_exact_read(p_request jsonb, p_targets jsonb, p_mappings jsonb, p_metadata jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare mapping jsonb;t jsonb;q jsonb;selected jsonb;identity jsonb;proofs jsonb:='[]';proof jsonb;part jsonb;c jsonb;pub jsonb;payload jsonb;
 current_items jsonb;items jsonb:='[]';ready jsonb;outcome jsonb;response jsonb;i integer:=0;j private.prepared_aggregate_jobs%rowtype;
 a private.daily_provider_base_artifacts%rowtype;reuse_pack jsonb;reuse_pending jsonb:='[]';
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
  proofs:=proofs||jsonb_build_array(jsonb_build_object('identity',identity,'selected',selected,'item',a.item,'itemDigest',a.item_digest,'reuseMetadata',a.reuse_metadata,'reuseDigest',a.reuse_digest,'target',t,'request',q,'dependency',mapping->>'dependency'));
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
  -- New metadata comes only from this artifact's fenced background worker.
  -- The old on-read V4 generator is deliberately never run in parallel.
  reuse_pack:=null;
  if proof->>'reuseDigest'=md5((proof->'reuseMetadata')::text)
   and private.daily_provider_base_reuse_current(proof->'reuseMetadata',proof->>'itemDigest',t,proof->>'dependency')then
   reuse_pack:=private.daily_provider_base_reuse_packet(proof->'reuseMetadata',q,t,ready->'publication',proof->>'itemDigest',proof->>'dependency');
   ready:=ready||jsonb_build_object('providerReusePreparation',jsonb_build_object('state',case when proof->'reuseMetadata'->>'state'='ready'and reuse_pack is null then'unavailable'else proof->'reuseMetadata'->>'state'end,'reason',case when proof->'reuseMetadata'->>'state'='ready'and reuse_pack is null then'packet_capacity_or_read_budget'else proof->'reuseMetadata'->>'reason'end));
  else
   reuse_pending:=reuse_pending||jsonb_build_array(outcome->'pending');
   ready:=ready||jsonb_build_object('providerReusePreparation',jsonb_build_object('state','building'));
  end if;
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
 if jsonb_array_length(reuse_pending)>0 then perform private.daily_provider_base_enqueue(reuse_pending);end if;
 return response;
end;$function$;
-- END 1
-- BEGIN 2
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
-- END 2
do $verify$
declare p pg_proc%rowtype;s jsonb;
begin
 select *into p from pg_proc where oid=to_regprocedure('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)');
if p.oid is null or md5(p.prosrc)is distinct from '23b803f922a76c04900ca4bf6eca6169'or md5(pg_get_functiondef(p.oid))is distinct from 'c2b02acd41dd41e5806484c2d8337125'
or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from $guard${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"daily_provider_base_exact_read","prorows":0,"pronargs":4,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_request","p_targets","p_mappings","p_metadata"],"proargtypes":["3802","3802","3802","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$guard$::jsonb
or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)<>'plpgsql'
then raise exception'provider_common_memo_cas:%','private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)';end if;
select *into p from pg_proc where oid=to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)');
if p.oid is null or md5(p.prosrc)is distinct from '2d192bb43a5fdfb07230bc8a5f6d859f'or md5(pg_get_functiondef(p.oid))is distinct from '6dccfdb87ea7eef3b7b851eed8f9467b'
or(to_jsonb(p)-array['oid','prosrc','prosqlbody','proowner','prolang','pronamespace'])is distinct from $guard${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","proname":"dashboard_admin_daily_provider_prepared_read","prorows":0,"pronargs":2,"proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"3802","prosupport":"-","proargmodes":null,"proargnames":["p_page","p_request"],"proargtypes":["25","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$guard$::jsonb
or pg_get_userbyid(p.proowner)<>'postgres'or(select lanname from pg_language where oid=p.prolang)<>'plpgsql'
then raise exception'provider_common_memo_cas:%','private.dashboard_admin_daily_provider_prepared_read(text,jsonb)';end if;

 select(select jsonb_agg((to_jsonb(snapshot_fn)-case when snapshot_fn.oid=any(array[to_regprocedure('private.daily_provider_base_exact_read(jsonb,jsonb,jsonb,jsonb)'),to_regprocedure('private.dashboard_admin_daily_provider_prepared_read(text,jsonb)')])then array['prosrc','prosqlbody']else array[]::text[]end)order by snapshot_fn.oid)from pg_proc snapshot_fn where snapshot_fn.pronamespace in('private'::regnamespace,'public'::regnamespace))into s;if s is distinct from current_setting('audit.provider_common_memo_functions')::jsonb then raise exception'provider_common_memo_function_metadata_or_protected_changed';end if;
 select(select jsonb_build_object('common',c.value,'targets',(select jsonb_agg(jsonb_build_array(to_jsonb(n),private.prepared_aggregate_dependency(to_jsonb(n),c.value),private.provider_snapshot_dependency_token(to_jsonb(n)))order by n.id)from private.prepared_aggregate_native_catalog()n where n.team='M8'and n.country='印度'and n.scope_group='IN'and n.source in('ar','newar','kb')))from(select private.prepared_aggregate_dependency_common('IN')value)c)into s;if s is distinct from current_setting('audit.provider_common_memo_dependency')::jsonb then raise exception'provider_common_memo_financial_dependency_changed';end if;
end;$verify$;
commit;
