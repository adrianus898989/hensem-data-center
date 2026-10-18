// Local synthetic fixture only. Actual reader source and every production guard remain unchanged.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),repo=root,tests=path.join(repo,'tests');
const code=p=>fs.readFileSync(path.join(repo,p),'utf8');
const prefix=code('tests/ar-withdraw-detail-manual-evidence-sql.test.cjs').split(/\ntest\(/)[0];
const ar=new Function('require','__dirname',prefix+';return{fixture,installObjects,add,record};')(require,tests);
const nPrefix=code('tests/newar-withdraw-blocking-raw-reasons.test.cjs').split(/\ntest\(/)[0];
const newar=new Function('require','__dirname',nPrefix+';return{order,projection};')(require,tests);
const signatures=['public.dashboard_admin_live_withdraw_reasons(jsonb)','private.ar_withdraw_detail_evidence_generation()','private.dashboard_admin_live_blocking_details_cleaned(text)','private.dashboard_admin_live_clean_note(text)','private.dashboard_admin_live_withdraw_reasons(jsonb)','private.dashboard_admin_newar_withdraw_reasons(jsonb,jsonb,jsonb)'];

async function setup(){
 const db=await ar.fixture();
 try{
  await ar.installObjects(db);
  const evidenceDefinition=(await db.query("select pg_get_functiondef(oid)definition,md5(prosrc)body,md5(pg_get_functiondef(oid))full from pg_proc where oid='private.ar_withdraw_detail_evidence_generation()'::regprocedure")).rows[0];
  assert.equal(evidenceDefinition.body,'393978c9146ae30019a87632d4d51998');assert.equal(evidenceDefinition.full,'2faf3014abf50db358400b4fff3001fd');
  const schema=code('tests/newar-withdraw-fact-projection.test.cjs').match(/await db\.exec\(`([\s\S]*?)`\);/)[1];
  await db.exec(schema.slice(schema.indexOf(' create table public.newar_detail_platforms'),schema.indexOf(' create function private.dashboard_admin_live_platforms')));
  await db.exec("insert into public.newar_detail_platforms values('MAANWIN','印度','IN','Asia/Kolkata',null,true),('DhaniWin','印度','IN','Asia/Kolkata',null,true)");
  await db.exec('set check_function_bodies=off');
  // The AR-only parent fixture provides an unused NEWAR-days stub with different
  // argument names. Replace that dependency with its real code before cutover.
  await db.exec('drop function if exists private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date)');
  await db.exec(code('tests/fixtures/newar-withdraw-projection-production.sql').trim().replace(/\$function\$$/,'$function$;'));
  await db.exec('reset check_function_bodies');
  await db.exec('revoke all on function private.dashboard_admin_newar_withdraw_days(jsonb,jsonb,date,date),private.newar_stats_time(text),private.ingest_newar_detail_batch(text,jsonb)from public,anon,authenticated,service_role;grant execute on function private.ingest_newar_detail_batch(text,jsonb)to service_role');
  await db.exec(code('supabase/migrations/20261011064049_newar_withdraw_fact_projection.sql'));
  await db.exec(code('supabase/migrations/20261013073123_newar_withdraw_reason_projection.sql'));
  await db.exec(`create schema if not exists auth;
   create table if not exists private.application_sessions(user_id uuid,session_id uuid,surface text,revoked_at timestamptz);
   create table if not exists public.dashboard_profiles(auth_user_id uuid,active boolean,role text);
   create table if not exists public.dashboard_admin_preview_grants(auth_user_id uuid,can_view boolean);
   create table if not exists auth.sessions(id uuid,user_id uuid,not_after timestamptz,created_at timestamptz);
   insert into public.dashboard_profiles values('00000000-0000-4000-8000-000000000011',true,'owner');
   insert into private.application_sessions values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000022','dashboard',null);
   insert into auth.sessions values('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000011',now()+interval'1day',now());
   create or replace function auth.uid()returns uuid language sql stable as $$select(current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
   create or replace function private.application_session_allowed(uuid,uuid,text)returns boolean language sql stable as $$select exists(select 1 from private.application_sessions a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id where a.user_id=$1 and a.session_id=$2 and a.surface=$3 and a.revoked_at is null and(s.not_after is null or s.not_after>now()))$$;
   create or replace function private.application_current_session_allowed(text)returns boolean language sql stable as $$select private.application_session_allowed(auth.uid(),(current_setting('request.jwt.claims',true)::jsonb->>'session_id')::uuid,$1)$$;
   create or replace function private.dashboard_role_require_gateway()returns void language plpgsql stable as $$begin if current_setting('test.gateway_denied',true)='true'then raise exception using errcode='42501',message='role_gateway_required';end if;end$$;
   create or replace function private.dashboard_current_data_scope()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.scope',true),'')::jsonb,'{"mode":"all","countries":[]}'::jsonb)$$;
   delete from public.synthetic_catalog where country='印度'and name in('91CLUB','MAAN.WIN');
   insert into public.synthetic_catalog values('10000000-0000-4000-8000-000000000001','91CLUB','M8','印度','IN','ar','Asia/Kolkata','INR','91CLUB'),('10000000-0000-4000-8000-000000000002','MAAN.WIN','M8','印度','IN','newar','Asia/Kolkata','INR','MAANWIN');`);
  await db.exec("create or replace function private.dashboard_admin_live_scope()returns jsonb language sql stable as $$select '{\"mode\":\"all\",\"countries\":[]}'::jsonb$$");
  await ar.add(db,'SYNTHETIC-AR17',null,{applied_at:'2026-10-17 12:00:00',completed_at:'2026-10-17 12:03:00',manual_remark:'用户余额大于19999,用户余额:20000'});
  await ar.record(db,'SYNTHETIC-AR17',{applied:'2026-10-17 12:00:00',submitted:'2026-10-17 12:01:00'});
  await newar.order(db,'SYNTHETIC-NEWAR17','用户余额大于19999,用户余额:20000',{platform:'MAANWIN',created:'2026-10-17T00:00:00Z',captured:'2026-10-18T00:00:00Z',handled:'2026-10-17T00:01:00Z'});
  await db.exec('set check_function_bodies=off');
  // Reconstruct the prior pure reader code from the exact maintained patch.
  // Its existing installer checks the complete original body/definition hashes.
  const repair=code('supabase/operations/withdraw-reasons-conditional-raw-reader.sql');
  const definition=name=>{const m=repair.match(new RegExp('CREATE OR REPLACE FUNCTION private\\.'+name+'\\([\\s\\S]*?AS \\$function\\$[\\s\\S]*?\\$function\\$'));if(!m)throw Error('reader code missing');return m[0]+';'};
  const oldJoin="  left join public.newar_detail_records n on z.record_id is null and n.id=f.record_id\n   and n.platform=v_cfg.platform and n.dataset='withdraw'";
  const newJoin="  left join lateral (\n   select source_record.order_number,source_record.amount,source_record.raw\n   from public.newar_detail_records source_record\n   where z.record_id is null and source_record.id=f.record_id\n    and source_record.platform=v_cfg.platform and source_record.dataset='withdraw'\n   limit 1\n  ) n on true";
  await db.exec(definition('dashboard_admin_live_withdraw_reasons').replace('  ), selected_notes as not materialized (','  ), selected_notes as materialized ('));
  await db.exec(definition('dashboard_admin_newar_withdraw_reasons').replace(newJoin,oldJoin));
  // Use the already-reviewed current pure taxonomy definition from its public migration.
  const game=code('supabase/migrations/20261018084420_withdraw_game_valid_bet_reason_groups.sql');
  await db.exec(game.match(/execute \$definition\$([\s\S]*?)\$definition\$;/)[1]+';');
  await db.exec(`create or replace function public.dashboard_admin_live_withdraw_reasons(p_request jsonb)returns jsonb language sql stable set search_path=''as $$select private.dashboard_admin_live_withdraw_reasons(p_request)$$`);
  await db.exec('reset check_function_bodies');
  return db;
 }catch(e){await db.close();throw e;}
}
module.exports={setup,ar,newar,signatures};
