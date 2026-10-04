-- Owner confirmed the native INR unit of these existing M8/AR withdrawal captures.
-- Metadata is pinned to each immutable archive's complete original content.
-- Keep original money/counts/timestamps, late-window classification, source currency
-- precedence and every API/data permission unchanged. No future-capture inheritance.
begin;
set local lock_timeout='3s';set local statement_timeout='15s';set local timezone='UTC';
lock table private.withdraw_pending_capture_currency_confirmations in share row exclusive mode;
do $confirm$
declare target regclass:='private.withdraw_pending_capture_currency_confirmations'::regclass;
  constraint_hash text;column_hash text;matched_count integer;confirmed_count integer;
begin
 if not exists(select 1 from pg_class c where c.oid=target and c.relowner='postgres'::regrole
    and c.relrowsecurity and not c.relforcerowsecurity
    and c.relacl::text is not distinct from '{postgres=arwdDxtm/postgres}')
    or exists(select 1 from pg_policy where polrelid=target)
    or (select count(*) from pg_trigger where tgrelid=target and not tgisinternal)<>1
    or not exists(select 1 from pg_trigger where tgrelid=target and not tgisinternal
      and tgname='pending_currency_confirmation_immutable' and tgenabled='O' and tgtype=27
      and tgfoid='private.withdraw_pending_capture_immutable()'::regprocedure
      and tgqual is null and octet_length(tgargs)=0) then
  raise exception 'pending_oct3_confirmation_security_drift';end if;
 select md5(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)::text)
 into column_hash from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attrelid=target and a.attnum>0 and not a.attisdropped;
 if column_hash<>'8cfcb35e9c401687eda0952475032e88' then raise exception 'pending_oct3_confirmation_columns_drift';end if;
 select md5(jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),
   'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred) order by c.conname)::text)
 into constraint_hash from pg_constraint c where c.conrelid=target and c.contype<>'n';
 if constraint_hash not in ('2b637c97b4114c7f1d9eb23fbf94c7c3','c171210c319c4e5acaf8898e23294f10','70df0246a95d68d48b7e7c37b0217933') then
  raise exception 'pending_oct3_confirmation_constraints_drift';end if;
 if not exists(select 1 from pg_proc p where p.oid='private.dashboard_admin_pending_archive_currency(uuid)'::regprocedure
    and p.proowner='postgres'::regrole and not p.prosecdef and p.provolatile='s'
    and p.proacl::text is not distinct from '{postgres=X/postgres}'
    and p.proconfig is not distinct from array['search_path=""','TimeZone=UTC']
    and md5(p.prosrc)='b172110c063946678702debfe535f436'
    and md5(pg_get_functiondef(p.oid))='175f63ef0763829caba6d9ed9b1f22b9') then
  raise exception 'pending_oct3_confirmation_lookup_drift';end if;
 if constraint_hash='2b637c97b4114c7f1d9eb23fbf94c7c3' then
  alter table private.withdraw_pending_capture_currency_confirmations
    drop constraint withdraw_pending_capture_currency_confirmations_platform_check,
    drop constraint withdraw_pending_capture_currency_confirmations_stat_date_check,
    add constraint pending_currency_confirmed_scope check ((stat_date=date '2026-10-01' and platform in('51GAME','55CLUB','6CLUB','82LOTTERY','91CLUB','BIGMUMBAI','IN999','JAICLUB','JALWA','LOTTERY7','OKWIN','RAJA','TPPLAY'))
  or (stat_date=date '2026-10-03' and (archive_id,platform,platform_id,snapshot_at,archive_content_sha256) in (
    ('195efdcc-680b-47b6-89fc-68bab27128cc'::uuid,'51GAME','e7c4101c-bd8e-d51d-436a-6ffa61077937'::uuid,timestamptz '2026-10-03 19:04:40+00','5835bcea800ac0b35eaa4489e6f4ef638fbae16b73aa310403d4de0ae6bf633f'),
    ('3bd63a14-86a5-4bfa-8e44-2aa18dd40f36'::uuid,'55CLUB','5004c450-fef5-1ce9-d4b1-a61055cc0e2f'::uuid,timestamptz '2026-10-03 18:32:49+00','d240cc12e414e7d907af90a5616eb4e89c6712c6f260f38f951955552aacd7cf'),
    ('7ba3121f-30b2-44da-a732-8905c9eb5328'::uuid,'6CLUB','731dd8f6-db82-eef0-da03-99211387e514'::uuid,timestamptz '2026-10-03 19:15:37+00','032c59e347e12b223b9dfa68a2f8feb177d737eec5e0d14064a8c7dda742e95a'),
    ('c2d949fb-5940-4bf9-8e96-0af90078c43e'::uuid,'82LOTTERY','3aa6d428-6da6-fa9b-3a61-2b269ce2c8f0'::uuid,timestamptz '2026-10-03 18:48:04+00','b3bc74ab2a91e3f30d0165b2ff9296d902b3d87f82fd4ea42327aafe6140e80a'),
    ('a09dc71f-fbdb-49f3-8c3d-ce2cd57276a9'::uuid,'91CLUB','5e952cbb-e42f-d6b1-a24a-a0d42d165df9'::uuid,timestamptz '2026-10-03 18:31:01+00','5008d119cbcb20493ab952b0855aa8e0659e77149cfcbf2994d1d98311343b82'),
    ('7f0b54b5-be2f-4af1-a8e6-77131264c091'::uuid,'BIGMUMBAI','b40ec767-829c-db68-d774-a940150deb2a'::uuid,timestamptz '2026-10-03 18:42:26+00','7c838802f7041ae92ffdfaf81e1855f1fc319d9b92e341efb4b86499651681d6'),
    ('396ebd8c-e9b5-467d-8d5d-5619dd22a1ba'::uuid,'IN999','0c93b920-a24b-84f1-bba4-f4df868f6910'::uuid,timestamptz '2026-10-03 18:34:38+00','e096addcbb4e562e0b501b205a98fa0a1b7d507260cabb8395829704cd14203f'),
    ('e13909fe-72df-4212-b58a-441f33cd53e4'::uuid,'JAICLUB','5c4e9b73-6a94-053f-c42c-22a35e03f959'::uuid,timestamptz '2026-10-03 19:59:07+00','9f697b3f3f144e925cab5421ea7eb537c1b8fea5d5a7621bcc1c9d2c201d798d'),
    ('72eb3add-806a-4b25-9597-388dbe72378b'::uuid,'JALWA','72b27b17-4cdd-8d41-e39a-875ff42cd25a'::uuid,timestamptz '2026-10-03 18:38:34+00','180e3cab9a5d2f44be7328d708edf998775e77b8baa5025fea5450f6d1851b86'),
    ('1f3580fa-6c86-4c3a-b6e6-64b47732bb06'::uuid,'LOTTERY7','40433510-a19b-1810-6ec0-2b32be9e1f72'::uuid,timestamptz '2026-10-03 18:55:29+00','0959af377ef09d2b58ee06a8d42f2d320edb522c49f8b1048f427e716f4e44ae'),
    ('dea49b89-3bec-452d-84bb-c27b12f03f53'::uuid,'OKWIN','43766f8a-87dd-8aab-e8c7-9d4853cdbca2'::uuid,timestamptz '2026-10-03 18:36:28+00','6d3649f590bda8472eb64c159d423e04a2860445f60e839411bca1835ee380e9'),
    ('7071a802-55c6-4425-bae1-7966be8e59c3'::uuid,'RAJA','f6de813a-d0da-804d-e1e1-d38e4cc287a8'::uuid,timestamptz '2026-10-03 19:42:51+00','801d903fbc2bec8a8782b622d671abe2e317196d8897b89ba33987978a6e993c'),
    ('ca79a894-5108-487f-85d1-a180fd9b98c3'::uuid,'Shree.Win','fef148af-9325-e1b7-5daf-73c0e796d8a4'::uuid,timestamptz '2026-10-03 20:17:10+00','a12bb4ccd540329218a77d5153b25fd9bd1aaa3ece4671effab6a3b4c97320f9'),
    ('24dacc82-91aa-415c-8230-59f084670a22'::uuid,'TPPLAY','57cd0f0e-c685-8be1-dc2b-52c9672e33df'::uuid,timestamptz '2026-10-03 19:28:20+00','6bf75433e779645291299e5947d99ed7e05068114c640a56103138e929ec824d'),
    ('11f0511d-7d93-47f3-bac5-179061684ae0'::uuid,'Veer.Game','dba5345b-e924-e014-5bda-f4abc8895925'::uuid,timestamptz '2026-10-03 20:37:02+00','369d078afafcc438f37e775c394ebc90702ed37a04f4f629871d2c067562a1e1')
  )));
 end if;
 with expected(archive_id,platform,platform_id,snapshot_at,content_hash) as(values
  ('195efdcc-680b-47b6-89fc-68bab27128cc'::uuid,'51GAME','e7c4101c-bd8e-d51d-436a-6ffa61077937'::uuid,timestamptz '2026-10-03 19:04:40+00','5835bcea800ac0b35eaa4489e6f4ef638fbae16b73aa310403d4de0ae6bf633f'),
  ('3bd63a14-86a5-4bfa-8e44-2aa18dd40f36'::uuid,'55CLUB','5004c450-fef5-1ce9-d4b1-a61055cc0e2f'::uuid,timestamptz '2026-10-03 18:32:49+00','d240cc12e414e7d907af90a5616eb4e89c6712c6f260f38f951955552aacd7cf'),
  ('7ba3121f-30b2-44da-a732-8905c9eb5328'::uuid,'6CLUB','731dd8f6-db82-eef0-da03-99211387e514'::uuid,timestamptz '2026-10-03 19:15:37+00','032c59e347e12b223b9dfa68a2f8feb177d737eec5e0d14064a8c7dda742e95a'),
  ('c2d949fb-5940-4bf9-8e96-0af90078c43e'::uuid,'82LOTTERY','3aa6d428-6da6-fa9b-3a61-2b269ce2c8f0'::uuid,timestamptz '2026-10-03 18:48:04+00','b3bc74ab2a91e3f30d0165b2ff9296d902b3d87f82fd4ea42327aafe6140e80a'),
  ('a09dc71f-fbdb-49f3-8c3d-ce2cd57276a9'::uuid,'91CLUB','5e952cbb-e42f-d6b1-a24a-a0d42d165df9'::uuid,timestamptz '2026-10-03 18:31:01+00','5008d119cbcb20493ab952b0855aa8e0659e77149cfcbf2994d1d98311343b82'),
  ('7f0b54b5-be2f-4af1-a8e6-77131264c091'::uuid,'BIGMUMBAI','b40ec767-829c-db68-d774-a940150deb2a'::uuid,timestamptz '2026-10-03 18:42:26+00','7c838802f7041ae92ffdfaf81e1855f1fc319d9b92e341efb4b86499651681d6'),
  ('396ebd8c-e9b5-467d-8d5d-5619dd22a1ba'::uuid,'IN999','0c93b920-a24b-84f1-bba4-f4df868f6910'::uuid,timestamptz '2026-10-03 18:34:38+00','e096addcbb4e562e0b501b205a98fa0a1b7d507260cabb8395829704cd14203f'),
  ('e13909fe-72df-4212-b58a-441f33cd53e4'::uuid,'JAICLUB','5c4e9b73-6a94-053f-c42c-22a35e03f959'::uuid,timestamptz '2026-10-03 19:59:07+00','9f697b3f3f144e925cab5421ea7eb537c1b8fea5d5a7621bcc1c9d2c201d798d'),
  ('72eb3add-806a-4b25-9597-388dbe72378b'::uuid,'JALWA','72b27b17-4cdd-8d41-e39a-875ff42cd25a'::uuid,timestamptz '2026-10-03 18:38:34+00','180e3cab9a5d2f44be7328d708edf998775e77b8baa5025fea5450f6d1851b86'),
  ('1f3580fa-6c86-4c3a-b6e6-64b47732bb06'::uuid,'LOTTERY7','40433510-a19b-1810-6ec0-2b32be9e1f72'::uuid,timestamptz '2026-10-03 18:55:29+00','0959af377ef09d2b58ee06a8d42f2d320edb522c49f8b1048f427e716f4e44ae'),
  ('dea49b89-3bec-452d-84bb-c27b12f03f53'::uuid,'OKWIN','43766f8a-87dd-8aab-e8c7-9d4853cdbca2'::uuid,timestamptz '2026-10-03 18:36:28+00','6d3649f590bda8472eb64c159d423e04a2860445f60e839411bca1835ee380e9'),
  ('7071a802-55c6-4425-bae1-7966be8e59c3'::uuid,'RAJA','f6de813a-d0da-804d-e1e1-d38e4cc287a8'::uuid,timestamptz '2026-10-03 19:42:51+00','801d903fbc2bec8a8782b622d671abe2e317196d8897b89ba33987978a6e993c'),
  ('ca79a894-5108-487f-85d1-a180fd9b98c3'::uuid,'Shree.Win','fef148af-9325-e1b7-5daf-73c0e796d8a4'::uuid,timestamptz '2026-10-03 20:17:10+00','a12bb4ccd540329218a77d5153b25fd9bd1aaa3ece4671effab6a3b4c97320f9'),
  ('24dacc82-91aa-415c-8230-59f084670a22'::uuid,'TPPLAY','57cd0f0e-c685-8be1-dc2b-52c9672e33df'::uuid,timestamptz '2026-10-03 19:28:20+00','6bf75433e779645291299e5947d99ed7e05068114c640a56103138e929ec824d'),
  ('11f0511d-7d93-47f3-bac5-179061684ae0'::uuid,'Veer.Game','dba5345b-e924-e014-5bda-f4abc8895925'::uuid,timestamptz '2026-10-03 20:37:02+00','369d078afafcc438f37e775c394ebc90702ed37a04f4f629871d2c067562a1e1')
 ), matched as materialized (
  select a.* from expected e join private.withdraw_pending_capture_archive a
    on a.id=e.archive_id and a.platform=e.platform and a.platform_id=e.platform_id and a.snapshot_at=e.snapshot_at
    and encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')=e.content_hash
  where a.source_system='WITHDRAW_REVIEW' and a.country_code='IN' and a.stat_date=date '2026-10-03'
    and a.identity_status='resolved' and a.native_source_system='AR' and a.team_name='M8'
    and a.currency is null and a.timezone='Asia/Kolkata'
 ), inserted as (
  insert into private.withdraw_pending_capture_currency_confirmations
   (archive_id,source_system,country_code,platform,stat_date,snapshot_at,window_start,window_end,snapshot_id,
    platform_id,native_source_system,team_name,timezone,archive_content_sha256,currency,confirmation_basis)
  select id,source_system,country_code,platform,stat_date,snapshot_at,window_start,window_end,snapshot_id,
    platform_id,native_source_system,team_name,timezone,encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex'),'INR','owner_confirmation'
  from matched m on conflict(archive_id) do nothing returning archive_id
 ) select count(*) into matched_count from matched;
 if matched_count<>15 then raise exception 'pending_oct3_confirmation_manifest_drift';end if;
 -- Existing evidence must match exactly on replay; never overwrite immutable confirmations.
 with expected(archive_id,platform,platform_id,snapshot_at,content_hash) as(values
  ('195efdcc-680b-47b6-89fc-68bab27128cc'::uuid,'51GAME','e7c4101c-bd8e-d51d-436a-6ffa61077937'::uuid,timestamptz '2026-10-03 19:04:40+00','5835bcea800ac0b35eaa4489e6f4ef638fbae16b73aa310403d4de0ae6bf633f'),
  ('3bd63a14-86a5-4bfa-8e44-2aa18dd40f36'::uuid,'55CLUB','5004c450-fef5-1ce9-d4b1-a61055cc0e2f'::uuid,timestamptz '2026-10-03 18:32:49+00','d240cc12e414e7d907af90a5616eb4e89c6712c6f260f38f951955552aacd7cf'),
  ('7ba3121f-30b2-44da-a732-8905c9eb5328'::uuid,'6CLUB','731dd8f6-db82-eef0-da03-99211387e514'::uuid,timestamptz '2026-10-03 19:15:37+00','032c59e347e12b223b9dfa68a2f8feb177d737eec5e0d14064a8c7dda742e95a'),
  ('c2d949fb-5940-4bf9-8e96-0af90078c43e'::uuid,'82LOTTERY','3aa6d428-6da6-fa9b-3a61-2b269ce2c8f0'::uuid,timestamptz '2026-10-03 18:48:04+00','b3bc74ab2a91e3f30d0165b2ff9296d902b3d87f82fd4ea42327aafe6140e80a'),
  ('a09dc71f-fbdb-49f3-8c3d-ce2cd57276a9'::uuid,'91CLUB','5e952cbb-e42f-d6b1-a24a-a0d42d165df9'::uuid,timestamptz '2026-10-03 18:31:01+00','5008d119cbcb20493ab952b0855aa8e0659e77149cfcbf2994d1d98311343b82'),
  ('7f0b54b5-be2f-4af1-a8e6-77131264c091'::uuid,'BIGMUMBAI','b40ec767-829c-db68-d774-a940150deb2a'::uuid,timestamptz '2026-10-03 18:42:26+00','7c838802f7041ae92ffdfaf81e1855f1fc319d9b92e341efb4b86499651681d6'),
  ('396ebd8c-e9b5-467d-8d5d-5619dd22a1ba'::uuid,'IN999','0c93b920-a24b-84f1-bba4-f4df868f6910'::uuid,timestamptz '2026-10-03 18:34:38+00','e096addcbb4e562e0b501b205a98fa0a1b7d507260cabb8395829704cd14203f'),
  ('e13909fe-72df-4212-b58a-441f33cd53e4'::uuid,'JAICLUB','5c4e9b73-6a94-053f-c42c-22a35e03f959'::uuid,timestamptz '2026-10-03 19:59:07+00','9f697b3f3f144e925cab5421ea7eb537c1b8fea5d5a7621bcc1c9d2c201d798d'),
  ('72eb3add-806a-4b25-9597-388dbe72378b'::uuid,'JALWA','72b27b17-4cdd-8d41-e39a-875ff42cd25a'::uuid,timestamptz '2026-10-03 18:38:34+00','180e3cab9a5d2f44be7328d708edf998775e77b8baa5025fea5450f6d1851b86'),
  ('1f3580fa-6c86-4c3a-b6e6-64b47732bb06'::uuid,'LOTTERY7','40433510-a19b-1810-6ec0-2b32be9e1f72'::uuid,timestamptz '2026-10-03 18:55:29+00','0959af377ef09d2b58ee06a8d42f2d320edb522c49f8b1048f427e716f4e44ae'),
  ('dea49b89-3bec-452d-84bb-c27b12f03f53'::uuid,'OKWIN','43766f8a-87dd-8aab-e8c7-9d4853cdbca2'::uuid,timestamptz '2026-10-03 18:36:28+00','6d3649f590bda8472eb64c159d423e04a2860445f60e839411bca1835ee380e9'),
  ('7071a802-55c6-4425-bae1-7966be8e59c3'::uuid,'RAJA','f6de813a-d0da-804d-e1e1-d38e4cc287a8'::uuid,timestamptz '2026-10-03 19:42:51+00','801d903fbc2bec8a8782b622d671abe2e317196d8897b89ba33987978a6e993c'),
  ('ca79a894-5108-487f-85d1-a180fd9b98c3'::uuid,'Shree.Win','fef148af-9325-e1b7-5daf-73c0e796d8a4'::uuid,timestamptz '2026-10-03 20:17:10+00','a12bb4ccd540329218a77d5153b25fd9bd1aaa3ece4671effab6a3b4c97320f9'),
  ('24dacc82-91aa-415c-8230-59f084670a22'::uuid,'TPPLAY','57cd0f0e-c685-8be1-dc2b-52c9672e33df'::uuid,timestamptz '2026-10-03 19:28:20+00','6bf75433e779645291299e5947d99ed7e05068114c640a56103138e929ec824d'),
  ('11f0511d-7d93-47f3-bac5-179061684ae0'::uuid,'Veer.Game','dba5345b-e924-e014-5bda-f4abc8895925'::uuid,timestamptz '2026-10-03 20:37:02+00','369d078afafcc438f37e775c394ebc90702ed37a04f4f629871d2c067562a1e1')
 ) select count(*) into confirmed_count from expected x
 join private.withdraw_pending_capture_archive a on a.id=x.archive_id
 join private.withdraw_pending_capture_currency_confirmations e on e.archive_id=a.id
 where e.source_system=a.source_system and e.country_code=a.country_code and e.platform=x.platform
  and e.platform=a.platform and e.stat_date=a.stat_date and e.snapshot_at=x.snapshot_at and e.snapshot_at=a.snapshot_at
  and e.window_start=a.window_start and e.window_end=a.window_end and e.snapshot_id=a.snapshot_id
  and e.platform_id=x.platform_id and e.platform_id=a.platform_id and e.native_source_system=a.native_source_system
  and e.team_name=a.team_name and e.timezone=a.timezone and e.archive_content_sha256=x.content_hash
  and e.currency='INR' and e.confirmation_basis='owner_confirmation';
 if confirmed_count<>15 then raise exception 'pending_oct3_confirmation_evidence_drift';end if;
 select md5(jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),
   'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred) order by c.conname)::text)
 into constraint_hash from pg_constraint c where c.conrelid=target and c.contype<>'n';
 -- PostgreSQL 17 and 18 deparse this exact row-IN CHECK differently.
 -- Both complete constraint hashes are pinned; neither permits different tuples.
 if constraint_hash not in ('c171210c319c4e5acaf8898e23294f10','70df0246a95d68d48b7e7c37b0217933') then raise exception 'pending_oct3_confirmation_target_drift';end if;
end $confirm$;
notify pgrst,'reload schema';commit;
