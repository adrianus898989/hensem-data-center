const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const ACTOR = '11111111-1111-4111-8111-111111111111';
const ROLE = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const CREATED = '44444444-4444-4444-8444-444444444444';
const EXISTING = '55555555-5555-4555-8555-555555555555';
const TICKET = '77777777-7777-4777-8777-777777777777';
const ALL = {mode:'all', countries:[]};
const PANGHU = {mode:'selected', countries:['BR_PANGHU']};
const FULL_PERMISSIONS = ['access.view', 'access.create', 'access.edit', 'overview.view'];
const tokenFor = session => 'fixture.' + Buffer.from(JSON.stringify({session_id:session})).toString('base64url') + '.signature';
const TOKEN = tokenFor(SESSION);
const clone = value => structuredClone(value);
const prepared = (patch = {}) => ({ok:true, status:'prepared', creation_id:TICKET, username:'synthetic-new', role_id:ROLE, role_version:7, data_scope:clone(PANGHU), ...clone(patch)});
const committed = (patch = {}) => ({ok:true, status:'committed', creation_id:TICKET, account:{auth_user_id:CREATED, username:'synthetic-new', role:'viewer', active:true,
  role_id:ROLE, role_name:'Synthetic empty role', role_version:7, assignment_version:1, data_scope:clone(PANGHU)}, ...clone(patch)});
const aborted = (patch = {}) => ({ok:true, status:'aborted', creation_id:TICKET, cleanup_user_id:CREATED, ...clone(patch)});
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'BACKEND_CURRENT/dashboard-user-admin.ts'), 'utf8').replace(/^import .*;\n/, ''), {
  compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS},
}).outputText;

