// Offline full-function PostgreSQL regression. No network or production writes.
const {test,before,after}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const fixture=path.join(__dirname,'admin-member-daily-single-group.test.cjs');
const patch=read('supabase/migrations/20261012045426_member_daily_constant_scan.sql');
const signature='private.dashboard_admin_live_member_daily(jsonb)';
const beforeHash='a782dac792de76230c0155c8000523a7',afterHash='e1c4a724f124658baa9863cc9f2811b1';
let db,ids,req,owner,viewer,baseline,metadataBefore,requests=[];
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const definition=()=>scalar('select pg_get_functiondef($1::regprocedure)',[signature]);
const hash=()=>scalar('select md5(prosrc) from pg_proc where oid=$1::regprocedure',[signature]);
const meta=()=>scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid=$1::regprocedure",[signature]);
const clone=(sql,name)=>sql.replace('FUNCTION private.dashboard_admin_live_member_daily(',`FUNCTION private.${name}(`);
async function same(q){
 const r=(await db.query('select private.member_daily_reference($1::jsonb) reference,private.dashboard_admin_live_member_daily($1::jsonb) candidate',[JSON.stringify(q)])).rows[0];
 assert.deepEqual(r.candidate,r.reference,JSON.stringify(q));return r.candidate;
}
before(async()=>{
 let setup;const nativeRequire=createRequire(fixture);
 const ctx=vm.createContext({require:n=>n==='node:test'?{test(){},before:fn=>setup=fn,after(){}}:nativeRequire(n),__dirname,process,console,structuredClone});
 vm.runInContext(fs.readFileSync(fixture,'utf8')+'\nglobalThis.nativeFixture={get db(){return db},ids,req,owner,viewer};',ctx,{filename:fixture});
 await setup();({db,ids,req,owner,viewer}=ctx.nativeFixture);
 assert.equal(await hash(),'477dc1efd988b2985032974976299ce5');
 // Apply only the existing KB source insertion to reconstruct the exact live
 // baseline; do not weaken or rewrite the production hash guard for the test.
 const yash=read('supabase/migrations/20261009044023_yash_live_readers.sql');
 const section=yash.slice(yash.indexOf("select * into strict p from pg_proc where oid='private.dashboard_admin_live_member_daily(jsonb)'"));
 const anchors=section.match(/\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$/);
 assert.ok(anchors);const d=await definition();assert.equal(d.split(anchors[1]).length,2);
 await db.exec(d.replace(anchors[1],()=>anchors[2]));assert.equal(await hash(),beforeHash);
 baseline=await definition();metadataBefore=await meta();
 await db.exec(clone(baseline,'member_daily_reference'));
 await db.exec('revoke all on function private.member_daily_reference(jsonb) from public,anon,authenticated');
 const extras=[{}, {providers:[]},{providers:null},{providers:['CombinedPay']},{providers:['route-a']},{providers:['missing']},
  {currency:'INR'},{currency:'USDT'},{currency:'XXX'},
  {startAt:'2026-10-02T00:00:00+05:30',endAt:'2026-10-03T00:00:00+05:30'},
  {startAt:'2026-10-02T00:30:00+05:30',endAt:'2026-10-02T02:00:00+05:30'},
  {startAt:'2026-10-05T00:00:00+05:30',endAt:'2026-10-06T00:00:00+05:30'}];
 for(const platformId of Object.values(ids))for(const direction of ['all','charge','withdraw'])for(const extra of extras)requests.push(req({platformId,direction,...extra}));
 await db.exec(patch);assert.equal(await hash(),afterHash);
});
after(()=>db?.close());

