-- Verified frontRemark evidence is private and bound to the exact current source record.
-- This migration contains no source orders or personal values and never rewrites collector rows.
-- Apply after wg_front_rejection_receiver_contract; only postgres can record UI-verified evidence.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $overlay$
declare p record; before_metadata jsonb; after_metadata jsonb; definition text; expected_body text;
 old_fragment text; new_fragment text; grantee_name text;
begin
 if current_user<>'postgres' then raise exception 'WG verified note requires postgres migration owner';end if;
 select f.* into p from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.dashboard_admin_wg_withdraw_reasons(jsonb,jsonb)');
 if not found then raise exception 'WG verified note reader baseline missing';end if;
 if pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
  or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.provolatile<>'s' or not p.prosecdef or p.proretset
  or p.proisstrict or p.proleakproof or p.proparallel<>'u'
  or p.prorettype<>'jsonb'::regtype or p.proargtypes<>'3802 3802'::oidvector
  or p.pronargs<>2 or p.pronargdefaults<>0 or p.proargnames<>array['p_request','p_scope']::text[]
  or p.proargmodes is not null or p.proallargtypes is not null or p.proargdefaults is not null
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.procost<>100 or p.prorows<>0 or p.provariadic<>0 or p.prosupport<>0
  or p.probin is not null or p.prosqlbody is not null or p.protrftypes is not null
  or p.proacl::text[] is distinct from array['postgres=X/postgres']::text[]
 then raise exception 'WG verified note reader metadata drift';end if;
 if pg_catalog.md5(p.prosrc)<>'459a967f2adb697d194e6fa2157f8096'
 then raise exception 'WG verified note reader body drift';end if;
 if (select pg_catalog.md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=pg_catalog.to_regprocedure('private.wg_business_note_allowed(text)')) is distinct from '8de0f6016c65daa067ca4cd7d2ffb187'
  or not coalesce(private.wg_business_note_allowed('Olá, solicite a retirada novamente, obrigado'),false)
  or coalesce(private.wg_business_note_allowed('Synthetic unapproved free text'),false)
 then raise exception 'WG verified note safe-template dependency missing';end if;
 if pg_catalog.to_regclass('private.wg_verified_front_rejection_notes') is not null
 then raise exception 'WG verified note relation already exists; inspect before replaying migration';end if;
 before_metadata:=pg_catalog.to_jsonb(p)-'prosrc';expected_body:=p.prosrc;
 definition:=pg_catalog.pg_get_functiondef(p.oid);
 create table private.wg_verified_front_rejection_notes(
  site_code text not null check(site_code in('278','8311','12588','3257','3605')),
  order_number text not null check(order_number ~ '^[A-Za-z0-9_.:/+\-]{1,128}$'),
  source_content_hash text not null check(source_content_hash ~ '^[a-f0-9]{32}$'),
  source_version_at timestamptz not null,
  source_status_code integer not null default 7 check(source_status_code=7),
  source_field text not null default 'frontRemark' check(source_field='frontRemark'),
  note_text text not null check(length(note_text) between 1 and 2000 and note_text ~ '[^[:space:]]'
   and note_text !~ '[[:cntrl:]]' and private.wg_business_note_allowed(note_text)
   and btrim(note_text) !~* '^(Reasons for not automatically withdrawing funds:|未自动出款原因[:：])'
   and position('业务备注包含未识别或敏感自由文本，原文已隐藏，待核实' in note_text)=0
   and position('未识别拦截原因，原文已隐藏，待核实' in note_text)=0),
  verification_method text not null default 'manual_source_ui' check(verification_method='manual_source_ui'),
  verified_at timestamptz not null,
  evidence_digest text not null check(evidence_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(site_code,order_number)
 );
 alter table private.wg_verified_front_rejection_notes owner to postgres;
 alter table private.wg_verified_front_rejection_notes enable row level security;
 revoke all on private.wg_verified_front_rejection_notes from public,anon,authenticated,service_role;
 -- Supabase may have inherited default grants beyond its standard API roles.
 for grantee_name in select distinct case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end
  from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  where c.oid='private.wg_verified_front_rejection_notes'::regclass and a.grantee<>c.relowner
 loop execute pg_catalog.format('revoke all on private.wg_verified_front_rejection_notes from %s',case when grantee_name='PUBLIC' then 'PUBLIC' else pg_catalog.quote_ident(grantee_name) end);end loop;
 old_fragment:=$old0$   case when d.status_code=7 then case when blocking then nullif(btrim(d.business_fields->>'rejection_reason'),'') else private.dashboard_admin_live_rejection_exact_note(d.business_fields->>'rejection_reason') end end as rejection_note,
   case when d.status_code=7 then d.business_fields->>'rejection_reason' end raw_rejection_note,
   d.business_fields as source_business_fields
  from public.wg_withdraw_details d where d.site_code=s.site_code$old0$;
 new_fragment:=$new0$   case when d.status_code=7 then case when blocking then nullif(btrim(d.business_fields->>'rejection_reason'),'') else coalesce(private.dashboard_admin_live_rejection_exact_note(d.business_fields->>'rejection_reason'),v.note_text) end end as rejection_note,
   case when d.status_code=7 then case when not blocking and v.note_text is not null and private.dashboard_admin_live_rejection_exact_note(d.business_fields->>'rejection_reason') is null then v.note_text else d.business_fields->>'rejection_reason' end end raw_rejection_note,
   d.business_fields as source_business_fields,
   case when v.note_text is not null and private.dashboard_admin_live_rejection_exact_note(d.business_fields->>'rejection_reason') is null
    then jsonb_build_object('sourceField',v.source_field,'verificationMethod',v.verification_method,'verifiedAt',v.verified_at) end verified_rejection_note
  from public.wg_withdraw_details d
  left join private.wg_verified_front_rejection_notes v on not blocking and d.status_code=7
   and v.site_code=d.site_code and v.order_number=d.order_number and v.source_status_code=d.status_code
   and v.source_content_hash=d.content_hash and v.source_version_at=d.version_at
   and private.wg_business_note_allowed(v.note_text)
  where d.site_code=s.site_code$new0$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 then raise exception 'WG verified note reader source anchor drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);expected_body:=replace(expected_body,old_fragment,new_fragment);
 old_fragment:=$old1$jsonb_build_object('rawRejectionReason',raw_rejection_note,'rejectionNoteState',rejection_note_state,'sourceNoteStates',source_note_states,'hiddenNoteSources',to_jsonb(hidden_note_sources))$old1$;
 new_fragment:=$new1$jsonb_build_object('rawRejectionReason',raw_rejection_note,'rejectionNoteState',rejection_note_state,'sourceNoteStates',source_note_states,'hiddenNoteSources',to_jsonb(hidden_note_sources),'verifiedRejectionNote',verified_rejection_note)$new1$;
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 then raise exception 'WG verified note reader DTO anchor drift';end if;
 definition:=replace(definition,old_fragment,new_fragment);expected_body:=replace(expected_body,old_fragment,new_fragment);
 execute definition;
 select pg_catalog.to_jsonb(f)-'prosrc' into after_metadata from pg_catalog.pg_proc f where f.oid=p.oid;
 if after_metadata is distinct from before_metadata
  or (select pg_catalog.md5(f.prosrc) from pg_catalog.pg_proc f where f.oid=p.oid)<>pg_catalog.md5(expected_body)
 then raise exception 'WG verified note reader OID, ACL, metadata or expected body drift';end if;
 if exists(select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
   where c.oid='private.wg_verified_front_rejection_notes'::regclass and a.grantee<>c.relowner)
  or exists(select 1 from pg_catalog.pg_policy where polrelid='private.wg_verified_front_rejection_notes'::regclass)
  or not exists(select 1 from pg_catalog.pg_class where oid='private.wg_verified_front_rejection_notes'::regclass
    and relowner=(select oid from pg_catalog.pg_roles where rolname='postgres') and relrowsecurity)
 then raise exception 'WG verified note private relation ACL or RLS drift';end if;
end;
$overlay$;
notify pgrst,'reload schema';
commit;
