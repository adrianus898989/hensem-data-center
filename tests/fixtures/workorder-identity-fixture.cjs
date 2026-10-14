const fs=require('node:fs'),path=require('node:path');
const{fixture:roleFixture,IDS}=require('./workorder-upi-role-authority-fixture.cjs');
const ROOT=path.resolve(__dirname,'../..');
const MIGRATION=path.join(ROOT,'supabase/migrations/20261014075212_workorder_me_identity_context.sql');
const SIDS=Object.fromEntries(Object.entries(IDS).map(([key,id])=>[key,id.replace(/^10000000/,'90000000')]));
async function fixture({install=true}={}){
 const h=await roleFixture();const db=h.db;
 await db.exec(fs.readFileSync(path.join(__dirname,'workorder-identity-auth-prerequisites.sql'),'utf8'));
 await db.exec("update auth.users set email=(select username||'@hensem.local' from public.dashboard_profiles p where p.auth_user_id=id) where id in(select auth_user_id from public.dashboard_profiles);insert into private.application_security_policies values('workorder',false);insert into public.dashboard_security_settings values(1,false);");
 for(const [role,id]of Object.entries(IDS)){
  const surface=['owner','admin'].includes(role)?'dashboard':'workorder';
  await db.query('insert into auth.sessions values($1,$2,null)',[SIDS[role],id]);
  await db.query("insert into private.application_sessions values($1,$2,$3,null,'203.0.113.7')",[SIDS[role],id,surface]);
  await db.query("insert into private.application_account_security values($1,$2,null,'global')",[id,surface]);
 }
 if(install)await db.exec(fs.readFileSync(MIGRATION,'utf8'));
 const service=async(sql,params=[])=>{await db.exec('set role service_role');try{return(await db.query(sql,params)).rows;}finally{await db.exec('reset role');}};
 const context=async({actor=IDS.agent,email='agent@workorder.hensem.local',sid=SIDS.agent,proxy=true,ip='203.0.113.7'}={})=>(await service('select public.workorder_portal_identity_context($1,$2,$3,$4,$5) value',[actor,email,sid,proxy,ip]))[0].value;
 const snapshot=async()=>{const values={};for(const table of ['public.workorder_portal_accounts','private.workorder_permission_roles','public.workorder_portal_account_audit','private.workorder_permission_role_audit','private.application_sessions','private.application_account_security','public.dashboard_platform_team_map','public.game66_platforms'])values[table]=(await db.query('select coalesce(jsonb_agg(t order by t::text),\'[]\'::jsonb) value from '+table+' t')).rows[0].value;return values;};
 return{...h,service,context,snapshot,SIDS,MIGRATION};
}
module.exports={fixture,IDS,SIDS,MIGRATION};
