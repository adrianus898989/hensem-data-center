-- Fixed-width candidate lookups for the two explicit NEW_AR original fields.
-- The reader must recheck complete normalized original text after candidate
-- retrieval. Hashes are never evidence of identity, so collisions cannot match.
-- No raw field length limit is introduced and non-string references stay out.
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
create index if not exists newar_workorder_deposit_identity_hash_v1_idx
 on public.newar_detail_records(platform,(md5(upper(nullif(btrim(raw->>'depositOrderNo'),'')))))
 where dataset='workorder' and workorder_type in ('存款未到账','存款未到账自动化') and jsonb_typeof(raw->'depositOrderNo')='string';
do $validate_deposit$
declare i record;
begin
 select p.*,pg_get_indexdef(p.indexrelid) definition into i from pg_index p where p.indexrelid=to_regclass('public.newar_workorder_deposit_identity_hash_v1_idx');
 if i.indexrelid is null or i.indrelid<>'public.newar_detail_records'::regclass or not i.indisvalid or not i.indisready or i.indisunique
  or i.indnkeyatts<>2 or i.indnatts<>2 or i.definition is distinct from $expected$CREATE INDEX newar_workorder_deposit_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'depositOrderNo'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'depositOrderNo'::text)) = 'string'::text))$expected$
 then raise exception 'NEWAR_WORKORDER_DEPOSIT_HASH_INDEX_DRIFT';end if;
end;$validate_deposit$;
create index if not exists newar_workorder_recharge_identity_hash_v1_idx
 on public.newar_detail_records(platform,(md5(upper(nullif(btrim(raw->>'rechargeNumber'),'')))))
 where dataset='workorder' and workorder_type in ('存款未到账','存款未到账自动化') and jsonb_typeof(raw->'rechargeNumber')='string';
do $validate_recharge$
declare i record;
begin
 select p.*,pg_get_indexdef(p.indexrelid) definition into i from pg_index p where p.indexrelid=to_regclass('public.newar_workorder_recharge_identity_hash_v1_idx');
 if i.indexrelid is null or i.indrelid<>'public.newar_detail_records'::regclass or not i.indisvalid or not i.indisready or i.indisunique
  or i.indnkeyatts<>2 or i.indnatts<>2 or i.definition is distinct from $expected$CREATE INDEX newar_workorder_recharge_identity_hash_v1_idx ON public.newar_detail_records USING btree (platform, md5(upper(NULLIF(btrim((raw ->> 'rechargeNumber'::text)), ''::text)))) WHERE ((dataset = 'workorder'::text) AND (workorder_type = ANY (ARRAY['存款未到账'::text, '存款未到账自动化'::text])) AND (jsonb_typeof((raw -> 'rechargeNumber'::text)) = 'string'::text))$expected$
 then raise exception 'NEWAR_WORKORDER_RECHARGE_HASH_INDEX_DRIFT';end if;
end;$validate_recharge$;
commit;
