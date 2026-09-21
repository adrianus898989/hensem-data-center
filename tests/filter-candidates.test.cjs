const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs,root}=require('./load-typescript.cjs');
const {parseFilterCandidates,orderProviderCandidates}=loadTs(path.join(root,'src/lib/filterCandidates.ts'));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/migrations/20260921091523_third_party_filter_candidates.sql');
function fn(source,name,delimiter='$$'){
  const start=source.indexOf('create or replace function '+name+'('),body=source.indexOf('as '+delimiter,start),end=source.indexOf(delimiter+';',body+delimiter.length+3);
  assert.ok(start>=0&&body>start&&end>body);return source.slice(start,end+delimiter.length+1);
}
let db;
const catalog=async()=>(await db.query('select public.dashboard_third_party_filter_options() data')).rows[0].data;
async function identity(countries=null,permission='true',uid='00000000-0000-4000-8000-000000000001'){
  await db.query("select set_config('test.scope',$1,false),set_config('test.permission',$2,false),set_config('test.uid',$3,false)",[
    JSON.stringify(countries===null?{mode:'all',countries:[]}:{mode:'selected',countries}),permission,uid]);
}
before(async()=>{
  db=new PGlite();await db.exec(`
    create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
    grant usage on schema auth,private to authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function public.dashboard_has_permission(text) returns boolean language sql stable as $$select current_setting('test.permission',true)='true' and $1='third_party'$$;
    create function private.dashboard_current_data_scope() returns jsonb language sql stable as $$select current_setting('test.scope',true)::jsonb$$;
    create function private.dashboard_third_party_filter_options() returns jsonb language sql stable as $$select '{"platforms":[]}'::jsonb$$;
    create table third_party_volume(country text,platform text,channel text,raw_channel text,channel_type text,direction text,quarantined_at timestamptz);
    create table game66_platforms(id integer,platform_name text,team_code text);
    create table game66_dictionary_snapshots(id integer,platform_id integer,data_type text,pay_methods jsonb,pay_method_list jsonb,withdraw_channel jsonb,fetched_at timestamptz);
    insert into third_party_volume values ('印度','DhaniWin','LKgoPay','LKgoPayINR-Bank','BANK','代付',null),('印度','DhaniWin','LKgoPay','LKgoPayINR-Bank','BANK','代付',null),('巴基斯坦','92R','MCBPay','MCBPayPKR-Jazz','JAZZ','代收',null),('印度','DhaniWin','Quarantined','Quarantined','UPI','代收',now());
    insert into game66_platforms values (1,'EZ777','hong_kong'),(2,'YY9','red_crab');
    insert into game66_dictionary_snapshots values
      (1,1,'charge','{"1":"UPI"}','[{"label":"PayA唤醒","value":1,"secret":"MUST_NOT_EXPOSE"}]',null,'2026-09-21'),
      (2,1,'charge','{"1":"OLD"}','[{"label":"OldPay"}]',null,'2026-09-20'),
      (3,1,'withdraw',null,null,'[{"label":"PayB唤醒"}]','2026-09-21'),
      (4,2,'withdraw',null,null,'{"invalid":"shape"}','2026-09-21');
  `);
  const team=read('supabase/migrations/20260916183000_game66_team_dashboard.sql');
  for(const name of ['private.dashboard_data_scope_valid','private.dashboard_data_group'])await db.exec(fn(team,name));
  await db.exec(fn(read('supabase/migrations/20260912150854_dashboard_account_data_scope.sql'),'private.dashboard_scope_allows','$function$'));
  for(const table of ['third_party_volume','game66_platforms','game66_dictionary_snapshots'])await db.exec(`alter table ${table} enable row level security;revoke all on ${table} from public,anon,authenticated;`);
  await db.exec(migration);await identity();
});
after(async()=>{await db?.close();});
test('candidate RPC returns distinct names, latest dictionaries, no transactions or arbitrary fields',async()=>{
  const value=await catalog(),rows=value.candidates;
  assert.equal(rows.length,5);assert.ok(rows.some(r=>r.channel==='LKgoPay'));assert.ok(rows.some(r=>r.channel_type==='UPI'));
  assert.ok(rows.some(r=>r.provider==='PayB唤醒'&&r.direction==='代付'));
  assert.doesNotMatch(JSON.stringify(value),/MUST_NOT_EXPOSE|OldPay|Quarantined/);
  for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['country','platform','channel','provider','channel_type','direction','source'].sort());
});
test('candidate SQL checks module/account and scope, denies direct table reads',async()=>{
  await identity(['PK']);await db.exec('set role authenticated');
  try{const rows=(await catalog()).candidates;assert.equal(rows.length,1);assert.equal(rows[0].platform,'92R');await assert.rejects(()=>db.query('select * from game66_dictionary_snapshots'),/permission denied/);}
  finally{await db.exec('reset role');}
  await identity(['HK_TEAM']);assert.equal((await catalog()).candidates.length,3);
  await identity([]);assert.deepEqual((await catalog()).candidates,[]);
  await identity(null,'false');await assert.rejects(catalog,/没有三方查询权限/);
  await identity(null,'true','');await assert.rejects(catalog,/请先登录/);
  await identity();await db.exec('set role anon');try{await assert.rejects(catalog,/permission denied/);}finally{await db.exec('reset role');}
});
test('client projection and detail suggestions preserve exact source names and selected scope',()=>{
  const raw={country:'印度',platform:'DHANIWIN(新AR)',channel:'LKgoPay',provider:'LKgoPayINR-Bank',channel_type:'BANK',direction:'代付',source:'history',secret:'discard'};
  const rows=parseFilterCandidates([raw,raw,{...raw,platform:'RAJA'},{...raw,country:'巴基斯坦',platform:'92R'}]);
  assert.equal(rows.length,3);assert.doesNotMatch(JSON.stringify(rows),/discard/);
  assert.deepEqual(orderProviderCandidates(rows,'印度','DhaniWin','withdraw'),['LKgoPayINR-Bank']);
  assert.deepEqual(orderProviderCandidates(rows,'印度','DhaniWin','charge'),[]);
  assert.deepEqual(orderProviderCandidates(rows,'香港','EZ777','all'),[]);
  for(const invalid of [null,{},[{...raw,provider:'bad\ntext'}],[{...raw,direction:'unknown'}],Array(20001).fill(raw)])assert.throws(()=>parseFilterCandidates(invalid),/不完整/);
});
