const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');const path=require('node:path');
const ROOT=__dirname;
const IDS={agent:'10000000-0000-0000-0000-000000000001',supervisor:'10000000-0000-0000-0000-000000000002',auditor:'10000000-0000-0000-0000-000000000003',other:'10000000-0000-0000-0000-000000000004',owner:'10000000-0000-0000-0000-000000000005',admin:'10000000-0000-0000-0000-000000000006'};
async function fixture(options={}){
 const db=new PGlite();await db.exec(fs.readFileSync(path.join(ROOT,'workorder-provider-upi-prerequisites.sql'),'utf8'));
 for(const [role,id]of Object.entries(IDS))await db.query('insert into auth.users values($1)',[id]);
 for(const role of ['agent','supervisor','auditor'])await db.query('insert into public.workorder_portal_accounts(auth_user_id,username,display_name,role,team,platforms,active)values($1,$2,$2,$2,\'M8\',array[\'PLATFORM-A\'],true)',[IDS[role],role]);
 await db.query("insert into public.workorder_portal_accounts(auth_user_id,username,display_name,role,team,platforms,active)values($1,'other','other','agent','M9',array['PLATFORM-B'],true)",[IDS.other]);
 await db.query("insert into public.dashboard_profiles values($1,'owner','owner',true),($2,'admin','admin',true)",[IDS.owner,IDS.admin]);
 await db.exec("insert into public.dashboard_platform_team_map(country_code,team_name,platform_name,active)values('IN','M8','PLATFORM-A',true),('IN','M9','PLATFORM-B',true),('IN','M8','AMBIGUOUS',true),('IN','M9','AMBIGUOUS',true);insert into public.third_party_rates(id,country,third_party)values('a','印度','Pay-A'),('country-case','尼日利亚','Pay-Foreign'),('category','印度','Pay-A');insert into public.third_party_platform_status(id,country,platform,third_party)values('b','印度','PLATFORM-A','Pay-B'),('hidden','印度','PLATFORM-B','Pay-Hidden'),('foreign','尼日利亚','PLATFORM-A','Pay-Foreign');grant usage on schema private to service_role;grant select on all tables in schema public to service_role;");
 if(options.install!==false)await db.exec(fs.readFileSync(path.join(ROOT,'../../supabase/migrations/20261013073235_workorder_provider_upi_directory.sql'),'utf8'));
 const call=async(actor,body)=>{await db.exec('set role service_role');try{return(await db.query('select public.workorder_provider_upi($1,$2) d',[actor,JSON.stringify(body)])).rows[0].d;}finally{await db.exec('reset role');}};
 return{db,call,IDS};
}
module.exports={fixture,IDS};