// This harness executes the real HTTP handler, while every Auth, SQL, and role
// response is local and synthetic. Unexpected service operations fail the test.
function harness(options = {}) {
  const calls = [];
  const profile = {
    auth_user_id:ACTOR, username:'synthetic-manager', role:'viewer', active:true,
    permissions:{home:false, third_party:false, auto_withdraw:false, work_orders:false, customer_service:false},
    management_permissions:{manage_viewers:false, refresh_data:false, view_audit:false},
    data_scope:ALL, ...clone(options.profile || {}),
  };
  const access = {
    mode:'assigned', roleId:'66666666-6666-4666-8666-666666666666', roleName:'Synthetic manager',
    version:1, assignmentVersion:1, canView:true, permissions:FULL_PERMISSIONS,
    ...clone(options.access || {}),
  };
  let handler;
  let creationStage = 0;
  const env = {SUPABASE_URL:'https://edge-fixture.invalid', SUPABASE_SERVICE_ROLE_KEY:'synthetic-service', SUPABASE_ANON_KEY:'synthetic-public'};
  const client = {
    async rpc(name, args) {
      calls.push({kind:'rpc', name, args:clone(args)});
      if (name === 'application_session_check') {
        assert.deepEqual(clone(args), {p_user_id:ACTOR, p_session_id:SESSION, p_surface:'dashboard'});
        return options.sessionResult || {data:{allowed:true}, error:null};
      }
      if (name === 'dashboard_create_role_account') {
        creationStage++;
        if (options.createRpc) return options.createRpc(clone(args), creationStage, calls);
        assert.equal(args.p_actor, ACTOR);
        assert.equal(args.p_session_id, SESSION);
        const request = args.p_request;
        assert.equal(request.creationId, TICKET);
        if (request.operation === 'prepare') return {data:prepared(options.preparedPatch), error:null};
        if (request.operation === 'commit') return {data:committed(options.committedPatch), error:null};
        if (request.operation === 'abort') return {data:aborted(options.abortedPatch), error:null};
        throw Error('Unexpected creation ticket operation: ' + request.operation);
      }
      if (options.otherRpc) return options.otherRpc(name, clone(args), calls);
      throw Error('Unexpected RPC: ' + name);
    },
    auth:{
      async getUser(token) {
        calls.push({kind:'auth', action:'getUser', token});
        assert.equal(token, options.token || TOKEN);
        return options.authResult || {data:{user:{id:ACTOR, user_metadata:{dashboard_role:'owner', role_id:ROLE, data_scope:ALL}}}, error:null};
      },
      admin:{
        async createUser(data) {
          calls.push({kind:'auth', action:'createUser', data:clone(data)});
          if (options.createThrows) throw Error('PRIVATE_AUTH_CREATE_FAILURE');
          return options.createResult || {data:{user:{id:CREATED}}, error:null};
        },
        async deleteUser(id) {
          calls.push({kind:'auth', action:'deleteUser', id});
          if (options.deleteThrows) throw Error('PRIVATE_AUTH_DELETE_FAILURE');
          return options.deleteResult || {data:{user:{id}}, error:null};
        },
        async updateUserById() { throw Error('Creating a role account must never update an existing Auth user'); },
        async listUsers() { throw Error('Creating a role account must never find an existing Auth user by email'); },
        async getUserById(id) {
          calls.push({kind:'auth', action:'getUserById', id});
          if (options.getCreatedUser) return options.getCreatedUser(id);
          throw Error('Unexpected Auth recovery read');
        },
      },
    },
    from(table) {
      const filters = [];
      let selection;
      const query = {
        select(value) { selection=value; return query; },
        eq(key,value) { filters.push([key,value]); return query; },
        limit() { return query; },
        async insert(value) {
          calls.push({kind:'insert', table, value:clone(value)});
          assert.equal(table, 'dashboard_audit_log', 'profile, assignment and preview grant must be committed by SQL together');
          return {error:null};
        },
        async maybeSingle() {
          const read = {kind:'read', table, selection, filters:clone(filters)};
          calls.push(read);
          if (table === 'dashboard_profiles' && filters.some(([key,value]) => key === 'auth_user_id' && value === ACTOR)) {
            return options.profileResult || {data:clone(profile), error:null};
          }
          if (options.readResult) return options.readResult(read, calls);
          throw Error('Unexpected recovery or conflict read: ' + table);
        },
        update() { throw Error('Role-account creation cannot directly update a profile'); },
        upsert() { throw Error('Role-account creation cannot directly upsert profile, assignment or preview grant'); },
        delete() { throw Error('Role-account creation cannot directly delete profile, assignment or preview grant'); },
      };
      return query;
    },
  };
  const fetch = async (url, init) => {
    calls.push({kind:'fetch', url:String(url), init:clone({...init, signal:undefined})});
    assert.equal(String(url), env.SUPABASE_URL + '/rest/v1/rpc/dashboard_role_access');
    assert.equal(init.headers.Authorization, 'Bearer ' + (options.token || TOKEN));
    assert.equal(init.headers.apikey, env.SUPABASE_ANON_KEY);
    assert.equal(init.method, 'POST');
    assert.equal(init.body, '{}');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    if (options.roleThrows) throw Error('PRIVATE_ROLE_ACCESS_FAILURE');
    if (options.roleMalformed) return new Response('{', {status:200});
    return Response.json(options.roleResult === undefined ? access : options.roleResult, {status:options.roleStatus || 200});
  };
  vm.runInNewContext(compiled, {
    createClient:(url,key,config) => {
      assert.equal(url, env.SUPABASE_URL);
      assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(config.auth.persistSession, false);
      assert.equal(config.auth.autoRefreshToken, false);
      return client;
    },
    Deno:{env:{get:key => env[key]}, serve:fn => { handler=fn; }},
    crypto:{randomUUID:() => TICKET}, fetch, Request, Response, Headers, URL, Date, Intl, console, AbortSignal, atob, TextEncoder, TextDecoder, Uint8Array,
  });
  async function run(patch = {}, requestOptions = {}) {
    const body = {action:'create-role-account', username:'synthetic-new', password:'synthetic-password-only', role_id:ROLE, role_version:7, data_scope:PANGHU, ...clone(patch)};
    if (requestOptions.omit) for (const field of requestOptions.omit) delete body[field];
    const response = await handler(new Request('https://request-fixture.invalid', {
      method:requestOptions.method || 'POST',
      headers:{...(options.noToken ? {} : {Authorization:'Bearer ' + (options.token || TOKEN)}), ...requestOptions.headers},
      body:requestOptions.rawBody === undefined ? JSON.stringify(body) : requestOptions.rawBody,
    }));
    const text = await response.text();
    assert.doesNotMatch(text, /PRIVATE_|synthetic-service|synthetic-password-only|fixture\.[A-Za-z0-9_-]+\.signature/, 'HTTP errors must not expose secrets or upstream internals');
    return {status:response.status, body:JSON.parse(text), calls, headers:response.headers};
  }
  return {run, calls};
}

