// Real offline PostgreSQL semantics; no credentials, source requests, or production data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_PATH||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20260914050316_original_rate_sheet_snapshots.sql'),'utf8');
const scopeSql=fs.readFileSync(path.join(root,'supabase/migrations/20260912150854_dashboard_account_data_scope.sql'),'utf8');
function extract(source,signature,delimiter){const start=source.indexOf('create or replace function '+signature);assert(start>=0);const end=source.indexOf(delimiter+';',source.indexOf('as '+delimiter,start));assert(end>start);return source.slice(start,end+delimiter.length+1);}
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const meta={title:'合成原表',fetchedAt:'2026-09-14T05:00:00.000Z',sheets:[{sheetId:23,title:'合成越南',index:0,rowCount:100,columnCount:12,frozenRowCount:1,frozenColumnCount:1,hidden:false},{sheetId:7,title:'合成印度',index:1,rowCount:100,columnCount:12,frozenRowCount:1,frozenColumnCount:1,hidden:false}]};
const grid=s=>({sheet:s,cells:[[{text:'原值  0%\n🙂'},{text:'1.25%',format:{backgroundColor:{red:1,green:.8,blue:0}}}],[{text:'原合并名称'},{text:''}]],merges:[{startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:2}],rowHeights:[30,42],columnWidths:[120,160],hiddenRows:[],hiddenColumns:[],fetchedAt:'2026-09-14T05:00:01.000Z',rowCount:2,columnCount:2});
const grids=meta.sheets.map(grid);
(async()=>{
  const db=new PGlite();let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};const ok=(a,message)=>{assert.ok(a,message);checks++;};
  const scalar=async(text,args=[])=>Object.values((await db.query(text,args)).rows[0])[0];
  const reject=async(promise,message)=>{await assert.rejects(promise,undefined,message);checks++;};
  const role=async(name='postgres',n=null)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n===null?'':uid(n)]);if(name!=='postgres')await db.exec('set role '+name);};
  const claim=n=>scalar('select public.original_rate_sync_claim($1::uuid)',[uid(n)]);
  const publish=(n,m=meta)=>scalar('select public.original_rate_sync_publish($1::uuid,$2::jsonb)',[uid(n),JSON.stringify(m)]);
  const fail=(n,message='original_source_unavailable')=>db.query('select public.original_rate_sync_fail($1::uuid,$2)',[uid(n),message]);
  const stage=(n,index,payload=grids[index])=>db.query('insert into public.third_party_rate_original_sheets(run_id,sheet_id,payload) values($1,$2,$3::jsonb)',[uid(n),meta.sheets[index].sheetId,JSON.stringify(payload)]);
  const read=(id=null)=>scalar('select public.dashboard_original_rate_sheet($1::bigint)',[id]);
  const count=()=>scalar('select count(*)::int from public.third_party_rate_original_sheets');
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema private;grant usage on schema auth,public to anon,authenticated,service_role;grant usage on schema private to authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,permissions jsonb,data_scope jsonb);
      create table public.third_party_rates(id text primary key,collect_fee text,amount numeric);
      create table public.third_party_volume(id text primary key,amount numeric,count bigint);
      insert into public.third_party_rates values('old-rate','1.25%',987.65);insert into public.third_party_volume values('old-volume',543.21,42);`);
    const permissionSql=fs.readFileSync(path.join(root,'supabase/dashboard-v250-owner-fast-query.sql'),'utf8');
    await db.exec(extract(permissionSql,'public.dashboard_has_permission(permission_key text)','$$'));
    for(const name of ['private.dashboard_data_scope_valid(p_scope jsonb)','private.dashboard_current_data_scope()'])await db.exec(extract(scopeSql,name,'$function$'));
    await db.exec('revoke all on function private.dashboard_data_scope_valid(jsonb),private.dashboard_current_data_scope() from public,anon;grant execute on function private.dashboard_data_scope_valid(jsonb),private.dashboard_current_data_scope() to authenticated,service_role;');
    for(const [n,r,active,permissions,scope]of [[1,'owner',true,{},null],[2,'admin',true,{third_party:true},{mode:'all',countries:[]}],[3,'viewer',true,{third_party:true},{mode:'selected',countries:['BR_PANGHU']}],[4,'viewer',true,{third_party:false},{mode:'all',countries:[]}],[5,'viewer',false,{third_party:true},{mode:'all',countries:[]}],[6,'viewer',true,{},null],[7,'viewer',true,{third_party:true},{mode:'all',countries:[]}]])await db.query('insert into public.dashboard_profiles values($1,$2,$3,$4::jsonb,$5::jsonb)',[uid(n),r,active,JSON.stringify(permissions),JSON.stringify(scope)]);
    const beforeBusiness=(await db.query("select row_to_json(r) as row from public.third_party_rates r union all select row_to_json(v) from public.third_party_volume v")).rows;
    const beforeHelpers=await scalar("select pg_get_functiondef('public.dashboard_has_permission(text)'::regprocedure)||pg_get_functiondef('private.dashboard_current_data_scope()'::regprocedure)");
    await db.exec(sql);
    eq(await scalar("select count(*)::int from pg_proc where proname in ('original_rate_sync_claim','original_rate_sync_publish','original_rate_sync_fail','dashboard_original_rate_sheet','original_rate_uint','original_rate_meta_valid','original_rate_grid_valid','original_rate_stage_guard') and prosecdef"),0,'No new SECURITY DEFINER');
    eq(await scalar("select count(*)::int from pg_class where relname in ('third_party_rate_original_workbooks','third_party_rate_original_sheets') and relrowsecurity"),2,'Both tables have RLS');
    for(const who of ['anon','authenticated'])for(const signature of ['original_rate_sync_claim(uuid)','original_rate_sync_publish(uuid,jsonb)','original_rate_sync_fail(uuid,text)'])eq(await scalar('select has_function_privilege($1,$2,$3)',[who,'public.'+signature,'execute']),false,who+' cannot sync');
    for(const who of ['anon','authenticated'])for(const table of ['third_party_rate_original_workbooks','third_party_rate_original_sheets'])for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE'])eq(await scalar('select has_table_privilege($1,$2,$3)',[who,'public.'+table,privilege]),false,who+' '+table+' '+privilege);
    eq(await scalar("select has_function_privilege('anon','public.dashboard_original_rate_sheet(bigint)','execute')"),false,'Anon no RPC');
    eq(await scalar("select has_column_privilege('authenticated','public.third_party_rate_original_workbooks','lease_id','select')"),false,'No lease identifier exposure');
    await role('authenticated',2);eq(await read(),null,'No snapshot is explicit null');eq(await count(),0,'No unpublished grid visible');
    await role('service_role');await reject(read(),'Even service read RPC requires real user identity');eq(await claim(100),true,'New claim');eq(await claim(101),false,'Competing claim blocked');eq(await claim(100),false,'Duplicate claim blocked');
    const leaseSeconds=await scalar("select extract(epoch from lease_until-last_attempt_at) from public.third_party_rate_original_workbooks");ok(Number(leaseSeconds)>479&&Number(leaseSeconds)<=480.01,'Eight minute lease');
    await reject(stage(101,0),'Wrong owner cannot stage');await stage(100,0);eq(await publish(100),false,'Incomplete workbook never publishes');
    await role('authenticated',2);eq(await read(),null,'Partial generation is invisible');eq(await count(),0,'Staging not directly visible');
    await role('service_role');await stage(100,1);eq(await publish(100),true,'Full exact generation publishes');eq(await publish(100),true,'Lost publish ACK exact replay');eq(await publish(100,{...meta,title:'altered'}),false,'Changed replay cannot change metadata');
    await reject(db.query('update public.third_party_rate_original_sheets set payload=$1::jsonb where run_id=$2',[JSON.stringify({...grids[0],rowCount:1}),uid(100)]),'Published grid is immutable');
    await fail(100,'original_late_failure');eq(await scalar("select last_error from public.third_party_rate_original_workbooks"),null,'Late fail cannot alter publication');eq(await claim(100),false,'Published run cannot be reclaimed');
    for(const n of [1,2,7]){await role('authenticated',n);eq(await read(),meta,'Allowed fresh profile sees exact metadata order');eq(await read(23),grids[0],'Exact original cell text/styles preserved');eq(await count(),2,'Only current generation direct SELECT');eq(await read(999),null,'Unknown sheet null');await reject(db.query('select * from public.third_party_rate_original_workbooks'),'No implicit SELECT of lease columns');}
    for(const n of [3,4,5,6,null,999]){await role('authenticated',n);await reject(read(),'Restricted/revoked/inactive/unknown identity denied '+n);eq(await count(),0,'Direct RLS denies '+n);eq(await scalar('select count(*)::int from public.third_party_rate_original_workbooks'),0,'Metadata RLS denies '+n);}
    await role('anon');await reject(read(),'Anonymous RPC denied');await reject(count(),'Anonymous table denied');await reject(claim(102),'Anonymous claim denied');
    await role('authenticated',2);await reject(claim(102),'Authenticated claim denied');await reject(stage(102,0),'Authenticated staging denied');
    await role();await db.query("update public.dashboard_profiles set data_scope='{"+'"mode":"selected","countries":["VN"]'+"}' where auth_user_id=$1",[uid(2)]);await role('authenticated',2);await reject(read(),'Same JWT scope shrink applies immediately');
    await role();await db.query("update public.dashboard_profiles set data_scope='{"+'"mode":"all","countries":[]'+"}' where auth_user_id=$1",[uid(2)]);await role('authenticated',2);eq(await read(),meta,'Scope restore fresh');
    await role('service_role');eq(await claim(110),true,'Next generation claim');await stage(110,0);await fail(109,'original_wrong_owner');eq(await scalar("select lease_id::text from public.third_party_rate_original_workbooks"),uid(110),'Wrong fail does not release new lease');
    await role();await db.exec("update public.third_party_rate_original_workbooks set lease_until=clock_timestamp()-interval '1 second'");await role('service_role');eq(await publish(110),false,'Expired lease cannot publish');await reject(stage(110,1),'Expired lease cannot stage');eq(await claim(111),true,'New owner after expiry');
    await fail(110,'original_late_failure');eq(await scalar("select lease_id::text from public.third_party_rate_original_workbooks"),uid(111),'Old late fail cannot release replacement');await reject(stage(110,1),'Late old source result rejected');
    await stage(111,0);await stage(111,1);
    for(const invalid of [{...meta,token:'not-allowed'},{...meta,sheets:[meta.sheets[0],meta.sheets[0]]},{...meta,sheets:[meta.sheets[0]]},{...meta,sheets:[meta.sheets[0],{...meta.sheets[1],sheetId:999}]},{...meta,sheets:[{...meta.sheets[0],rowCount:10001},meta.sheets[1]]},{...meta,sheets:[{...meta.sheets[0],hidden:true},meta.sheets[1]]},{...meta,fetchedAt:'bad'}])eq(await publish(111,invalid),false,'Malformed metadata/ID mismatch cannot replace old');
    await role('authenticated',7);eq(await read(),meta,'Old good workbook retained during failed publication');await role('service_role');
    const invalidGrids=[{...grids[0],cells:[grids[0].cells[0]]},{...grids[0],cells:[[...grids[0].cells[0],{text:'extra'}],grids[0].cells[1]]},{...grids[0],rowCount:101},{...grids[0],hiddenRows:[0,0]},{...grids[0],hiddenColumns:[2]},{...grids[0],secret:'forbidden'},{...grids[0],cells:[[{text:'x',formula:'forbidden'},grids[0].cells[0][1]],grids[0].cells[1]]},{...grids[0],sheet:{...meta.sheets[0],title:'wrong'}},{...grids[0],merges:[{startRowIndex:0,endRowIndex:3,startColumnIndex:0,endColumnIndex:1}]}];
    for(const bad of invalidGrids){await db.query('update public.third_party_rate_original_sheets set payload=$1::jsonb where run_id=$2 and sheet_id=23',[JSON.stringify(bad),uid(111)]);eq(await publish(111),false,'Incomplete/foreign raw payload fails closed');}
    await db.query('update public.third_party_rate_original_sheets set payload=$1::jsonb where run_id=$2 and sheet_id=23',[JSON.stringify(grids[0]),uid(111)]);eq(await publish(111),true,'Complete trimmed dimensions are valid');eq(await count(),4,'Keep latest plus preceding published generation, clean stale partial');
    await role('authenticated',7);eq(await count(),2,'Previous complete generation not exposed');eq(await read(7),grids[1],'Current grid exact');
    await role('service_role');eq(await claim(120),true);await stage(120,0);await fail(120,'Bearer PRIVATE_CANARY untrusted source error');eq(await scalar("select last_error from public.third_party_rate_original_workbooks"),'original_source_unavailable','No arbitrary failure text persisted');
    eq(await scalar("select run_id::text from public.third_party_rate_original_workbooks"),uid(111),'Read failure preserves last successful publication');eq(await claim(121),true);await stage(121,0);await stage(121,1);eq(await publish(121),true);eq(await count(),4,'Exactly two successful generations after cleanup');
    eq(await scalar('select count(*)::int from public.third_party_rate_original_sheets where run_id=$1',[uid(100)]),0,'Third-oldest generation removed only from new table');
    eq(await claim(125),true);await stage(125,0);await stage(125,1);
    const generationsBeforeRollback=(await db.query('select run_id::text,sheet_id from public.third_party_rate_original_sheets order by run_id,sheet_id')).rows;
    await db.exec('begin');eq(await publish(125),true,'Publication inside a transaction succeeds');await db.exec('rollback');
    eq(await scalar("select run_id::text from public.third_party_rate_original_workbooks"),uid(121),'Rollback restores prior published pointer');
    eq((await db.query('select run_id::text,sheet_id from public.third_party_rate_original_sheets order by run_id,sheet_id')).rows,generationsBeforeRollback,'Cleanup and publication roll back together');
    eq(await scalar("select lease_id::text from public.third_party_rate_original_workbooks"),uid(125),'Rollback restores publishing lease');await fail(125);
    await role();eq((await db.query("select row_to_json(r) as row from public.third_party_rates r union all select row_to_json(v) from public.third_party_volume v")).rows,beforeBusiness,'Original money/fees/counts unchanged');
    eq(await scalar("select pg_get_functiondef('public.dashboard_has_permission(text)'::regprocedure)||pg_get_functiondef('private.dashboard_current_data_scope()'::regprocedure)"),beforeHelpers,'Original authorization functions unchanged');
    console.log(JSON.stringify({passed:true,offline:true,checks,actualPostgresRls:true,sourceCalls:0,productionWrites:0}));
  }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
