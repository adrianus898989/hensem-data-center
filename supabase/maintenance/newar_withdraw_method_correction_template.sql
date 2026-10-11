-- Parameterized maintenance body, intentionally contains no real order identifiers.
-- Caller starts a transaction and creates pg_temp.newar_method_correction_targets:
-- record_id uuid, platform text, dataset text, source_id text,
-- expected_source_hash text, expected_old_method text, evidence_ref text.
-- The approved operation is precisely three source-UI-confirmed automatic orders.
set local lock_timeout='2s';
set local statement_timeout='3s';
do $precondition$
begin
 if (select count(*) from pg_temp.newar_method_correction_targets)<>3
  or (select count(distinct record_id) from pg_temp.newar_method_correction_targets)<>3
  or exists(select 1 from pg_temp.newar_method_correction_targets where platform<>'DhaniWin' or dataset<>'withdraw'
   or expected_old_method<>'manual' or expected_source_hash !~ '^[a-f0-9]{32}$')
 then raise exception 'newar_three_order_verification_scope_invalid';end if;
 if (select md5(prosrc) from pg_proc where oid='private.newar_withdraw_fact(public.newar_detail_records)'::regprocedure)<>'244fe0b21d3b785a40c6409807b358bc'
  or (select md5(prosrc) from pg_proc where oid='private.sync_newar_withdraw_fact()'::regprocedure)<>'cf7cbf7a51114d4cb72e8b2166ae10ab'
  or (select md5(prosrc) from pg_proc where oid='private.sync_newar_withdraw_method_verification()'::regprocedure)<>'9d8563b59e60e6c5bed029953bdc566b'
 then raise exception 'newar_three_order_verification_prerequisite_drift';end if;
end;$precondition$;
create temp table newar_method_correction_before on commit drop as
select t.record_id,to_jsonb(n) source_row,to_jsonb(f) fact_row
from pg_temp.newar_method_correction_targets t
join public.newar_detail_records n on n.id=t.record_id and n.platform=t.platform and n.dataset=t.dataset and n.source_id=t.source_id
join private.newar_withdraw_facts f on f.record_id=n.id and f.platform=n.platform and f.source_id=n.source_id
where false;
do $lock_and_verify$
declare t record;n public.newar_detail_records%rowtype;f private.newar_withdraw_facts%rowtype;v private.newar_withdraw_method_verifications%rowtype;
begin
 for t in select * from pg_temp.newar_method_correction_targets order by record_id loop
  select s.* into n from public.newar_detail_records s where s.id=t.record_id and s.platform=t.platform and s.dataset=t.dataset and s.source_id=t.source_id for share of s;
  if not FOUND then raise exception 'newar_three_order_verification_identity_drift';end if;
  select x.* into f from private.newar_withdraw_facts x where x.record_id=n.id and x.platform=n.platform and x.source_id=n.source_id;
  if not FOUND then raise exception 'newar_three_order_verification_fact_missing';end if;
  select x.* into v from private.newar_withdraw_method_verifications x where x.record_id=n.id;
  if FOUND then
   if v.platform<>t.platform or v.dataset<>t.dataset or v.source_id<>t.source_id or v.confirmed_method<>'auto'
    or v.evidence_kind<>'user_confirmed_source_ui' or v.evidence_ref<>t.evidence_ref or f.method<>'auto'
   then raise exception 'newar_three_order_verification_conflict';end if;
  elsif md5(to_jsonb(n)::text)<>t.expected_source_hash or f.method is distinct from t.expected_old_method then
   raise exception 'newar_three_order_verification_stale_source';
  end if;
  insert into pg_temp.newar_method_correction_before values(n.id,to_jsonb(n),to_jsonb(f));
 end loop;
end;$lock_and_verify$;
insert into private.newar_withdraw_method_verifications(record_id,platform,dataset,source_id,confirmed_method,evidence_kind,evidence_ref)
select t.record_id,t.platform,t.dataset,t.source_id,'auto','user_confirmed_source_ui',t.evidence_ref
from pg_temp.newar_method_correction_targets t
where not exists(select 1 from private.newar_withdraw_method_verifications v where v.record_id=t.record_id);
do $verify_result$
begin
 if (select count(*) from pg_temp.newar_method_correction_before)<>3 or exists(
  select 1 from pg_temp.newar_method_correction_before b
  left join public.newar_detail_records n on n.id=b.record_id
  left join private.newar_withdraw_facts f on f.record_id=b.record_id
  where n.id is null or f.record_id is null or f.method is distinct from 'auto'
   or to_jsonb(n) is distinct from b.source_row
   or (to_jsonb(f)-'method'-'submitted_at'-'handled_at') is distinct from (b.fact_row-'method'-'submitted_at'-'handled_at'))
 then raise exception 'newar_three_order_verification_result_mismatch';end if;
end;$verify_result$;
select 3 as verified_automatic_orders,true as source_records_unchanged,true as actor_identity_preserved;