const creates = result => result.calls.filter(call => call.kind === 'auth' && call.action === 'createUser');
const deletes = result => result.calls.filter(call => call.kind === 'auth' && call.action === 'deleteUser');
const createRpcs = result => result.calls.filter(call => call.kind === 'rpc' && call.name === 'dashboard_create_role_account');
const deniedBeforeCreate = result => {
  assert(result.status >= 400 && result.status < 600);
  assert.deepEqual(creates(result), []);
  assert.deepEqual(deletes(result), []);
  assert.deepEqual(result.calls.filter(call => call.kind === 'insert'), []);
};

test('role-account HTTP creation rejects missing, coercible, malformed, and legacy role fields before Auth creation', async () => {
  const malformed = [
    {role_id:null}, {role_id:''}, {role_id:'viewer'}, {role_id:123}, {role_id:{}}, {role_id:[]},
    {role_version:null}, {role_version:'7'}, {role_version:0}, {role_version:-1}, {role_version:1.5}, {role_version:true},
    {username:{}}, {username:123}, {username:[]}, {password:12345678}, {password:{}}, {password:[]},
    {role:'admin'}, {permissions:{home:true}}, {management_permissions:{manage_viewers:true}}, {auth_user_id:EXISTING},
    {role_name:'Synthetic role'}, {active:true}, {user_metadata:{dashboard_role:'owner'}},
  ];
  for (const patch of malformed) {
    const result = await harness().run(patch);
    assert.equal(result.status, 400, JSON.stringify(patch));
    deniedBeforeCreate(result);
    assert.deepEqual(createRpcs(result), []);
  }
  for (const field of ['username','password','role_id','role_version','data_scope']) {
    const result = await harness().run({}, {omit:[field]});
    assert.equal(result.status, 400, field);
    deniedBeforeCreate(result);
    assert.deepEqual(createRpcs(result), []);
  }
});

test('role-account creation requires an exact explicit data scope before creating Auth', async () => {
  for (const data_scope of [null, {}, [], {mode:'all'}, {mode:'all',countries:['BR']}, {mode:'selected',countries:[]},
    {mode:'selected',countries:['unknown']}, {mode:'selected',countries:[1]}, {...PANGHU,extra:true}]) {
    const result = await harness().run({data_scope});
    assert.equal(result.status, 400, JSON.stringify(data_scope));
    deniedBeforeCreate(result);
    assert.deepEqual(createRpcs(result), []);
  }
});

test('role-account creation checks verified Auth, registered session, active profile and a fresh assigned role', async () => {
  const cases = [
    [{noToken:true},401], [{authResult:{data:{user:null},error:null}},401],
    [{authResult:{data:{user:{id:ACTOR}},error:{message:'PRIVATE_AUTH_FAILURE'}}},401],
    [{token:tokenFor('wrong-session')},403], [{sessionResult:{data:{allowed:false},error:null}},403],
    [{sessionResult:{data:{allowed:'true'},error:null}},403], [{sessionResult:{data:{allowed:true},error:{message:'PRIVATE_SESSION_FAILURE'}}},503],
    [{profileResult:{data:null,error:null}},403], [{profile:{active:false}},403],
    [{roleThrows:true},503], [{roleMalformed:true},503], [{roleStatus:503},503],
    [{roleResult:null},503], [{roleResult:[]},503], [{roleResult:{}},503],
    [{roleResult:{mode:'owner',canView:true,permissions:[]}},503], [{access:{canView:false}},403],
  ];
  for (const [options,status] of cases) {
    const result = await harness(options).run();
    assert.equal(result.status, status, JSON.stringify(options));
    deniedBeforeCreate(result);
    assert.deepEqual(createRpcs(result), []);
  }
  for (const key of ['access.view','access.create','access.edit']) {
    const result = await harness({access:{permissions:FULL_PERMISSIONS.filter(value => value !== key)}}).run();
    assert.equal(result.status, 403, key);
    deniedBeforeCreate(result);
    assert.deepEqual(createRpcs(result), []);
  }
});

test('legacy admin management flags and forged owner metadata do not authorize new role-account creation', async () => {
  for (const role of ['admin','viewer']) {
    const result = await harness({profile:{role, management_permissions:{manage_viewers:true,refresh_data:true,view_audit:true}}, access:{mode:'legacy',permissions:[]}}).run();
    assert.equal(result.status, 403);
    deniedBeforeCreate(result);
    assert.deepEqual(createRpcs(result), []);
  }
});

