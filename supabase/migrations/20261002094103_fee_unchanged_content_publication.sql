-- Skip redundant projection writes only after complete source validation and
-- exact fingerprints of both the current projections and retained evidence.
-- Every observation still receives a real immutable receipt/generation ID.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table private.fee_rate_head add column semantic_hash text,
 add column projection_hash text,add column evidence_hash text;
create function private.fee_rate_snapshot_hashes(p_source_key text) returns jsonb
 language sql stable security definer set search_path='' as $snapshot$
 select jsonb_build_object('projection',encode(sha256(convert_to(jsonb_build_array(
  coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.third_party_rates r),'[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.third_party_platform_status s),'[]'::jsonb))::text,'UTF8')),'hex'),
 'evidence',encode(sha256(convert_to(coalesce((select jsonb_agg(to_jsonb(e) order by e.source_id,e.direction)
  from private.fee_rate_current_evidence e join private.fee_rate_generations g on g.id=e.generation_id
  where g.source_key=p_source_key),'[]'::jsonb)::text,'UTF8')),'hex'));
$snapshot$;
revoke all on function private.fee_rate_snapshot_hashes(text) from public,anon,authenticated,service_role;
do $fee_unchanged_publication$
declare target regprocedure:='public.fee_rate_publish_generation(uuid,text,timestamptz,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 p pg_proc%rowtype;metadata jsonb;
begin
 select * into p from pg_proc where oid=target;
 if md5(p.prosrc)<>'5e7f94ebc83434433ee589fce7ae3df4' then raise exception 'fee_unchanged_baseline_drift';end if;
 if p.proowner<>'postgres'::regrole or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
 or not p.prosecdef or p.provolatile<>'v' or p.proconfig is distinct from array['search_path=""']
 then raise exception 'fee_unchanged_metadata_drift';end if;
 metadata:=to_jsonb(p)-'prosrc';
 execute $candidate$create or replace function public.fee_rate_publish_generation(p_generation_id uuid,p_source_key text,p_observed_at timestamptz,
 p_rates jsonb,p_platform_statuses jsonb,p_evidence jsonb,p_manifest jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $function$
declare
 hash text;old private.fee_rate_generations%rowtype;r jsonb;e jsonb;d text;fee text;single_fee text;
 key text;country text;currency text;effective timestamptz;state text;percent numeric;fixed numeric;semantic jsonb;proof jsonb;
 prior private.fee_rate_versions%rowtype;v_id uuid;latest timestamptz;inserted integer:=0;known integer:=0;unknown integer:=0;
 evidence_rows jsonb:='[]';receipt jsonb;v_now timestamptz:=statement_timestamp();
 content_hash text;current_hashes jsonb;head private.fee_rate_head%rowtype;previous private.fee_rate_generations%rowtype;
begin
 if p_generation_id is null or length(coalesce(p_source_key,'')) not between 1 and 200
 or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at>v_now+interval '5 minutes'
 or jsonb_typeof(p_rates) is distinct from 'array' or jsonb_array_length(p_rates) not between 1 and 10000
 or jsonb_typeof(p_platform_statuses) is distinct from 'array' or jsonb_array_length(p_platform_statuses) not between 1 and 100000
 or jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence)<>jsonb_array_length(p_rates)
 or jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest->'complete' is distinct from 'true'::jsonb
 or jsonb_typeof(p_manifest->'sheets') is distinct from 'array' or jsonb_array_length(p_manifest->'sheets')=0
 then raise exception 'invalid_fee_generation';end if;
 if exists(select 1 from jsonb_array_elements(p_rates) x group by x->>'id' having count(*)<>1)
 or exists(select 1 from jsonb_array_elements(p_platform_statuses) x group by x->>'id' having count(*)<>1)
 or exists(select 1 from jsonb_array_elements(p_evidence) x group by x->>'id' having count(*)<>1)
 or exists(select 1 from jsonb_array_elements(p_rates) x where nullif(x->>'id','') is null or nullif(x->>'third_party','') is null
   or not (p_manifest->'sheets' ? (x->>'sheet_name')) or not exists(select 1 from jsonb_array_elements(p_evidence) y where y->>'id'=x->>'id'))
 then raise exception 'incomplete_fee_generation';end if;
 hash:=encode(sha256(convert_to(jsonb_build_array(p_source_key,p_observed_at,p_rates,p_platform_statuses,p_evidence,p_manifest)::text,'UTF8')),'hex');
 -- Both projections are one shared source: serialize globally and reject stale captures.
 perform pg_advisory_xact_lock(735273521);
 select * into old from private.fee_rate_generations where id=p_generation_id;
 if found then if old.payload_hash<>hash then raise exception 'fee_generation_replay_conflict';end if;return old.receipt;end if;
 if exists(select 1 from private.fee_rate_head where source_key<>p_source_key) then raise exception 'fee_source_identity_changed';end if;
 if exists(select 1 from private.fee_rate_head where observed_at>=p_observed_at) then raise exception 'stale_fee_generation';end if;
 -- Source observation timestamps are not semantic edits. Preserve every other
 -- supplied rate/status/effective-evidence field, including provenance/layout.
 content_hash:=encode(sha256(convert_to(jsonb_build_array(p_source_key,
   (select jsonb_agg(x-array['created_at','updated_at'] order by x->>'id') from jsonb_array_elements(p_rates) x),
   (select jsonb_agg(x-array['created_at','updated_at'] order by x->>'id') from jsonb_array_elements(p_platform_statuses) x),
   (select jsonb_agg(x-array['observedAt','observed_at','created_at','updated_at'] order by x->>'id') from jsonb_array_elements(p_evidence) x),
   p_manifest-array['observedAt','observed_at','created_at','updated_at'])::text,'UTF8')),'hex');
 select * into head from private.fee_rate_head where source_key=p_source_key;
 if found and head.semantic_hash=content_hash then
   -- Fingerprints include every stored value and timestamp. Out-of-band writes,
   -- missing/extra rows or changed evidence always force normal publication.
   current_hashes:=private.fee_rate_snapshot_hashes(p_source_key);
   if head.projection_hash=current_hashes->>'projection' and head.evidence_hash=current_hashes->>'evidence' then
     select * into previous from private.fee_rate_generations where id=head.generation_id and source_key=p_source_key;
     if found and previous.receipt->'ok'='true'::jsonb then
       receipt:=jsonb_set(previous.receipt||jsonb_build_object('generationId',p_generation_id,'unchanged',true),'{feeVersions,inserted}','0'::jsonb);
       insert into private.fee_rate_generations values(p_generation_id,p_source_key,p_observed_at,v_now,hash,receipt);
       update private.fee_rate_head set generation_id=p_generation_id,observed_at=p_observed_at where source_key=p_source_key;
       insert into public.sync_status(module,last_sync_at,status,message,updated_at)
       values('third_party_rates',v_now,'success','完整费率检查；内容未变',v_now)
       on conflict(module) do update set last_sync_at=excluded.last_sync_at,status=excluded.status,message=excluded.message,updated_at=excluded.updated_at;
       return receipt;
     end if;
   end if;
 end if;

 -- Insert the generation only after validation; the final receipt is immutable.
 -- Its versions reference this deferred FK so a receipt never needs updating.

 for r in select value from jsonb_array_elements(p_rates) loop
   select value into e from jsonb_array_elements(p_evidence) where value->>'id'=r->>'id';
   foreach d in array array['charge','withdraw'] loop
     fee:=btrim(coalesce(r->>case when d='charge' then 'collect_fee' else 'payout_fee' end,''));
     single_fee:=btrim(coalesce(r->>case when d='charge' then 'collect_single_fee' else 'payout_single_fee' end,''));
     country:=private.dashboard_data_group(r->>'country','');currency:=nullif(e->>'currency','');
     effective:=null;state:=coalesce(e->>(d||'State'),e->>'state','missing_effective_time');percent:=null;fixed:=null;v_id:=null;
     if state='ready' and coalesce(e->>'effectiveFrom','')~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.][0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$' then
       begin effective:=(e->>'effectiveFrom')::timestamptz;
       exception when invalid_datetime_format or datetime_field_overflow then state:='invalid_effective_time';end;
     elsif state='ready' then state:='invalid_effective_time';end if;
     if effective is not null and (not isfinite(effective) or extract(year from effective) not between 2000 and 2200) then effective:=null;state:='invalid_effective_time';end if;
     if country is null or country='' or e->>'sheetId' is null then state:='unknown_source_identity';end if;
     if currency is not null and currency!~'^[A-Z]{3,6}$' then state:='unknown_currency';end if;
     key:=encode(sha256(convert_to(jsonb_build_array(p_source_key,e->>'sheetId',country,r->>'third_party',coalesce(r->>'category',''),d)::text,'UTF8')),'hex');
     if fee~'^\d+([.]\d+)?\s*%$' then percent:=replace(fee,'%','')::numeric/100;
     elsif fee~'^\d+([.]\d+)?\s*/\s*笔$' then percent:=0;fixed:=regexp_replace(fee,'\s*/\s*笔$','')::numeric;end if;
     if single_fee in ('','没有','无','0','0%') then fixed:=coalesce(fixed,0);
     elsif single_fee~'^\d+([.]\d+)?(\s*/\s*笔)?$' and fixed is null then fixed:=regexp_replace(single_fee,'\s*/\s*笔$','')::numeric;
     else fixed:=null;end if;
     if percent is null or fixed is null or percent>1 or fixed>1000000000 then percent:=null;fixed:=null;end if;
     semantic:=jsonb_build_object('percent',percent,'fixed',fixed,'currency',currency,
       'unsupportedFee',case when percent is null then fee end,'unsupportedSingle',case when percent is null then single_fee end);
     proof:=jsonb_build_object('sheetName',r->>'sheet_name','sheetId',e->'sheetId','sourceRow',r->'source_row',
       'effectiveCell',e->'effectiveCell','currencyCell',e->'currencyCell','observedAt',p_observed_at,'basis','explicit_source_effective_time');
     -- Two different source rows claiming the same semantic identity cannot
     -- become first-row-wins, even inside a single complete publication.
     if state='ready' and exists(select 1 from jsonb_array_elements(p_rates) other
       join jsonb_array_elements(p_evidence) oe on oe->>'id'=other->>'id'
       where other->>'id'<>r->>'id' and oe->>'sheetId'=e->>'sheetId'
       and private.dashboard_data_group(other->>'country','')=country
       and other->>'third_party'=r->>'third_party' and coalesce(other->>'category','')=coalesce(r->>'category','')
       and jsonb_build_array(oe->>'effectiveFrom',oe->>'currency',other->>case when d='charge' then 'collect_fee' else 'payout_fee' end,
         other->>case when d='charge' then 'collect_single_fee' else 'payout_single_fee' end)
         is distinct from jsonb_build_array(e->>'effectiveFrom',e->>'currency',r->>case when d='charge' then 'collect_fee' else 'payout_fee' end,
         r->>case when d='charge' then 'collect_single_fee' else 'payout_single_fee' end)) then state:='ambiguous_source_rule';end if;
     if state='ready' then
       select * into prior from private.fee_rate_versions where rule_key=key and effective_from=effective;
       if found then
         if prior.semantic_rule=semantic then v_id:=prior.id;else state:='same_effective_time_conflict';end if;
       else
         select max(effective_from) into latest from private.fee_rate_versions where rule_key=key;
         if latest>effective then state:='backdated_version_rejected';
         else
           insert into private.fee_rate_versions(rule_key,source_key,sheet_id,sheet_name,country,provider,category,direction,currency,
             effective_from,percent_rate,fixed_fee,pricing_state,semantic_rule,provenance,generation_id)
           values(key,p_source_key,(e->>'sheetId')::bigint,r->>'sheet_name',country,r->>'third_party',coalesce(r->>'category',''),d,currency,
             effective,percent,fixed,case when percent is null then 'unsupported_rule' when fixed>0 and currency is null then 'currency_unknown' else 'ready' end,semantic,proof,p_generation_id)
           returning id into v_id;inserted:=inserted+1;
         end if;
       end if;
     end if;
     if v_id is not null then known:=known+1;else unknown:=unknown+1;end if;
     evidence_rows:=evidence_rows||jsonb_build_array(jsonb_build_object('source_id',r->>'id','direction',d,'rule_key',key,'state',state,'version_id',v_id,'effective_from',effective,'provenance',proof,'generation_id',p_generation_id));
   end loop;
 end loop;
 receipt:=jsonb_build_object('ok',true,'generationId',p_generation_id,'unchanged',false,'rates',jsonb_array_length(p_rates),'platformStatuses',jsonb_array_length(p_platform_statuses),
 'feeVersions',jsonb_build_object('basis','order_created_at','inserted',inserted,'versionedRules',known,'unversionedRules',unknown,'state',case when unknown=0 then 'complete' when known=0 then 'unknown' else 'partial' end));
 insert into private.fee_rate_generations values(p_generation_id,p_source_key,p_observed_at,v_now,hash,receipt);
 delete from private.fee_rate_current_evidence c where exists (select 1 from private.fee_rate_generations g where g.id=c.generation_id and g.source_key=p_source_key);
 insert into private.fee_rate_current_evidence select * from jsonb_populate_recordset(null::private.fee_rate_current_evidence,evidence_rows);
 -- Both projections remain readable in their old shape; partial publication is impossible.
 insert into public.third_party_rates select (jsonb_populate_record(null::public.third_party_rates,x||jsonb_build_object('created_at',v_now,'updated_at',v_now))).* from jsonb_array_elements(p_rates) x
 on conflict(id) do update set sheet_name=excluded.sheet_name,country=excluded.country,category=excluded.category,third_party=excluded.third_party,collect_fee=excluded.collect_fee,payout_fee=excluded.payout_fee,total_fee=excluded.total_fee,collect_single_fee=excluded.collect_single_fee,payout_single_fee=excluded.payout_single_fee,collect_limit=excluded.collect_limit,payout_limit=excluded.payout_limit,channel_info=excluded.channel_info,leak=excluded.leak,whitelist=excluded.whitelist,status=excluded.status,source_row=excluded.source_row,updated_at=excluded.updated_at;
 delete from public.third_party_rates where id not in(select x->>'id' from jsonb_array_elements(p_rates) x);
 insert into public.third_party_platform_status select (jsonb_populate_record(null::public.third_party_platform_status,x||jsonb_build_object('created_at',v_now,'updated_at',v_now))).* from jsonb_array_elements(p_platform_statuses) x
 on conflict(id) do update set sheet_name=excluded.sheet_name,country=excluded.country,platform=excluded.platform,category=excluded.category,third_party=excluded.third_party,collect_fee=excluded.collect_fee,payout_fee=excluded.payout_fee,total_fee=excluded.total_fee,collect_single_fee=excluded.collect_single_fee,payout_single_fee=excluded.payout_single_fee,collect_limit=excluded.collect_limit,payout_limit=excluded.payout_limit,status=excluded.status,raw_status=excluded.raw_status,source_row=excluded.source_row,source_column=excluded.source_column,updated_at=excluded.updated_at;
 delete from public.third_party_platform_status where id not in(select x->>'id' from jsonb_array_elements(p_platform_statuses) x);
 current_hashes:=private.fee_rate_snapshot_hashes(p_source_key);
 insert into private.fee_rate_head(source_key,generation_id,observed_at,semantic_hash,projection_hash,evidence_hash)
 values(p_source_key,p_generation_id,p_observed_at,content_hash,current_hashes->>'projection',current_hashes->>'evidence')
 on conflict(source_key) do update set generation_id=excluded.generation_id,observed_at=excluded.observed_at,
 semantic_hash=excluded.semantic_hash,projection_hash=excluded.projection_hash,evidence_hash=excluded.evidence_hash;
 insert into public.sync_status(module,last_sync_at,status,message,updated_at) values('third_party_rates',v_now,'success','完整费率同步；历史版本：'||(receipt#>>'{feeVersions,state}'),v_now)
 on conflict(module) do update set last_sync_at=excluded.last_sync_at,status=excluded.status,message=excluded.message,updated_at=excluded.updated_at;
 return receipt;
end $function$;$candidate$;
 if (select to_jsonb(q)-'prosrc' from pg_proc q where q.oid=target) is distinct from metadata then raise exception 'fee_unchanged_metadata_changed';end if;
 if (select md5(prosrc) from pg_proc where oid=target)<>'1da790f7dc39d5f58d7444dc1fcff4bc' then raise exception 'fee_unchanged_candidate_hash';end if;
end $fee_unchanged_publication$;
commit;
