-- Add exactly two generic frontRemark templates independently verified in the source UI.
-- No raw order data, schema, receiver contract, auth or grant changes.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $patch$
declare p record; before_metadata jsonb; after_metadata jsonb; definition text; old_fragment text; new_fragment text;
 wrapper_metadata jsonb; wrapper_body text; fields_metadata jsonb;
begin
 select pg_catalog.to_jsonb(f)-'prosrc',pg_catalog.md5(f.prosrc) into wrapper_metadata,wrapper_body from pg_catalog.pg_proc f
  where f.oid=pg_catalog.to_regprocedure('private.wg_detail_validate_record(jsonb,text,text)');
 if wrapper_metadata is null or wrapper_body<>'29338f9cd2d5f54b91b4d712c95a09f4' then raise exception 'WG receiver wrapper baseline changed'; end if;
 select pg_catalog.to_jsonb(f) into fields_metadata from pg_catalog.pg_proc f
  where f.oid=pg_catalog.to_regprocedure('private.wg_business_fields_validate(jsonb)');
 if fields_metadata is null or pg_catalog.md5(fields_metadata->>'prosrc')<>'d273cf8201f2e2f682f873ada59bf444'
 then raise exception 'WG receiver fields baseline changed'; end if;
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
 if pg_catalog.md5(p.prosrc)<>'64401bc636de92acf1b132c418d31e96' then
  if pg_catalog.md5(p.prosrc)<>'8de0f6016c65daa067ca4cd7d2ffb187' then raise exception 'WG receiver helper body changed: private.wg_business_note_allowed'; end if;
  definition:=pg_catalog.pg_get_functiondef(p.oid);
  old_fragment:=$old0_0$'olá, solicite a retirada novamente, obrigado'])$old0_0$;
  new_fragment:=$new0_0$'olá, solicite a retirada novamente, obrigado','olá, como os dados do seu pix estão errados, entre em contato com o atendimento online para verificar a alteração, obrigado','olá, a falha foi causada por uma falha do sistema, por favor, solicite a retirada novamente, obrigado'])$new0_0$;
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'WG receiver helper anchor 0_0 changed'; end if;
  definition:=replace(definition,old_fragment,new_fragment);
  execute definition;
 end if;
 select pg_catalog.to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 if after_metadata is distinct from before_metadata or (select pg_catalog.md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=p.oid)<>'64401bc636de92acf1b132c418d31e96'
 then raise exception 'WG receiver helper OID, ACL, metadata or expected body drift: private.wg_business_note_allowed'; end if;
 if (select pg_catalog.to_jsonb(f)-'prosrc' from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.wg_detail_validate_record(jsonb,text,text)')) is distinct from wrapper_metadata
  or (select pg_catalog.md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.wg_detail_validate_record(jsonb,text,text)'))<>wrapper_body
 then raise exception 'WG receiver wrapper metadata/body drift'; end if;
 if (select pg_catalog.to_jsonb(f) from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.wg_business_fields_validate(jsonb)')) is distinct from fields_metadata
 then raise exception 'WG receiver fields metadata/body drift'; end if;
end;
$patch$;
notify pgrst,'reload schema';
commit;