test('successful role-account creation prepares once, creates Auth once, then commits the same ticket and exact new ID', async () => {
  for (const options of [{}, {profile:{role:'owner'},access:{mode:'owner',permissions:[]}}, {profile:{role:'owner'},access:{mode:'legacy',permissions:[]}}]) {
    const result = await harness(options).run();
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.deepEqual(result.body.account, committed().account);
    assert.equal(creates(result).length, 1);
    assert.deepEqual(deletes(result), []);
    assert.equal(createRpcs(result).length, 2);
    assert.deepEqual(createRpcs(result)[0].args, {p_actor:ACTOR,p_session_id:SESSION,p_request:{operation:'prepare',creationId:TICKET,username:'synthetic-new',roleId:ROLE,expectedRoleVersion:7,dataScope:PANGHU}});
    assert.deepEqual(createRpcs(result)[1].args, {p_actor:ACTOR,p_session_id:SESSION,p_request:{operation:'commit',creationId:TICKET,accountId:CREATED}});
    assert.deepEqual(creates(result)[0].data, {email:'synthetic-new@hensem.local',password:'synthetic-password-only',email_confirm:true,
      user_metadata:{username:'synthetic-new',dashboard_role:'viewer',dashboard_creation_id:TICKET}});
    const boundaries = result.calls.filter(call => call.kind === 'auth' || call.kind === 'rpc' || call.kind === 'fetch');
    assert.deepEqual(boundaries.map(call => call.kind === 'auth' ? call.action : call.kind === 'fetch' ? 'fresh-role' : call.name === 'application_session_check' ? 'session' : call.args.p_request.operation),
      ['getUser','session','fresh-role','prepare','createUser','commit']);
    assert.equal(result.calls.filter(call => call.kind === 'read').length, 1, 'SQL owns duplicate and atomic creation checks');
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
  }
});

test('SQL prevalidation denies unavailable, inactive, ungrantable, duplicate, session-raced and version-raced requests without Auth creation', async () => {
  for (const [code,message] of [
    ['22023','role_unavailable'], ['42501','role_grant_exceeds_actor'], ['42501','data_scope_exceeds_actor'],
    ['23505','account_exists'], ['42501','application_session_denied'], ['40001','role_version_conflict'],
  ]) {
    const result = await harness({createRpc:async () => ({data:null,error:{code,message}})}).run();
    deniedBeforeCreate(result);
    assert.equal(createRpcs(result).length, 1, message);
  }
  const unavailable = await harness({createRpc:async () => { throw Error('PRIVATE_PREVALIDATION_NETWORK_FAILURE'); }}).run();
  assert.equal(unavailable.status, 503);
  deniedBeforeCreate(unavailable);
});

test('malformed prepare ACK fails closed before Auth creation', async () => {
  const bad = [null, [], {}, false, {...prepared(),ok:false}, {...prepared(),ok:'true'}, prepared({status:'committed'}),
    prepared({creation_id:EXISTING}), prepared({username:'different'}), prepared({role_id:EXISTING}),
    prepared({role_version:8}), prepared({role_version:'7'}), prepared({data_scope:ALL}), prepared({data_scope:null})];
  for (const data of bad) {
    const result = await harness({createRpc:async () => ({data,error:null})}).run();
    assert.equal(result.status, 503, JSON.stringify(data));
    deniedBeforeCreate(result);
    assert.equal(createRpcs(result).length, 1);
  }
});

test('a valid role with no target permissions is created from SQL acknowledgement without legacy default privileges', async () => {
  const result = await harness({access:{permissions:['access.view','access.create','access.edit']}}).run();
  assert.equal(result.status, 200);
  assert.equal(creates(result).length, 1);
  assert.equal(createRpcs(result).length, 2);
  const request = createRpcs(result)[0].args.p_request;
  assert.equal(Object.hasOwn(request,'permissions'), false);
  assert.equal(Object.hasOwn(request,'managementPermissions'), false);
  assert.deepEqual(creates(result)[0].data.user_metadata, {username:'synthetic-new',dashboard_role:'viewer',dashboard_creation_id:TICKET});
});

