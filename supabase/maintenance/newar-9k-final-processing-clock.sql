-- Only the existing projection changes. Native IN/9K final-state lastUpdateTime
-- is owner-confirmed processing completion. Existing source handling has priority.
-- No raw records, payment success clocks, financial basis, statistics, heads,
-- queue state, source completeness flags, indexes or trigger definitions change.
BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $nine_k_install$
declare expected jsonb;actual jsonb;tokens_before jsonb;tokens_after jsonb;
begin
 if current_user<>'postgres'then raise exception using errcode='42501',message='nine_k_release_owner_required';end if;
 for expected in select value from jsonb_array_elements('[{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":1000,"body_md5":"3046cba0a3d11b7de9494bf629f4a002","identity":"private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"d7d3479835152bef0674fafa39bdfe70"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"5789c6b60e5bf5789b1ac1733df85c34","identity":"private.newar_stats_time(text)","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"i","proleakproof":false,"definition_md5":"1607156c0e7837bc0241fa5cd1153a2d"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":1000,"body_md5":"244fe0b21d3b785a40c6409807b358bc","identity":"private.newar_withdraw_fact(newar_detail_records)","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"v","proleakproof":false,"definition_md5":"22a130f5c77e555ee339a64405b5df00"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"9cba93eff52a872313d36e040b8e494d","identity":"private.prepared_aggregate_dependency_common(text)","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"6a05db0a38d9808a024b2c238b6c5257"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"b80d696c77fd44dc8e896b2a0da3380e","identity":"private.sync_newar_withdraw_fact()","proconfig":["search_path=\"\""],"prosecdef":true,"proisstrict":false,"proparallel":"u","provolatile":"v","proleakproof":false,"definition_md5":"be42c77be59dc64728b5719819363add"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"e339a7838ee2782a91efc72d69d6eb47","identity":"private.withdraw_prepared_dependency()","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"1136f25c81037057db8c9fc50b16f2bd"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"43ffae0a7d81144cc71e12ffc4928f4a","identity":"private.withdraw_prepared_source_contract_current()","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"d87e8b56f73a19b5aab7960edd53e9aa"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"72ca365d2d9ae0870861cd3e102764b5","identity":"private.withdraw_reason_hooks_fingerprint()","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"97aeeb3bed3c9b7faec9a1f2bd09ce29"}]'::jsonb)loop
 select jsonb_build_object('identity',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'definition_md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig),'prosecdef',p.prosecdef,'provolatile',p.provolatile,'proparallel',p.proparallel,'procost',p.procost,'prorows',p.prorows,'proisstrict',p.proisstrict,'proleakproof',p.proleakproof)into actual from pg_proc p where p.oid=to_regprocedure(expected->>'identity');
 if actual is distinct from expected then raise exception using errcode='22023',message='nine_k_install_preflight_metadata_drift',detail=expected->>'identity';end if;end loop;

 select jsonb_build_object('common',(select jsonb_object_agg(s,private.prepared_aggregate_dependency_common(s))from unnest(array['IN','BR','VN','ID','PK','ZAR','MX','CO'])s),'withdraw',private.withdraw_prepared_dependency(),'sourceContract',private.withdraw_prepared_source_contract_current(),'reasonHooks',private.withdraw_reason_hooks_fingerprint(),'maanGeneration',private.maan_submission_generation())into tokens_before;
 execute $nine_k_projection$
CREATE OR REPLACE FUNCTION private.newar_withdraw_fact(p newar_detail_records)
 RETURNS TABLE(record_id uuid, platform text, source_id text, status_group text, currency text, created_at timestamp with time zone, captured_at timestamp with time zone, received_at timestamp with time zone, method text, account text, submitted_at timestamp with time zone, handled_at timestamp with time zone)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select p.id,p.platform,p.source_id,p.status_group,p.currency,p.created_at,p.captured_at,p.received_at,
  coalesce(v.confirmed_method,case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
   and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual') then r."operatorType" end),
  case when r."businessSchemaVersion"='2' and nullif(btrim(r."operatorSourceField"),'') is not null
   and nullif(btrim(r."operatorName"),'') is not null and r."operatorType" in('auto','manual')
   then btrim(r."operatorName") else '（未知操作人）' end,
  case when r."businessSchemaVersion"='2' and nullif(r."sourceSubmittedSourceField",'') is not null
   then private.newar_stats_time(r."sourceSubmittedAt") end,
  coalesce(
   case when r."businessSchemaVersion"='2' and nullif(r."sourceHandledSourceField",'') is not null
    then private.newar_stats_time(r."sourceHandledAt") end,
   -- The owner confirmed only native IN/9K final-state lastUpdateTime is the
   -- processing completion event. Its epoch milliseconds must exactly agree
   -- with the separately normalized source clock. Never use observation clocks
   -- as an event, alter the submitted start, or infer payment success time.
   case when p.platform='9KCLUB' and r."businessSchemaVersion"='2'
    and ((p.status_code='3' and p.status_group='success') or (p.status_code='2' and p.status_group='failed'))
    and exists(select 1 from public.newar_detail_platforms t where t.platform=p.platform
     and t.country_code='IN' and t.timezone='Asia/Kolkata' and t.currency='INR' and t.enabled)
    and jsonb_typeof(p.raw->'lastUpdateTime')='number'
    and (p.raw->>'lastUpdateTime') ~ '^[0-9]{13}$'
   then case when isfinite(p.source_updated_at)
     and p.source_updated_at=to_timestamp((p.raw->>'lastUpdateTime')::numeric/1000)
     and p.source_updated_at>=p.created_at and p.source_updated_at<=p.captured_at
    then p.source_updated_at end
   end)
 from jsonb_to_record(case when jsonb_typeof(p.raw)='object' then p.raw else '{}'::jsonb end)
  r("businessSchemaVersion" text,"operatorType" text,"operatorName" text,"operatorSourceField" text,
    "sourceSubmittedAt" text,"sourceSubmittedSourceField" text,"sourceHandledAt" text,"sourceHandledSourceField" text)
 left join private.newar_withdraw_method_verifications v on v.record_id=p.id
  and v.platform=p.platform and v.dataset=p.dataset and v.source_id=p.source_id
 where p.dataset='withdraw';
$function$
$nine_k_projection$;
 for expected in select value from jsonb_array_elements('[{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":1000,"body_md5":"3046cba0a3d11b7de9494bf629f4a002","identity":"private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"d7d3479835152bef0674fafa39bdfe70"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"5789c6b60e5bf5789b1ac1733df85c34","identity":"private.newar_stats_time(text)","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"i","proleakproof":false,"definition_md5":"1607156c0e7837bc0241fa5cd1153a2d"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":1000,"body_md5":"c21dce3fbfb259e500691b4d94efe26c","identity":"private.newar_withdraw_fact(newar_detail_records)","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"v","proleakproof":false,"definition_md5":"c195abdfd4e03976e9fe9b1c1d4ee533"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"9cba93eff52a872313d36e040b8e494d","identity":"private.prepared_aggregate_dependency_common(text)","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"6a05db0a38d9808a024b2c238b6c5257"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"b80d696c77fd44dc8e896b2a0da3380e","identity":"private.sync_newar_withdraw_fact()","proconfig":["search_path=\"\""],"prosecdef":true,"proisstrict":false,"proparallel":"u","provolatile":"v","proleakproof":false,"definition_md5":"be42c77be59dc64728b5719819363add"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"e339a7838ee2782a91efc72d69d6eb47","identity":"private.withdraw_prepared_dependency()","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"1136f25c81037057db8c9fc50b16f2bd"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"43ffae0a7d81144cc71e12ffc4928f4a","identity":"private.withdraw_prepared_source_contract_current()","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"d87e8b56f73a19b5aab7960edd53e9aa"},{"acl":"{postgres=X/postgres}","owner":"postgres","procost":100,"prorows":0,"body_md5":"72ca365d2d9ae0870861cd3e102764b5","identity":"private.withdraw_reason_hooks_fingerprint()","proconfig":["search_path=\"\""],"prosecdef":false,"proisstrict":false,"proparallel":"u","provolatile":"s","proleakproof":false,"definition_md5":"97aeeb3bed3c9b7faec9a1f2bd09ce29"}]'::jsonb)loop
 select jsonb_build_object('identity',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'definition_md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'proconfig',to_jsonb(p.proconfig),'prosecdef',p.prosecdef,'provolatile',p.provolatile,'proparallel',p.proparallel,'procost',p.procost,'prorows',p.prorows,'proisstrict',p.proisstrict,'proleakproof',p.proleakproof)into actual from pg_proc p where p.oid=to_regprocedure(expected->>'identity');
 if actual is distinct from expected then raise exception using errcode='22023',message='nine_k_install_postflight_metadata_drift',detail=expected->>'identity';end if;end loop;

 select jsonb_build_object('common',(select jsonb_object_agg(s,private.prepared_aggregate_dependency_common(s))from unnest(array['IN','BR','VN','ID','PK','ZAR','MX','CO'])s),'withdraw',private.withdraw_prepared_dependency(),'sourceContract',private.withdraw_prepared_source_contract_current(),'reasonHooks',private.withdraw_reason_hooks_fingerprint(),'maanGeneration',private.maan_submission_generation())into tokens_after;
 if tokens_after is distinct from tokens_before then raise exception using errcode='22023',message='nine_k_unrelated_dependency_changed';end if;
end;$nine_k_install$;COMMIT;
