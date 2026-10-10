const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs'), ts = require('typescript');
const { loadTs, root } = require('./load-typescript.cjs');

test('all-data fee request skips the platform-status matrix when requested', async (t) => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const oldFetch = global.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fees.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-anon';
  const calls = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: 'synthetic-owner' });
    }
    if (url.pathname === '/rest/v1/dashboard_profiles') {
      return Response.json([{ auth_user_id: 'synthetic-owner', username: 'owner', role: 'owner', active: true, permissions: {}, data_scope: null }]);
    }
    if (url.pathname === '/rest/v1/rpc/dashboard_role_access') return Response.json({mode:'owner',roleId:null,roleName:null,version:0,canView:true,permissions:[]});
    if (url.pathname === '/rest/v1/third_party_rates') {
      return Response.json([{ id: 'r1', country: '印度', third_party: 'SyntheticPay', collect_fee: '1%', updated_at: '2026-09-17T00:00:00Z' }], { headers: { 'content-range': '0-0/1' } });
    }
    throw new Error(`unexpected request ${url.pathname}`);
  };
  t.after(() => {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey;
  });

  const { readSupabaseThirdPartyRates } = loadTs(path.join(root, 'src/lib/supabaseDashboardServer.ts'));
  const payload = await readSupabaseThirdPartyRates(new Request('https://site.invalid/api/supabase-third-party-rates?includeStatuses=0', { headers: { Authorization: 'Bearer synthetic-session' } }));
  assert.equal(payload.rates.length, 1);
  assert.equal(payload.platformStatuses.length, 0);
  assert.equal(payload.summary.totalStatusCells, 0);
  assert.equal(calls.includes('/rest/v1/third_party_platform_status'), false);
});

test('platform-only accounts cannot read unattributed country fees or global status in app and Edge readers',async t=>{
  const oldFetch=global.fetch,oldDeno=global.Deno,env=[process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://fees.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-anon';global.Deno={env:{get:name=>name==='SUPABASE_URL'?'https://fees.invalid':'synthetic-anon'}};
  t.after(()=>{global.fetch=oldFetch;global.Deno=oldDeno;['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY'].forEach((key,index)=>env[index]===undefined?delete process.env[key]:process.env[key]=env[index]);});
  const calls=[];global.fetch=async input=>{const url=new URL(String(input));calls.push(url.pathname);
    if(url.pathname==='/auth/v1/user')return Response.json({id:'synthetic-viewer'});
    if(url.pathname==='/rest/v1/dashboard_profiles')return Response.json([{auth_user_id:'synthetic-viewer',username:'viewer',role:'viewer',active:true,permissions:{third_party:true},data_scope:{mode:'selected',countries:[],platforms:[{country:'IN',platform:'A'}]}}]);
    if(url.pathname.endsWith('/application_session_guard'))return Response.json(true);
    if(url.pathname.endsWith('/dashboard_role_access'))return Response.json({mode:'legacy',canView:true,permissions:[]});
    throw Error('unscoped business data must not be read');};
  const modules=new Map();function edge(file){if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',code)(name=>edge(path.resolve(path.dirname(file),name)),module,module.exports);return module.exports;}
  for(const reader of [loadTs(path.join(root,'src/lib/supabaseDashboardServer.ts')),edge(path.join(root,'supabase/functions/dashboard-api/lib/supabaseDashboardServer.ts'))]){
    const request=new Request('https://site.invalid/api/supabase-third-party-rates',{headers:{Authorization:'Bearer synthetic-session'}});
    for(const action of ['readSupabaseThirdPartyRates','readSupabaseThirdPartySyncStatus','readSupabaseHomeStatus'])await assert.rejects(reader[action](request),error=>error.status===403);
  }
  assert(calls.every(path=>['/auth/v1/user','/rest/v1/dashboard_profiles','/rest/v1/rpc/application_session_guard','/rest/v1/rpc/dashboard_role_access'].includes(path)));
});