test('Auth duplicate, thrown, or malformed creation failures never delete a pre-existing returned ID', async () => {
  for (const options of [
    {createResult:{data:{user:{id:EXISTING}},error:{code:'email_exists',message:'PRIVATE_EXISTING_AUTH_ACCOUNT'}}},
    {createResult:{data:{user:null},error:null}}, {createResult:{data:null,error:null}},
    {createResult:{data:{user:{id:null}},error:null}}, {createResult:{data:{user:{id:'not-a-uuid'}},error:null}},
    {createThrows:true},
  ]) {
    const result = await harness(options).run();
    assert(result.status >= 400);
    assert.equal(creates(result).length, 1);
    assert.deepEqual(deletes(result), []);
    assert(!createRpcs(result).some(call => call.args.p_request.operation === 'commit'));
    assert(!createRpcs(result).some(call => call.args.p_request.accountId === EXISTING));
  }
});

test('failed or unknown commit deletes only the newly created Auth ID after exact abort confirmation', async () => {
  for (const failure of ['sql','throw','malformed']) {
    const result = await harness({createRpc:async args => {
      const operation=args.p_request.operation;
      if (operation === 'prepare') return {data:prepared(),error:null};
      if (operation === 'commit') {
        if (failure === 'throw') throw Error('PRIVATE_UNKNOWN_COMMIT_FAILURE');
        if (failure === 'malformed') return {data:{ok:true},error:null};
        return {data:null,error:{code:'40001',message:'role_version_conflict'}};
      }
      assert.equal(operation, 'abort');
      assert.deepEqual(args.p_request,{operation:'abort',creationId:TICKET,accountId:CREATED});
      return {data:aborted(),error:null};
    }}).run();
    assert(result.status >= 400, failure);
    assert.deepEqual(deletes(result).map(call => call.id), [CREATED]);
    assert.deepEqual(createRpcs(result).map(call => call.args.p_request.operation), ['prepare','commit','abort']);
    const abortPosition=result.calls.findIndex(call => call.kind === 'rpc' && call.args?.p_request?.operation === 'abort');
    const deletePosition=result.calls.findIndex(call => call.kind === 'auth' && call.action === 'deleteUser');
    assert(abortPosition < deletePosition, 'never cleanup before abort transaction confirms this ticket is not committed');
  }
});

test('a lost commit acknowledgement recovers the same completed account from abort and keeps Auth intact', async () => {
  const result = await harness({createRpc:async args => {
    if (args.p_request.operation === 'prepare') return {data:prepared(),error:null};
    if (args.p_request.operation === 'commit') throw Error('PRIVATE_COMMIT_RESPONSE_LOST');
    assert.equal(args.p_request.operation,'abort');
    return {data:committed(),error:null};
  }}).run();
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.account, committed().account);
  assert.deepEqual(deletes(result), []);
  assert.equal(creates(result).length, 1);
  assert.deepEqual(createRpcs(result).map(call => call.args.p_request.operation), ['prepare','commit','abort']);
});

test('unknown or malformed abort acknowledgement preserves Auth and fails closed rather than guessing cleanup', async () => {
  for (const abortResult of [
    {data:null,error:null}, {data:{},error:null}, {data:aborted({ok:false}),error:null},
    {data:aborted({creation_id:EXISTING}),error:null}, {data:aborted({cleanup_user_id:EXISTING}),error:null},
    {data:aborted({cleanup_user_id:null}),error:null}, {data:committed({creation_id:EXISTING}),error:null},
    {data:committed({account:{...committed().account,auth_user_id:EXISTING}}),error:null},
    {data:committed({account:{...committed().account,role_id:EXISTING}}),error:null},
    {data:committed({account:{...committed().account,role_version:8}}),error:null},
    {data:aborted(),error:{message:'PRIVATE_ABORT_SQL_FAILURE'}},
  ]) {
    const result=await harness({createRpc:async args => {
      if(args.p_request.operation === 'prepare') return {data:prepared(),error:null};
      if(args.p_request.operation === 'commit') throw Error('PRIVATE_UNKNOWN_COMMIT_FAILURE');
      return clone(abortResult);
    }}).run();
    assert.equal(result.status, 503, JSON.stringify(abortResult));
    assert.deepEqual(deletes(result), []);
    assert.equal(creates(result).length, 1);
  }
  const result=await harness({createRpc:async args => {
    if(args.p_request.operation === 'prepare') return {data:prepared(),error:null};
    throw Error('PRIVATE_COMMIT_AND_ABORT_NETWORK_FAILURE');
  }}).run();
  assert.equal(result.status, 503);
  assert.deepEqual(deletes(result), []);
});

