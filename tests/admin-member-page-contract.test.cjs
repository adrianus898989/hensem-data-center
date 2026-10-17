// Uses the production assigned gateway/catalog with synthetic accounts and reader rows.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const base=process.env.SESSION_FOLLOWUP_REPO||path.resolve(__dirname,'..'),localRoot=process.env.SESSION_FOLLOWUP_CLIENT||base,baseRequire=createRequire(path.join(base,'tests/followup.cjs'));
const oldTests=fs.readFileSync(path.join(base,'tests/dashboard-roles-sql.test.cjs'),'utf8').split(/\ntest\(/)[0].replace('await db.exec(listFix);await db.exec(retiredCatalog);','await db.exec(listFix);await db.exec(retiredCatalog);await followupPrepare();');
const fixture=new Function('require','__dirname','followupPrepare',oldTests+';return {get db(){return db},scalar,as,admin,granted,denied,execute,ADMIN,VIEWER,LEGACY};')(baseRequire,path.join(base,'tests'),followupPrepare);
const patch=fs.readFileSync(process.env.SESSION_FOLLOWUP_MIGRATION||path.join(base,'supabase/migrations/20261017160000_member_page_request_contract.sql'),'utf8');
const inner=s=>s.replace(/^begin;\n/m,'').replace(/\ncommit;\s*$/,'');let originalCatalog,originalAccounts,fixturePatch,beforeHash,afterHash;
const catalog=()=>fixture.scalar('select private.dashboard_role_catalog()');
const hash=()=>fixture.scalar("select md5(pg_get_functiondef('private.dashboard_role_catalog()'::regprocedure))");
const accounts=()=>fixture.scalar("select jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(p) order by username) from dashboard_profiles p),'grants',(select jsonb_agg(to_jsonb(g) order by auth_user_id) from dashboard_admin_preview_grants g),'roles',(select jsonb_agg(to_jsonb(r) order by id) from private.dashboard_roles r),'assignments',(select jsonb_agg(to_jsonb(a) order by auth_user_id) from private.dashboard_role_assignments a))");
async function followupPrepare(){
 const syntheticBody=await fixture.scalar("select format('create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='''' as %L',format('select %L::jsonb',private.dashboard_role_catalog()::text))");await fixture.db.exec(syntheticBody);
 originalCatalog=await catalog();originalAccounts=await accounts();beforeHash=await hash();
 // This is a synthetic historical-role fixture, not a production catalog copy.
 // Substitute only its exact body pins; run the migration's actual transformation.
 await fixture.db.exec('begin');
 const next=await fixture.scalar("select replace(pg_get_functiondef('private.dashboard_role_catalog()'::regprocedure),quote_literal(private.dashboard_role_catalog()::text),quote_literal(jsonb_set(private.dashboard_role_catalog(),'{pages}',(select jsonb_agg(case when p->>'id' in ('overview','merchants') then jsonb_set(p,'{requests}',(p->'requests')||'\"memberDaily\"'::jsonb) else p end order by ord) from jsonb_array_elements(private.dashboard_role_catalog()->'pages') with ordinality r(p,ord)))::text))");
 await fixture.db.exec(next);afterHash=await hash();assert.notEqual(afterHash,beforeHash);await fixture.db.exec('rollback');
 const pinnedAfter=patch.match(/if md5\(prior\)='([a-f0-9]{32})'/)[1],pinnedBefore=patch.match(/if md5\(prior\)<>'([a-f0-9]{32})'/)[1];fixturePatch=patch.replaceAll(pinnedBefore,beforeHash).replaceAll(pinnedAfter,afterHash);await fixture.db.exec(fixturePatch);assert.equal(await hash(),afterHash);
 await fixture.db.exec("create or replace function private.dashboard_admin_live_member_daily(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$declare scope jsonb:=private.dashboard_admin_live_scope();begin return jsonb_build_object('rpc','member_daily','request',p_request,'scope',scope,'context',private.dashboard_role_context_valid());end$$;");
}
test('migration changes exactly two page request arrays, retains accounts, permissions, ACL and all unrelated routes',async()=>{
 await fixture.admin();const actual=await catalog(),expected=JSON.parse(JSON.stringify(originalCatalog));for(const page of expected.pages)if(['overview','merchants'].includes(page.id))page.requests.push('memberDaily');assert.deepEqual(actual,expected);assert.deepEqual(await accounts(),originalAccounts);
 const local=JSON.parse(fs.readFileSync(path.join(localRoot,'src/lib/dashboardRoleCatalog.json'),'utf8'));for(const id of ['overview','merchants'])assert(local.pages.find(p=>p.id===id).requests.includes('memberDaily'));
 const saved=await hash();await fixture.db.exec(inner(fixturePatch));assert.equal(await hash(),saved);
});
test('both actual assigned page routes accept memberDaily only with their original view and query and retain data scope',async()=>{
 for(const [i,page] of ['overview','merchants'].entries()){
  await fixture.granted(i?fixture.VIEWER:fixture.ADMIN,[page+'.view',page+'.query']);const q={action:'memberDaily',platformId:'11111111-1111-4111-8111-111111111111',startAt:'2026-10-16T00:00:00Z',endAt:'2026-10-17T00:00:00Z',direction:'charge'};
  const result=await fixture.execute(page,q);assert.equal(result.rpc,'member_daily');assert.equal(result.context,true);assert.equal(result.request.action,undefined);const {action,...expected}=q;assert.deepEqual(result.request,expected);assert.deepEqual(result.scope,{mode:'restricted',platforms:[i?'B':'A']});
 }
});
test('view only, a different page, a forbidden action and bypassing the assigned gateway still fail closed',async()=>{
 for(const [i,page] of ['overview','merchants'].entries()){
  await fixture.granted(i?fixture.VIEWER:fixture.ADMIN,[page+'.view']);await fixture.denied(()=>fixture.execute(page,{action:'memberDaily'}),/role_permission_denied/);
 }
 await fixture.granted(fixture.LEGACY,['overview.view','overview.query','teamops.view','teamops.query']);await fixture.denied(()=>fixture.execute('teamops',{action:'memberDaily'}),/page_action_denied/);await fixture.denied(()=>fixture.execute('overview',{action:'configurationWrite',operation:'platform'}),/page_action_denied/);
 await fixture.denied(()=>fixture.scalar("select private.dashboard_admin_live_member_daily('{}'::jsonb)"),/role_gateway_required|preview_denied/);
});
test('an unexpected catalog body refuses the patch and retains its exact state',async()=>{
 await fixture.admin();await fixture.db.exec("create or replace function private.dashboard_role_catalog() returns jsonb language sql immutable set search_path='' as $$select '{}'::jsonb$$;");const drift=await hash();await fixture.denied(()=>fixture.db.exec(inner(fixturePatch)),/member_page_catalog_drift/);assert.equal(await hash(),drift);
});
