-- Verified frontRemark rejection contract; no new raw text, schema or grants.
-- Main remark/interception states keep their meaning; legacy R12 safe payloads
-- remain valid. Only the observed business phrase is added to the allowlist.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $patch$
declare p record; before_metadata jsonb; after_metadata jsonb; definition text; old_fragment text; new_fragment text;
 wrapper_metadata jsonb; wrapper_body text;
begin
 select pg_catalog.to_jsonb(f)-'prosrc',pg_catalog.md5(f.prosrc) into wrapper_metadata,wrapper_body from pg_catalog.pg_proc f
  where f.oid=pg_catalog.to_regprocedure('private.wg_detail_validate_record(jsonb,text,text)');
 if wrapper_metadata is null or wrapper_body<>'29338f9cd2d5f54b91b4d712c95a09f4' then raise exception 'WG receiver wrapper baseline changed'; end if;
 select f.* into p from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.wg_business_note_allowed(text)');
 if not found then raise exception 'WG receiver helper missing: private.wg_business_note_allowed'; end if;
 if current_user<>'postgres' or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
  or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.provolatile<>'i' or p.prosecdef or p.proretset
  or p.proisstrict or p.proleakproof or p.proparallel<>'u'
  or p.prorettype<>'boolean'::regtype or p.proargtypes<>'25'::oidvector
  or p.pronargs<>1 or p.pronargdefaults<>0 or p.proargnames<>array['t']::text[]
  or p.proargmodes is not null or p.proallargtypes is not null or p.proargdefaults is not null
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.procost<>100 or p.prorows<>0 or p.provariadic<>0 or p.prosupport<>0
  or p.probin is not null or p.prosqlbody is not null or p.protrftypes is not null
  or p.proacl::text[] is distinct from array['postgres=X/postgres']::text[]
 then raise exception 'WG receiver helper metadata changed: private.wg_business_note_allowed'; end if;
 before_metadata:=pg_catalog.to_jsonb(p)-'prosrc';
 if pg_catalog.md5(p.prosrc)<>'8de0f6016c65daa067ca4cd7d2ffb187' then
  if pg_catalog.md5(p.prosrc)<>'5d6c53850c8fd3ecbf2df990bf06ec58' then raise exception 'WG receiver helper body changed: private.wg_business_note_allowed'; end if;
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  old_fragment:=$old0_0$'banco em manutenção'])$old0_0$;
  new_fragment:=$new0_0$'banco em manutenção','olá, solicite a retirada novamente, obrigado'])$new0_0$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG receiver helper anchor 0_0 changed'; end if;
  definition:=replace(definition,old_fragment,new_fragment);
  execute definition;
 end if;
 select pg_catalog.to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 if after_metadata is distinct from before_metadata or (select pg_catalog.md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=p.oid)<>'8de0f6016c65daa067ca4cd7d2ffb187'
 then raise exception 'WG receiver helper OID, ACL, metadata or expected body drift: private.wg_business_note_allowed'; end if;
 select f.* into p from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.wg_business_fields_validate(jsonb)');
 if not found then raise exception 'WG receiver helper missing: private.wg_business_fields_validate'; end if;
 if current_user<>'postgres' or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
  or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.provolatile<>'v' or p.prosecdef or p.proretset
  or p.proisstrict or p.proleakproof or p.proparallel<>'u'
  or p.prorettype<>'void'::regtype or p.proargtypes<>'3802'::oidvector
  or p.pronargs<>1 or p.pronargdefaults<>0 or p.proargnames<>array['v']::text[]
  or p.proargmodes is not null or p.proallargtypes is not null or p.proargdefaults is not null
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.procost<>100 or p.prorows<>0 or p.provariadic<>0 or p.prosupport<>0
  or p.probin is not null or p.prosqlbody is not null or p.protrftypes is not null
  or p.proacl::text[] is distinct from array['postgres=X/postgres']::text[]
 then raise exception 'WG receiver helper metadata changed: private.wg_business_fields_validate'; end if;
 before_metadata:=pg_catalog.to_jsonb(p)-'prosrc';
 if pg_catalog.md5(p.prosrc)<>'d273cf8201f2e2f682f873ada59bf444' then
  if pg_catalog.md5(p.prosrc)<>'8ab4c6027421cb33e3881e7a83f35933' then raise exception 'WG receiver helper body changed: private.wg_business_fields_validate'; end if;
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  old_fragment:=$old1_0$declare k text; t text; a text[]:=array$old1_0$;
  new_fragment:=$new1_0$declare k text; t text; front_rejection boolean:=false; a text[]:=array$new1_0$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG receiver helper anchor 1_0 changed'; end if;
  definition:=replace(definition,old_fragment,new_fragment);
  old_fragment:=$old1_1$  if v->>'note_state'='empty' and (v->>'remark_sanitized' is not null or v->>'rejection_reason' is not null or v->>'interception_reason' is not null or jsonb_array_length(v->'interception_codes')<>0)$old1_1$;
  new_fragment:=$new1_1$  -- R13 frontRemark is independently sanitized; keep the main remark state.
  -- Prefix interception templates never describe a final rejection, including
  -- otherwise-safe uploads using the legacy main-remark path.
  if exists(select 1 from unnest(array['Reasons for not automatically withdrawing funds:','未自动出款原因:','未自动出款原因：']) prefix
    where left(v->>'rejection_reason',length(prefix))=prefix) then raise exception 'WG_INVALID_BUSINESS_FIELDS'; end if;
  front_rejection:=coalesce(v->>'front_note_state'='template' and v->>'front_note_sanitized' is not null
    and v->>'rejection_reason'=v->>'front_note_sanitized',false);
  if v->>'note_state'='empty' and (v->>'remark_sanitized' is not null or ((v->>'rejection_reason') is not null and not front_rejection) or v->>'interception_reason' is not null or jsonb_array_length(v->'interception_codes')<>0)$new1_1$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG receiver helper anchor 1_1 changed'; end if;
  definition:=replace(definition,old_fragment,new_fragment);
  old_fragment:=$old1_2$      if v->>k is not null and v->>k not in ('业务备注包含未识别或敏感自由文本，原文已隐藏，待核实','未识别拦截原因，原文已隐藏，待核实')$old1_2$;
  new_fragment:=$new1_2$      if v->>k is not null and v->>k not in ('业务备注包含未识别或敏感自由文本，原文已隐藏，待核实','未识别拦截原因，原文已隐藏，待核实') and not (k='rejection_reason' and front_rejection)$new1_2$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG receiver helper anchor 1_2 changed'; end if;
  definition:=replace(definition,old_fragment,new_fragment);
  execute definition;
 end if;
 select pg_catalog.to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 if after_metadata is distinct from before_metadata or (select pg_catalog.md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=p.oid)<>'d273cf8201f2e2f682f873ada59bf444'
 then raise exception 'WG receiver helper OID, ACL, metadata or expected body drift: private.wg_business_fields_validate'; end if;
 if (select pg_catalog.to_jsonb(f)-'prosrc' from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.wg_detail_validate_record(jsonb,text,text)')) is distinct from wrapper_metadata
  or (select pg_catalog.md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.wg_detail_validate_record(jsonb,text,text)'))<>wrapper_body
 then raise exception 'WG receiver wrapper metadata/body drift'; end if;
end;
$patch$;
notify pgrst,'reload schema';
commit;