test('malformed commit acknowledgement cannot succeed and must settle the ticket before cleanup', async () => {
  const account=committed().account;
  for (const data of [null, [], {}, {...committed(),ok:'true'}, committed({creation_id:EXISTING}),
    committed({account:{...account,auth_user_id:EXISTING}}), committed({account:{...account,username:'different'}}),
    committed({account:{...account,role:'owner'}}), committed({account:{...account,active:false}}),
    committed({account:{...account,role_id:EXISTING}}), committed({account:{...account,role_version:8}}),
    committed({account:{...account,assignment_version:'1'}}), committed({account:{...account,data_scope:ALL}}),
    committed({account:{...account,role_name:null}}), committed({account:null})]) {
    const result=await harness({createRpc:async args => ({data:args.p_request.operation === 'prepare' ? prepared() : args.p_request.operation === 'commit' ? clone(data) : aborted(),error:null})}).run();
    assert(result.status >= 400, JSON.stringify(data));
    assert.deepEqual(createRpcs(result).map(call => call.args.p_request.operation), ['prepare','commit','abort']);
    assert.deepEqual(deletes(result).map(call => call.id), [CREATED]);
  }
});

test('cleanup failure after abort is reported without returning a successfully created account', async () => {
  for (const options of [{deleteThrows:true}, {deleteResult:{error:{message:'PRIVATE_CLEANUP_FAILED'}}}]) {
    const result=await harness({...options,createRpc:async args => ({data:args.p_request.operation === 'prepare' ? prepared() : args.p_request.operation === 'commit' ? null : aborted(),error:args.p_request.operation === 'commit' ? {code:'40001',message:'role_version_conflict'} : null})}).run();
    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
    assert.deepEqual(deletes(result).map(call => call.id), [CREATED]);
  }
});

test('malformed, oversized and unapproved-origin HTTP requests cannot reach Auth creation', async () => {
  for (const rawBody of ['{', 'null', '[]', '"not-an-object"', new Uint8Array([0xff,0xff])]) {
    const result=await harness().run({}, {rawBody});
    assert.equal(result.status, 400);
    deniedBeforeCreate(result);
    assert.deepEqual(result.calls, []);
  }
  const oversized=await harness().run({}, {rawBody:' '.repeat(32769)});
  assert.equal(oversized.status, 413);
  deniedBeforeCreate(oversized);
  assert.deepEqual(oversized.calls, []);
  const origin=await harness().run({}, {headers:{origin:'https://unapproved-fixture.invalid'}});
  assert.equal(origin.status, 403);
  deniedBeforeCreate(origin);
  assert.deepEqual(origin.calls, []);
});

test('each new creation request rereads current session and role rights after prior successful creation', async () => {
  for (const revoked of ['role','session']) {
    const options={};
    const h=harness(options);
    assert.equal((await h.run()).status, 200);
    if(revoked === 'role') options.roleResult={mode:'assigned',canView:true,permissions:['access.view','access.create']};
    else options.sessionResult={data:{allowed:false},error:null};
    const result=await h.run();
    assert.equal(result.status, 403, revoked);
    assert.equal(creates(result).length, 1, 'the first account must be the only Auth creation');
    assert.equal(createRpcs(result).length, 2, 'revoked second request must not prepare another ticket');
    assert.equal(result.calls.filter(call => call.kind === 'auth' && call.action === 'getUser').length, 2);
    assert.equal(result.calls.filter(call => call.kind === 'rpc' && call.name === 'application_session_check').length, 2);
    assert.equal(result.calls.filter(call => call.kind === 'fetch').length, revoked === 'role' ? 2 : 1);
  }
});

test('accepted UUID spelling is normalized before matching authoritative role acknowledgements', async () => {
  const roleId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const result=await harness({preparedPatch:{role_id:roleId},committedPatch:{account:{...committed().account,role_id:roleId}}}).run({role_id:roleId.toUpperCase()});
  assert.equal(result.status, 200);
  assert.equal(createRpcs(result)[0].args.p_request.roleId, roleId);
  assert.equal(result.body.account.role_id, roleId);
  assert.equal(creates(result).length, 1);
});
