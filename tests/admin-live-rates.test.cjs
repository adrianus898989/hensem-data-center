// Offline synthetic Postgres integration; never connects to Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require(process.env.PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/admin-live-rates.sql'), 'utf8');
const scopeSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260912150854_dashboard_account_data_scope.sql'), 'utf8');
const liveSql = fs.readFileSync(path.join(root, 'supabase/admin-live-query.sql'), 'utf8');
function definition(source, name, delimiter) {
  const re = new RegExp(`create (?:or replace )?function private\\.${name}\\(`, 'i');
  const start = source.search(re);
  assert.ok(start >= 0, `actual ${name} exists`);
  const opening = source.indexOf(delimiter, start);
  const end = source.indexOf(`${delimiter};`, opening + delimiter.length);
  assert.ok(end > opening);
  return source.slice(start, end + delimiter.length + 1);
}
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const selected = (...countries) => ({mode:'selected',countries});

test('new current-rate API: fresh permission, source scope, exact rows and preserved fee text', async t => {
  const db = new PGlite();
  const scalar = async (query, args=[]) => Object.values((await db.query(query,args)).rows[0])[0];
  const asUser = async (n, role='authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n === null ? '' : uid(n)]);
    await db.exec(`set role ${role}`);
  };
  const rpc = request => scalar('select public.dashboard_admin_live_rates($1::jsonb)',[JSON.stringify(request ?? {})]);
  const queryAsOwner = async request => {await asUser(1);return rpc(request);};
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema private;
      grant usage on schema auth,public to anon,authenticated;
      grant usage on schema private to authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create table public.dashboard_profiles(auth_user_id uuid primary key,role text,active boolean,
        data_scope jsonb,permissions jsonb default '{}');
      create table public.dashboard_admin_preview_grants(auth_user_id uuid primary key,can_view boolean);
      create table public.third_party_rates(id text primary key,country text,third_party text,category text,
        collect_fee text,payout_fee text,total_fee text,collect_single_fee text,payout_single_fee text,
        collect_limit text,payout_limit text,status text,sheet_name text,source_row integer,updated_at timestamptz,
        leak text,whitelist text,channel_info text);
      create table public.third_party_platform_status(id text primary key,country text,platform text,third_party text,
        category text,collect_fee text,payout_fee text,total_fee text,collect_single_fee text,payout_single_fee text,
        collect_limit text,payout_limit text,status text,raw_status text,sheet_name text,source_row integer,
        source_column integer,updated_at timestamptz,raw jsonb);
      alter table public.third_party_rates enable row level security;
      alter table public.third_party_platform_status enable row level security;
    `);
    for(const name of ['dashboard_data_scope_valid','dashboard_data_group','dashboard_current_data_scope','dashboard_scope_allows']) {
      await db.exec(definition(scopeSql,name,'$function$'));
    }
    await db.exec(definition(liveSql,'dashboard_admin_live_scope','$$'));
    await db.exec('revoke all on function private.dashboard_admin_live_scope() from public,anon,authenticated');
    const profiles = [
      [1,'owner',true,{mode:'all',countries:[]}],
      [2,'viewer',true,selected('IN')],
      [3,'viewer',true,selected('IN')],
      [4,'admin',true,selected('BR_PANGHU')],
      [5,'viewer',false,selected('IN')],
      [6,'unsupported',true,selected('IN')],
      [7,'admin',true,selected('BR')],
      [8,'viewer',true,{mode:'selected',countries:['IN','not-real']}]
    ];
    for (const [n,role,active,scope] of profiles) {
      await db.query('insert into public.dashboard_profiles values($1,$2,$3,$4::jsonb,$5::jsonb)',
        [uid(n),role,active,JSON.stringify(scope),JSON.stringify({third_party:false})]);
      if(n !== 1 && n !== 3) await db.query('insert into public.dashboard_admin_preview_grants values($1,true)',[uid(n)]);
    }
    const countryRates = [
      ['in','印度','Alpha','standard','4.00%','3.00%','','','6','100-50000','200-50000'],
      ['tier-a','IN','TierPay','amount 100-499','0.78%-3.5/笔','3.5/笔','','0.00%','','100-499',''],
      ['tier-b','IN','TierPay','amount 500-999','2.00%','0..8%','','','','500-999',''],
      ['unknown-fee','IN','MissingFee','','',null,null,null,'','',''],
      ['literal','IN','Pay%Exact','','1%','2%','','','','',''],
      ['pk','PK','PakistanOnly','','5%','6%','','','','',''],
      ['br','BR','BrazilOnly','','1%','2%','','','','',''],
      ['panghu','胖虎巴西','PanghuOnly','','1%','2%','','','','',''],
      ['unknown-country','Unregistered','Unclassified','','1%','2%','','','','','']
    ];
    for (const row of countryRates) await db.query(`insert into public.third_party_rates
      (id,country,third_party,category,collect_fee,payout_fee,total_fee,collect_single_fee,payout_single_fee,collect_limit,payout_limit,
       status,sheet_name,source_row,updated_at,leak,whitelist,channel_info)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active','synthetic',1,'2026-09-23T01:00:00Z',
      'EXCLUDED_LEAK','EXCLUDED_IP','EXCLUDED_ACCOUNT')`, row);
    const platformRates = [
      ['in','IN','91CLUB','Alpha'],
      ['case','IN','91CLUB','alpha'],
      ['variant','IN','91CLUB','Alpha-QR'],
      ['pk','PK','POPZAR','PakistanOnly'],
      ['panghu','BR','776F','PanghuPlatform'],
      ['br','BR','26BET','BrazilPlatform']
    ];
    for(const row of platformRates) await db.query(`insert into public.third_party_platform_status
      (id,country,platform,third_party,category,collect_fee,payout_fee,status,raw_status,sheet_name,source_row,source_column,updated_at,raw)
      values($1,$2,$3,$4,'platform','3.50%','2.50%','active','source active','synthetic',2,3,
        '2026-09-23T02:00:00Z','{"secret":"EXCLUDED_RAW"}')`,row);
    for(let i=0;i<47;i++) await db.query(`insert into public.third_party_platform_status
      (id,country,platform,third_party,collect_fee) values($1,'IN','PAGE', $2,'1%')`,
      [`page-${String(i).padStart(2,'0')}`,`PagePay${String(i).padStart(2,'0')}`]);
    const before = await scalar(`select jsonb_build_object('rates',(select jsonb_agg(to_jsonb(r) order by id) from public.third_party_rates r),
      'platforms',(select jsonb_agg(to_jsonb(p) order by id) from public.third_party_platform_status p))`);
    await db.exec(sql);

    await t.test('authenticated grant is independent from old module permissions; owner needs no grant', async () => {
      await asUser(2);const r=await rpc();
      assert.ok(r.total>20); assert.equal(r.rows.length,20);
      assert.ok(r.rows.every(x=>x.scopeGroup==='IN'));
      assert.deepEqual(r.options.countries.map(x=>x.value),['IN']);
      assert.ok(!r.options.providers.includes('PakistanOnly'));
      assert.ok(!r.options.platforms.some(x=>x.value==='POPZAR'));
      const owner=await queryAsOwner({limit:500});
      assert.equal(owner.total,62);assert.equal(owner.rows.length,62);
      assert.equal(new Set(owner.options.countries.map(x=>x.value)).size,owner.options.countries.length);
    });
    await t.test('reject anonymous, missing subject/profile/grant, inactive and unsupported roles', async () => {
      await asUser(null,'anon');await assert.rejects(rpc(),/permission denied/);
      await asUser(null);await assert.rejects(rpc(),/login_required/);
      for(const n of [3,5,6,99]) {await asUser(n);await assert.rejects(rpc(),/preview_denied/);}
      await asUser(2);await assert.rejects(scalar('select private.dashboard_admin_live_scope()'),/permission denied/);
      await assert.rejects(scalar('select count(*) from public.third_party_rates'),/permission denied/);
    });
    await t.test('revocation and country-scope changes take effect on the next call', async () => {
      await asUser(2);assert.ok((await rpc()).total>0);
      await db.exec('reset role');await db.query('update public.dashboard_admin_preview_grants set can_view=false where auth_user_id=$1',[uid(2)]);
      await asUser(2);await assert.rejects(rpc(),/preview_denied/);
      await db.exec('reset role');await db.query('update public.dashboard_admin_preview_grants set can_view=true where auth_user_id=$1',[uid(2)]);
      await db.query('update public.dashboard_profiles set data_scope=$1::jsonb where auth_user_id=$2',[JSON.stringify(selected('PK')),uid(2)]);
      await asUser(2);const pk=await rpc();assert.equal(pk.total,2);assert.ok(pk.rows.every(r=>r.scopeGroup==='PK'));
      assert.deepEqual(pk.options.providers,['PakistanOnly']);
      assert.equal((await rpc({country:'IN'})).total,0);
      await db.exec('reset role');await db.query('update public.dashboard_profiles set data_scope=$1::jsonb where auth_user_id=$2',[JSON.stringify(selected('IN')),uid(2)]);
      await asUser(8);assert.equal((await rpc()).total,0);
    });
    await t.test('country generic fees cannot leak across Brazil/Panghu remapping', async () => {
      await asUser(4);const panghu=await rpc();
      assert.deepEqual(panghu.rows.map(x=>x.id).sort(),['country:panghu','platform:panghu']);
      assert.ok(panghu.rows.every(x=>x.scopeGroup==='BR_PANGHU'));
      await asUser(7);const br=await rpc();
      assert.deepEqual(br.rows.map(x=>x.id).sort(),['country:br','platform:br']);
    });
    await t.test('country/platform are separate records; raw provider equality does not merge aliases', async () => {
      const r=await queryAsOwner({provider:'Alpha'});
      assert.equal(r.total,2);assert.deepEqual(r.rows.map(x=>x.scopeType),['country','platform']);
      assert.deepEqual(r.rows.map(x=>x.collectFee),['4.00%','3.50%']);
      assert.equal(new Set(r.rows.map(x=>x.id)).size,2);
      assert.equal((await rpc({provider:'ALPHA'})).total,0);
      const p=await rpc({platform:'91CLUB',provider:'Alpha'});
      assert.equal(p.total,1);assert.equal(p.rows[0].scopeType,'platform');
      assert.equal((await rpc({scopeType:'country',platform:'91CLUB'})).total,0);
      const literal=await rpc({query:'%'});assert.equal(literal.total,1);assert.equal(literal.rows[0].provider,'Pay%Exact');
      assert.equal((await rpc({provider:"' OR 1=1 --"})).total,0);
    });
    await t.test('tiers, malformed/compound fees, blanks and unknowns retain source text with no estimate', async () => {
      const r=await queryAsOwner({provider:'TierPay'});
      assert.equal(r.total,2);assert.equal(r.rows[0].collectFee,'0.78%-3.5/笔');
      assert.equal(r.rows[0].payoutFee,'3.5/笔');assert.equal(r.rows[0].collectSingleFee,'0.00%');
      assert.equal(r.rows[1].payoutFee,'0..8%');assert.equal(r.rows[1].collectLimit,'500-999');
      const missing=(await rpc({provider:'MissingFee'})).rows[0];
      assert.equal(missing.collectFee,'');assert.equal(missing.payoutFee,null);assert.equal(missing.totalFee,null);
      assert.equal(r.basis,'current_rate_table');
      assert.deepEqual(r.capabilities,{historicalFeeVersions:false,feeEstimate:false,providerMatching:'exact_raw_name',tierHandling:'raw_not_averaged'});
    });
    await t.test('all allowed page sizes, exact totals, stable unique pagination and end behavior', async () => {
      await asUser(1);let ids=[];
      for(const offset of [0,20,40]) {
        const r=await rpc({platform:'PAGE',offset});
        assert.equal(r.total,47);assert.equal(r.hasMore,offset<40);
        assert.equal(r.rows.length,offset===40?7:20);ids.push(...r.rows.map(x=>x.id));
      }
      assert.equal(new Set(ids).size,47);
      for(const limit of [20,30,50,100,500]) assert.equal((await rpc({platform:'PAGE',limit})).rows.length,Math.min(limit,47));
      const end=await rpc({platform:'PAGE',offset:100});assert.deepEqual(end.rows,[]);assert.equal(end.total,47);assert.equal(end.hasMore,false);
      const empty=await rpc({provider:'unavailable'});assert.deepEqual(empty.rows,[]);assert.equal(empty.total,0);
    });
    await t.test('typed bounded allowlisted request rejects scope/user injection and bad paging', async () => {
      await asUser(1);
      for(const invalid of [{scopeType:'history'},{userId:uid(1)},{scope:{mode:'all'}},{provider:[]},{query:5},
        {country:'IN\nPK'},{limit:8},{limit:'20'},{limit:null},{offset:-1},{offset:1.5},{offset:1000001},{query:'x'.repeat(201)}]) {
        await assert.rejects(rpc(invalid),/invalid_/);
      }
      for(const value of ['null','[]','"text"']) await assert.rejects(scalar('select public.dashboard_admin_live_rates($1::jsonb)',[value]),/invalid_request/);
    });
    await t.test('projection excludes raw/contact/IP fields; no table mutation and pinned search_path', async () => {
      const r=await queryAsOwner({limit:500});const serialized=JSON.stringify(r);
      for(const forbidden of ['EXCLUDED_LEAK','EXCLUDED_IP','EXCLUDED_ACCOUNT','EXCLUDED_RAW','whitelist','channel_info']) assert.ok(!serialized.includes(forbidden));
      assert.deepEqual(Object.keys(r.rows[0]).sort(),['id','sourceId','scopeType','country','scopeGroup','platform','provider','category',
        'collectFee','payoutFee','totalFee','collectSingleFee','payoutSingleFee','collectLimit','payoutLimit',
        'status','rawStatus','sheetName','sourceRow','sourceColumn','updatedAt'].sort());
      await db.exec('reset role');
      const after=await scalar(`select jsonb_build_object('rates',(select jsonb_agg(to_jsonb(r) order by id) from public.third_party_rates r),
        'platforms',(select jsonb_agg(to_jsonb(p) order by id) from public.third_party_platform_status p))`);
      assert.deepEqual(after,before);
      const functions=(await db.query(`select n.nspname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on p.pronamespace=n.oid
        where p.proname='dashboard_admin_live_rates' order by n.nspname`)).rows;
      assert.deepEqual(functions.map(f=>[f.nspname,f.prosecdef]),[['private',true],['public',false]]);
      assert.ok(functions.every(f=>f.proconfig.includes('search_path=""')));
      assert.equal(await scalar("select has_function_privilege('anon','public.dashboard_admin_live_rates(jsonb)','EXECUTE')"),false);
      assert.equal(await scalar("select has_function_privilege('anon','private.dashboard_admin_live_rates(jsonb)','EXECUTE')"),false);
    });
  } finally {await db.close();}
});
