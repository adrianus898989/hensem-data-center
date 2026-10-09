// Synthetic local ingestion plus the current signed role gateway. No production data or network.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const filename=path.join(__dirname,'dashboard-roles-sql.test.cjs'),req=createRequire(filename);
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const baseline=JSON.parse(read('tests/fixtures/yash-channel-reader-production-functions.json'));
const migration=read('supabase/migrations/20261009050532_yash_channel_status_reader.sql');
let f,id,metadata;
const direct=(p={})=>f.scalar('select public.dashboard_admin_live_channel_status($1::jsonb)',[JSON.stringify({platformIds:[id],...p})]);
const execute=(p={})=>f.execute('channel_status',{action:'channelStatus',platformIds:[id],...p});
const snapshot=(kind,records,observed='2026-10-08T01:00:00Z')=>f.scalar('select public.yash_channel_ingest($1,$2::jsonb)',['synthetic-hash',JSON.stringify({action:'channels',schema_version:1,snapshot_id:'00000000-0000-4000-8000-000000000001',order_type:kind,observed_at:observed,source_count:records.length,fetched_count:records.length,records})]);
const channel=(id,extra={})=>({channel_id:id,channel_name:'Synthetic '+id,provider:'OnePay',channel_type:'UPI',payment_method:'QR',min_amount:'100.00',max_amount:'5000.00',limit_currency:'INR',success_rate_10m:'0',success_rate_today:'52.25',balance:'42.10',balance_currency:'USDT',priority:3,weight:100,status_text:'启用',enabled:true,notes:null,...extra});
async function transaction(fn){await f.admin();await f.db.exec('begin');try{return await fn();}finally{await f.db.exec('rollback');await f.admin();}}
async function denied(fn,pattern=/denied|required|permission/){await f.db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await f.db.exec('rollback to savepoint denied');}}
before(async()=>{
 let setup;const c={require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){},beforeEach(){},afterEach(){}}:req(n),__dirname,process,console,structuredClone};vm.createContext(c);
 vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.fixture={get db(){return db},as,admin,scalar,manage,granted,execute,access,OWNER,ADMIN,VIEWER,LEGACY};',c,{filename});await setup();f=c.fixture;
 await f.db.exec(`set check_function_bodies=off;
 create function private.application_current_session_allowed(text) returns boolean language sql stable as $$select coalesce(nullif(current_setting('test.application_session',true),''),'true')='true'$$;
 create function private.dashboard_scope_allows(s jsonb,c text,p text) returns boolean language sql immutable as $$select coalesce(s->>'mode'='all' or s->'platforms'?p,false)$$;
 create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text)
 language plpgsql stable security definer set search_path='' as $$declare s jsonb:=private.dashboard_admin_live_scope();begin return query select md5('kb:IN:YASH.BET')::uuid,'YASH.BET'::text,'M8'::text,'印度'::text,'IN'::text,'kb'::text,'Asia/Kolkata'::text,'INR'::text,'YASH.BET'::text where private.dashboard_scope_allows(s,'IN','YASH.BET');end$$;
 create table private.yash_ingest_credentials(token_hash text primary key,revoked_at timestamptz,expires_at timestamptz);
 insert into private.yash_ingest_credentials values('synthetic-hash',null,'2999-01-01');
 update dashboard_profiles set data_scope='{"mode":"selected","countries":["IN"],"platforms":["YASH.BET"]}' where username='admin';
 `);
 for(const x of baseline){await f.db.exec(x.definition);await f.db.exec(`revoke all on function ${x.signature} from public,anon,authenticated,service_role;`);if(x.acl.includes('authenticated='))await f.db.exec(`grant execute on function ${x.signature} to authenticated;`);}
 await f.db.exec(read('supabase/migrations/20261009050436_yash_channel_snapshots.sql'));
 metadata=await f.scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') from pg_proc p where oid=any($1::regprocedure[])",[baseline.map(x=>x.signature)]);
 await f.db.exec(migration);id=await f.scalar("select md5('kb:IN:YASH.BET')::uuid");
 await snapshot('deposit',[channel('D1'),channel('D2',{provider:'TwoPay',enabled:false,status_text:'停用',priority:null,success_rate_today:null,balance:'123.45',balance_currency:null})]);
});
after(async()=>f?.db.close());
test('current source rates, nullable status/amount and independent currencies are preserved without aggregation',async()=>transaction(async()=>{
 await f.as(f.OWNER);const r=await direct();assert.equal(r.version,1);assert.equal(r.basis,'source_channel_snapshot');assert(r.queriedAt);assert.equal(r.platforms[0].capabilities.channelStatusAvailable,true);
 assert.equal(r.snapshots.length,2);const d=r.snapshots.find(x=>x.direction==='charge'),w=r.snapshots.find(x=>x.direction==='withdraw');assert.equal(d.complete,true);assert.equal(d.sourceCount,2);assert.equal(d.channels.length,2);
 const a=d.channels.find(x=>x.channel_id==='D1'),b=d.channels.find(x=>x.channel_id==='D2');assert.equal(a.success_rate_10m,0);assert.equal(a.success_rate_today,52.25);assert.equal(a.success_rate_1h,null);assert.equal(a.balance_currency,'USDT');assert.equal(a.limit_currency,'INR');assert.equal(a.balance,42.1);assert.equal(b.success_rate_today,null);assert.equal(b.enabled,false);assert.equal(b.balance,123.45);assert.equal(b.balance_currency,null);assert(!('payload_hash'in a));
 assert.equal(w.observedAt,null);assert.equal(w.sourceCount,null);assert.equal(w.complete,false);assert.deepEqual(w.channels,[]);
}));
test('direction/provider filters do not change whole-snapshot completeness, disappeared channels remain explicitly marked',async()=>transaction(async()=>{
 await snapshot('deposit',[channel('D1')],'2026-10-08T02:00:00Z');await f.as(f.OWNER);
 const r=await direct({direction:'charge',providers:['TwoPay']});assert.equal(r.snapshots.length,1);const s=r.snapshots[0];assert.equal(s.complete,true);assert.equal(s.sourceCount,1);assert.equal(s.channels.length,1);assert.equal(s.channels[0].is_present,false);assert.equal(Date.parse(s.channels[0].last_seen_at),Date.parse('2026-10-08T01:00:00Z'));
 const empty=await direct({providers:['AbsentPay'],direction:'charge'});assert.equal(empty.snapshots[0].complete,true);assert.deepEqual(empty.snapshots[0].channels,[]);
}));
test('full empty receipt is zero while missing or incoherent snapshots never claim completeness',async()=>transaction(async()=>{
 await snapshot('withdrawal',[]);await f.as(f.OWNER);const z=(await direct({direction:'withdraw'})).snapshots[0];assert.equal(z.sourceCount,0);assert.equal(z.complete,true);assert.deepEqual(z.channels,[]);
 await f.admin();await f.db.exec("update private.yash_channel_sync_state set source_count=9 where order_type='deposit'");await f.as(f.OWNER);assert.equal((await direct({direction:'charge'})).snapshots[0].complete,false);
}));
test('native platform scope plus owner/assigned policy cannot be bypassed by public/private/direct/legacy calls',async()=>transaction(async()=>{
 await f.as(f.OWNER);await denied(()=>direct({platformIds:['00000000-0000-4000-8000-000000000001']}),/platform_denied/);
 await f.as(f.LEGACY);await denied(()=>direct(),/channel_status_role_denied/);
 await f.granted(f.ADMIN,['channel_status.view','channel_status.query']);assert.equal((await execute()).snapshots.length,2);
 await denied(()=>direct(),/role_gateway_required/);await denied(()=>f.scalar('select private.dashboard_admin_live_channel_status($1::jsonb)',[JSON.stringify({platformIds:[id]})]),/permission denied/);
 await f.granted(f.VIEWER,['channel_status.view','channel_status.query']);await denied(()=>execute(),/platform_denied/);
}));
test('page grants are separate, view does not permit data query and unrelated actions cannot borrow this page',async()=>transaction(async()=>{
 await f.granted(f.ADMIN,['providers.view','providers.query']);await denied(()=>execute(),/page_action_denied/);
 await f.granted(f.VIEWER,['channel_status.view']);assert.equal((await f.execute('channel_status',{action:'catalog'})).context,true);await denied(()=>execute(),/role_permission_denied/);
 for(const action of ['aggregate','details','query','rates','configurationWrite'])await denied(()=>f.execute('channel_status',{action}),/page_action_denied/);
}));
test('fresh role/session/profile revocation and forged gateway context cannot leak a snapshot',async()=>transaction(async()=>{
 const role=await f.granted(f.ADMIN,['channel_status.view','channel_status.query']);assert.equal((await execute()).snapshots[0].sourceCount,2);
 await f.db.query("select set_config('hensem.dashboard_role_context',$1,true)",[JSON.stringify({payload:{page:'channel_status',rpc:'dashboard_admin_live_channel_status',uid:f.ADMIN},signature:'forged'})]);await denied(()=>direct(),/role_gateway_required/);
 await f.as(f.OWNER);await f.manage({operation:'update',roleId:role.id,expectedVersion:1,permissions:['channel_status.view']});await f.as(f.ADMIN);await denied(()=>execute(),/role_permission_denied/);
 await f.as(f.OWNER);await f.db.exec("select set_config('test.application_session','false',true)");await denied(()=>direct(),/application_session_denied/);
}));
test('strict server validation rejects malformed or injected requests before data access',async()=>transaction(async()=>{
 await f.as(f.OWNER);for(const p of [{platformIds:[]},{platformIds:[id,id]},{platformIds:[{}]},{platformIds:['bad']},{direction:null},{direction:'deposit'},{providers:null},{providers:['bad\nname']},{providers:[' duplicate','duplicate']},{providers:['X','X']},{startAt:'2026-10-07'},{country:'IN'},{action:'channelStatus'}])await denied(()=>direct(p),/invalid_|duplicate_/);
}));
test('catalog matches UI, existing ACL/metadata are unchanged, and helpers/tables remain inaccessible',async()=>transaction(async()=>{
 await f.admin();const after=await f.scalar("select jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') from pg_proc p where oid=any($1::regprocedure[])",[baseline.map(x=>x.signature)]);assert.deepEqual(after,metadata);
 const catalog=await f.scalar('select private.dashboard_role_catalog()');assert.deepEqual(catalog.pages,JSON.parse(read('src/lib/dashboardRoleCatalog.json')).pages);assert(!catalog.pages.some(x=>x.id==='channelquality'));
 for(const r of ['anon','authenticated','service_role'])assert.equal(await f.scalar("select has_function_privilege($1,'private.dashboard_admin_live_channel_status(jsonb)','execute')",[r]),false);
 for(const r of ['anon','service_role'])assert.equal(await f.scalar("select has_function_privilege($1,'public.dashboard_admin_live_channel_status(jsonb)','execute')",[r]),false);
 for(const r of ['anon','authenticated'])assert.equal(await f.scalar("select has_table_privilege($1,'private.yash_channels','select')",[r]),false);
}));
