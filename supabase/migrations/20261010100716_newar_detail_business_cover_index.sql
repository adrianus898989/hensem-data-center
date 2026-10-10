-- Prerequisite: first execute supabase/operations/newar_detail_business_cover_index_concurrently.sql
-- as one standalone statement outside a transaction, then confirm ready+valid.
-- The operational file permits concurrent collector writes; do not replace it with ordinary CREATE INDEX.
-- Production completed that build before this registration migration was applied.
-- This migration only verifies its exact definition; it must never silently create/rebuild an index.
do $verify$
declare actual record;
begin
 select i.indrelid,i.indisvalid,i.indisready,i.indislive,i.indisunique,i.indnkeyatts,i.indnatts,
  i.indpred,i.indexprs,c.relkind,pg_get_indexdef(c.oid) definition
 into actual from pg_class c join pg_index i on i.indexrelid=c.oid
 where c.oid=to_regclass('public.newar_detail_business_cover_idx');
 if not found then raise exception 'newar_business_cover_index_missing';end if;
 if actual.indrelid<>'public.newar_detail_records'::regclass
  or not actual.indisvalid or not actual.indisready or not actual.indislive or actual.indisunique
  or actual.relkind<>'i' or actual.indnkeyatts<>3 or actual.indnatts<>10
  or actual.indpred is not null or actual.indexprs is not null
  or actual.definition is distinct from 'CREATE INDEX newar_detail_business_cover_idx ON public.newar_detail_records USING btree (platform, dataset, created_at) INCLUDE (status_group, amount, currency, provider, channel_type, captured_at, received_at)'
 then raise exception 'newar_business_cover_index_definition_or_validity_drift';end if;
end;
$verify$;