test('all 216 full JSON replies preserve sources, clocks, providers, currencies, empty and partial ranges',async()=>{
 assert.equal(requests.length,216);
 for(const q of requests)await same(q);
 assert.deepEqual(await meta(),metadataBefore);
});
test('whole-day identities and cumulative frequencies are never summed from hourly distinct counts',async()=>{
 const rows=(await same(req())).rows,r=rows.find(x=>x.date==='2026-10-02'&&x.direction==='charge');
 assert.equal(r.created_member_count,6);assert.equal(r.success_member_count,6);
 assert.equal(r.created_order_count,18);assert.equal(r.success_order_count,18);
 assert.equal(r.created_missing_member_count,2);assert.equal(r.success_missing_member_count,2);
 for(const basis of ['created','success'])assert.deepEqual([2,3,4,5].map(n=>r[basis+'_members_ge'+n]),[4,3,2,1]);
 assert.equal(rows.find(x=>x.date==='2026-10-01'&&x.direction==='charge').success_member_count,6);
 assert.equal(rows.find(x=>x.date==='2026-10-03'&&x.direction==='withdraw').success_order_count,15);
 assert.doesNotMatch(JSON.stringify(rows),/member_id|CONFIRMED|NULL-ID/);
});
async function capture(sql,name,key){
 const anchor='  execute v_sql into v_rows using ';
 assert.equal(sql.split(anchor).length,2);
 await db.exec(clone(sql.replace(anchor,`  perform set_config('${key}',v_sql,false);\n  return '{}'::jsonb;\n`+anchor),name));
 await db.exec(`revoke all on function private.${name}(jsonb) from public,anon,authenticated`);
}
test('runtime SQL changes only unfiltered AR and exposes four independent literal kind/status scans',async()=>{
 await capture(baseline,'member_daily_reference_capture','test.member_reference');
 await capture(await definition(),'member_daily_candidate_capture','test.member_candidate');
 for(const source of ['ar','newar','lg','game','foreign'])for(const direction of ['all','charge','withdraw'])for(const providers of [undefined,[],['CombinedPay']]){
  const q=req({platformId:ids[source],direction,...(providers===undefined?{}:{providers})});
  await db.query('select private.member_daily_reference_capture($1::jsonb),private.member_daily_candidate_capture($1::jsonb)',[JSON.stringify(q)]);
  const old=await scalar("select current_setting('test.member_reference')"),next=await scalar("select current_setting('test.member_candidate')");
  if(['ar','foreign'].includes(source)&&!providers?.length){
   assert.notEqual(next,old);assert.equal((next.match(/from public.ar_collected_orders a/g)||[]).length,4);
   assert.match(next,/a.order_kind='recharge'/);assert.match(next,/a.order_kind='withdraw'/);
   assert.match(next,/and a.status='已支付'/);assert.match(next,/and a.status='已通过'/);
   assert.doesNotMatch(next,/raw_channel|order_no|btrim\(a\./);
   assert.match(next,/group by date,direction,member_id/);
  }else assert.equal(next,old,source+' provider-filtered or non-AR SQL is byte-identical');
 }
 // NEWAR launch and successful-event semantics stay untouched, not folded onto
 // a created-time lower bound. Existing pre-launch fixture N5 remains excluded.
 const body=await scalar('select prosrc from pg_proc where oid=$1::regprocedure',[signature]);
 assert.equal(body.slice(body.indexOf("    elsif v_platform.source='newar' then")),baseline.slice(baseline.indexOf("    elsif v_platform.source='newar' then"),baseline.lastIndexOf('$function$')));
});
test('request caps, fresh profile/preview auth and platform denials match the complete baseline',async()=>{
 async function denied(q,pattern){
  const errors=[];
  for(const fn of ['private.member_daily_reference','private.dashboard_admin_live_member_daily']){
   try{await db.query(`select ${fn}($1::jsonb)`,[JSON.stringify(q)]);assert.fail('unexpected success');}
   catch(e){assert.match(e.message,pattern);errors.push([e.code,e.message]);}
  }assert.deepEqual(errors[0],errors[1]);
 }
 for(const extra of [{basis:'success'},{cohort:'success'},{status:'success'},{direction:'bad'},{providers:Array(201).fill('x')},
  {startAt:'2026-10-01T00:00:00Z',endAt:'2026-11-02T00:00:00Z'}])await denied(req(extra),/invalid_request|invalid_direction|invalid_filter|invalid_range/);
 try{
  await db.query("select set_config('test.uid',$1,false)",[viewer]);
  await denied(req({platformId:ids.newar}),/platform_denied/);
  await db.exec('update dashboard_admin_preview_grants set can_view=false');
  await denied(req(),/preview_denied/);
  await db.exec('update dashboard_admin_preview_grants set can_view=true');
  await db.exec(`update dashboard_profiles set active=false where auth_user_id='${viewer}'`);
  await denied(req(),/preview_denied/);
 }finally{
  await db.exec('update dashboard_admin_preview_grants set can_view=true;update dashboard_profiles set active=true');
  await db.query("select set_config('test.uid',$1,false)",[owner]);
 }
 assert.equal(await scalar("select has_function_privilege('anon',$1,'EXECUTE')",[signature]),false);
 assert.equal(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')",[signature]),true);
});
test('idempotence, exact source/config/ACL drift guards and rollback preserve original metadata',async()=>{
 await db.exec(patch);assert.equal(await hash(),afterHash);assert.deepEqual(await meta(),metadataBefore);
 const inner=patch.replace(/^begin;/m,'').replace(/^commit;/m,'');
 for(const drift of ["alter function private.dashboard_admin_live_member_daily(jsonb) set statement_timeout='20s'",
  'grant execute on function private.dashboard_admin_live_member_daily(jsonb) to anon',
  'alter function private.dashboard_admin_live_member_daily(jsonb) cost 101']){
  await db.exec('begin;'+drift+';');
  await assert.rejects(()=>db.exec(inner),/metadata changed/);
  await db.exec('rollback');assert.deepEqual(await meta(),metadataBefore);
 }
 await db.exec('begin');
 await db.exec(baseline.replace('begin\n','begin\n  -- unexpected drift\n'));
 await assert.rejects(()=>db.exec(inner),/production body changed/);await db.exec('rollback');
 await db.exec(baseline);assert.equal(await hash(),beforeHash);assert.deepEqual(await meta(),metadataBefore);
 for(const q of requests)await same(q);
 await db.exec(patch);assert.equal(await hash(),afterHash);
});
test('candidate has no indexes, data mutations, auth changes, new helpers or altered role timeouts',()=>{
 assert.doesNotMatch(patch,/\b(create table|alter table|create index|delete from|update public\.|insert into|grant execute|revoke all|alter role)\b/i);
 assert.match(patch,/after_metadata is distinct from before_metadata/);
 assert.match(patch,/pg_catalog.md5\(p.prosrc\)<>'a782dac792de76230c0155c8000523a7'/);
});
