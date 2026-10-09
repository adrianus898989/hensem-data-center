const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs,root}=require('./load-typescript.cjs');
const {createArMiddleChannelIngestHandler,validateArMiddleChannelRequest,AR_MIDDLE_ORIGIN,MAX_AR_MIDDLE_BYTES}=loadTs(path.join(root,'supabase/functions/ar-middle-channel-ingest/handler.ts'));
const sql=fs.readFileSync(path.join(root,'supabase/ar-middle-channel-contract.sql'),'utf8');
const native=require('./fixtures/ar-middle-native-registry.json'),catalog=require('./fixtures/ar-middle-catalog-baseline.json');
const token='synthetic_ar_middle_scoped_token_'+ 'x'.repeat(40),hash=createHash('sha256').update(token).digest('hex');
const at='2026-10-07T00:00:00Z',later='2026-10-07T00:10:00Z',latest='2026-10-07T00:20:00Z',now=Date.parse('2026-10-09T06:00:00Z');
const veer='dba5345b-e924-e014-5bda-f4abc8895925',okwin='43766f8a-87dd-8aab-e8c7-9d4853cdbca2',yash='259d53b1-0000-4000-8000-000000000001';
const clone=x=>JSON.parse(JSON.stringify(x));let db;
const record=(id='same-native-id',extra={})=>({channel_id:id,channel_name:'Synthetic channel',provider:'SyntheticPay',channel_type:null,payment_method:null,category_id:'category-1',category_name:'UPI',min_amount:'100',max_amount:'9999.12345678',limit_currency:null,balance:'-1.12345678',balance_currency:'USDT',success_rate_15m:'0',success_rate_30m:'68.4',success_rate_1h:null,priority:0,weight:'1.25',source_position:0,source_state:'0',source_channel_state:'1',source_merchant_state:'0',sys_channel_id:'sys-1',third_pay_merchant_id:'merchant-native-id',status_text:'state=0; channelState=1',enabled:null,fee_rate:'0.025',fee_rate_basis:'source_raw',fee_amount:'1.5',source_updated_at:at,notes:null,...extra});
function snapshot(extra={}){const digest=createHash('md5').update(extra.captured_at||at).digest('hex'),id=`${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20)}`;const q={action:'channels',schema_version:1,source:'ar_middle',source_origin:AR_MIDDLE_ORIGIN,source_tenant_id:'1102',snapshot_id:id,captured_at:at,directions:['deposit','withdrawal'].map(order_type=>({order_type,observed_at:at,source_count:1,fetched_count:1,complete:true,page_count:1,records:[record()]})),...extra};return q;}
const request=(data,headers={},options={})=>new Request('https://synthetic/functions/v1/ar-middle-channel-ingest',{method:'POST',headers:{'X-Collector-Key':token,'Content-Type':'application/json',...headers},body:typeof data==='string'?data:JSON.stringify(data),...options});
const call=async(q,key=hash)=>(await db.query('select public.ar_middle_channel_ingest($1,$2::jsonb) result',[key,JSON.stringify(q)])).rows[0].result;
const rows=async()=>(await db.query('select source_tenant_id,order_type,channel_id,channel_data,is_present,snapshot_id,observed_at,first_seen_at,last_seen_at,config_changed_at from private.ar_middle_channels order by source_tenant_id,order_type,channel_id')).rows;
const read=async(extra={})=>(await db.query('select public.dashboard_admin_live_channel_status($1::jsonb) result',[JSON.stringify({platformIds:[veer],...extra})])).rows[0].result;
const setting=async(k,v)=>db.query('select set_config($1,$2,false)',[k,v]);
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;grant usage on schema private to service_role;set check_function_bodies=off;
 create table public.ar_config_targets(country_code text,platform text,source_system text);grant select on public.ar_config_targets to service_role;
 create table private.collector_platform_identities(platform_id uuid,source_system text,country_code text,source_platform text);
 create function private.dashboard_admin_live_scope() returns jsonb language plpgsql stable as $$begin
  if current_setting('test.session',true)='denied' then raise exception 'application_session_denied';end if;
  if current_setting('test.gateway',true)='denied' then raise exception 'role_gateway_required';end if;
  return '{}'::jsonb;end$$;
 create function private.dashboard_role_access() returns jsonb language sql stable as $$select jsonb_build_object('mode',coalesce(nullif(current_setting('test.mode',true),''),'owner'),'canView',current_setting('test.view',true) is distinct from 'denied')$$;
 create function private.dashboard_admin_live_platforms() returns table(id uuid,name text,team text,country text,scope_group text,source text,timezone text,currency text,source_name text) language sql stable as $$
  select i.platform_id,i.source_platform,'M8'::text,i.country_code,i.country_code,'ar'::text,'Asia/Kolkata'::text,null::text,i.source_platform from private.collector_platform_identities i where i.source_platform is distinct from current_setting('test.hidden',true)
  union all select md5('kb:IN:YASH.BET')::uuid,'YASH.BET','M8','印度','IN','kb','Asia/Kolkata','INR','YASH.BET'$$;
 create function private.dashboard_admin_live_channel_status(p_request jsonb) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('version',1,'platforms',jsonb_build_array(jsonb_build_object('id',md5('kb:IN:YASH.BET')::uuid,'source','kb','capabilities',jsonb_build_object('channelStatusAvailable',true))),'snapshots',jsonb_build_array(jsonb_build_object('platformId',md5('kb:IN:YASH.BET')::uuid,'direction','charge','observedAt',null,'channels','[]'::jsonb)))$$;
 create function public.dashboard_admin_live_channel_status(p_request jsonb) returns jsonb language sql stable security definer set search_path='' as $$select private.dashboard_admin_live_channel_status(p_request)$$;
 `);
 for(const n of native){await db.query('insert into public.ar_config_targets values($1,$2,$3)',[n.country_code,n.source_platform,n.source_system]);await db.query('insert into private.collector_platform_identities values($1,$2,$3,$4)',[n.platform_id,n.source_system,n.country_code,n.source_platform]);}
 await db.exec(catalog[0].definition);await db.exec('revoke all on function private.dashboard_admin_live_query_raw(jsonb) from public,anon,authenticated,service_role');
 await db.exec(sql);await db.query("insert into private.ar_middle_channel_ingest_credentials(token_hash,source_origin,allowed_tenant_ids,label,expires_at) values($1,$2,array['1102','1013','1001'],'synthetic',now()+interval '1 day')",[hash,AR_MIDDLE_ORIGIN]);
});
beforeEach(async()=>{await db.exec('truncate private.ar_middle_channels,private.ar_middle_channel_sync_state');for(const k of ['test.session','test.gateway','test.mode','test.view','test.hidden'])await setting(k,'');});
after(async()=>db?.close());

test('40 verified IDs bind existing native catalog tuples; unsupported pop and historical aliases mint no identity',async()=>{
 const bindings=(await db.query('select * from private.ar_middle_channel_platforms')).rows;assert.equal(bindings.length,40);assert.equal(new Set(bindings.map(x=>x.dashboard_platform_id)).size,40);assert(!bindings.some(x=>x.source_tenant_id==='1040'||x.native_platform==='POPBRA'));
 for(const [tenant,name] of [['1102','Veer.Game'],['1013','OKWIN'],['1001','82LOTTERY'],['1101','Shree.Win'],['1045','55FIVE'],['1099','92.GAME']])assert.equal(bindings.find(x=>x.source_tenant_id===tenant).native_platform,name);
 const definition=(await db.query("select pg_get_functiondef('private.dashboard_admin_live_query_raw(jsonb)'::regprocedure) d")).rows[0].d;
 assert.match(definition,/private\.ar_middle_channel_capabilities\(\(p->>'id'\)::uuid\)/);assert.match(definition,/private\.dashboard_admin_yash_capabilities\(\)/);
 assert.deepEqual((await db.query('select private.ar_middle_channel_capabilities($1) result',[veer])).rows[0].result,{channelStatusAvailable:true,channelStatusSource:'ar_middle'});
});
test('scoped independent credentials, RLS and grants reject source substitution, revocation and tenant borrowing',async()=>{
 for(const role of ['anon','authenticated']){assert.equal((await db.query("select has_function_privilege($1,'public.ar_middle_channel_ingest(text,jsonb)','execute') ok",[role])).rows[0].ok,false);for(const name of ['ar_middle_channels','ar_middle_channel_sync_state','ar_middle_channel_platforms','ar_middle_channel_ingest_credentials'])assert.equal((await db.query('select has_table_privilege($1,$2,\'select\') ok',[role,'private.'+name])).rows[0].ok,false);}
 assert.equal((await db.query("select bool_and(relrowsecurity) ok from pg_class where relname like 'ar_middle_channel%' and relkind='r'")).rows[0].ok,true);
 assert.equal((await call({action:'check',source:'ar_middle',source_origin:AR_MIDDLE_ORIGIN})).action_scope,'channels');
 await assert.rejects(()=>call(snapshot(),'b'.repeat(64)),/UNAUTHORIZED/);await assert.rejects(()=>call(snapshot({source:'yash'})),/SCOPE_DENIED/);await assert.rejects(()=>call(snapshot({source_tenant_id:'1040'})),/UNAUTHORIZED/);
 await db.query('update private.ar_middle_channel_ingest_credentials set revoked_at=now() where token_hash=$1',[hash]);await assert.rejects(()=>call(snapshot()),/UNAUTHORIZED/);await db.query('update private.ar_middle_channel_ingest_credentials set revoked_at=null where token_hash=$1',[hash]);
 await db.exec('set role service_role');try{assert.equal((await call(snapshot())).snapshot_applied,true);}finally{await db.exec('reset role');}
});
test('tenant and direction are independent keys, exact decimals and null currencies/statuses survive one atomic publication',async()=>{
 await call(snapshot());await call(snapshot({source_tenant_id:'1013'}));const saved=await rows();assert.equal(saved.length,4);assert.equal(saved[0].channel_data.weight,'1.25');assert.equal(saved[0].channel_data.balance,'-1.12345678');assert.equal(saved[0].channel_data.limit_currency,null);assert.equal(saved[0].channel_data.enabled,null);assert.equal(saved[0].channel_data.success_rate_15m,'0');assert.equal(saved[0].channel_data.success_rate_30m,'68.4');assert.equal(saved[0].channel_data.fee_rate,'0.025');
 const state=(await db.query('select source_tenant_id,count(distinct snapshot_id) n,count(*) directions from private.ar_middle_channel_sync_state group by 1')).rows;assert(state.every(x=>x.n===1&&x.directions===2));
});
test('older collectors retain category fields; complete categories and actual system names survive edge, storage and reader without sorting or fallback',async()=>{
 const old=validateArMiddleChannelRequest(snapshot(),now);await call(old);for(const s of (await read()).snapshots){assert.equal(s.channels[0].category_id,'category-1');assert.equal(s.channels[0].category_name,'UPI');assert(!('channel_categories'in s.channels[0]));assert(!('source_channel_name'in s.channels[0]));}
 const categories=[{category_id:'category-2',category_name:'Manual pay',sort:20},{category_id:'category-1',category_name:'UPI',sort:-2},{category_id:'category-3',category_name:null,sort:null}];
 const q=snapshot({captured_at:later});q.directions.forEach(d=>{d.observed_at=later;Object.assign(d.records[0],{channel_name:'Merchant custom name',provider:'Third-party merchant',source_channel_name:d.order_type==='deposit'?'Actual system channel':null,channel_categories:clone(categories)});});
 const h=createArMiddleChannelIngestHandler({env:{SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-secret'},now:()=>now,fetch:async(_url,init)=>{const p=JSON.parse(init.body);return Response.json(await call(p.p_request,p.p_token_hash));}});
 const result=await h(request(q));assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true,source:'ar_middle',accepted:2,source_count:2,snapshot_applied:true,snapshot_id:q.snapshot_id});
 for(const s of (await read()).snapshots){const r=s.channels[0];assert.deepEqual(r.channel_categories,categories);assert.equal(r.source_channel_name,s.direction==='charge'?'Actual system channel':null);assert.equal(r.channel_name,'Merchant custom name');assert.equal(r.provider,'Third-party merchant');assert.equal(r.sys_channel_id,'sys-1');assert.equal(r.category_id,'category-1');assert.equal(r.category_name,'UPI');}
 const replay=await h(request(q));assert.equal((await replay.json()).snapshot_applied,true);assert((await rows()).every(r=>r.config_changed_at.toISOString()===new Date(later).toISOString()));
});
test('optional categories support empty or unknown values and bounded native labels and signed source sort values',async()=>{
 const q=snapshot();Object.assign(q.directions[0].records[0],{source_channel_name:'N'.repeat(200),channel_categories:[{category_id:'I'.repeat(200),category_name:'C'.repeat(200),sort:-2147483648},{category_id:'other',category_name:null,sort:2147483647}]});Object.assign(q.directions[1].records[0],{source_channel_name:null,channel_categories:null});
 await call(validateArMiddleChannelRequest(q,now));assert.deepEqual((await read()).snapshots.find(s=>s.direction==='charge').channels[0].channel_categories,q.directions[0].records[0].channel_categories);assert.equal((await read()).snapshots.find(s=>s.direction==='withdraw').channels[0].channel_categories,null);
 const r=snapshot({captured_at:later});r.directions.forEach(d=>{d.observed_at=later;d.records[0].channel_categories=[];d.records[0].source_channel_name=null;});await call(validateArMiddleChannelRequest(r,now));assert((await read()).snapshots.every(s=>s.channels[0].channel_categories.length===0&&s.channels[0].source_channel_name===null));
 const full=Array.from({length:1000},(_,i)=>({category_id:String(i),category_name:null,sort:i}));const clean=(await db.query('select private.ar_middle_channel_clean_record($1::jsonb) result',[JSON.stringify(record('large-categories',{channel_categories:full}))])).rows[0].result;assert.equal(clean.channel_categories.length,1000);const edge=snapshot();edge.directions[0].records[0].channel_categories=full;assert.equal(validateArMiddleChannelRequest(edge,now).directions[0].records[0].channel_categories.length,1000);
 full.push({category_id:'overflow',category_name:null,sort:null});assert.throws(()=>validateArMiddleChannelRequest(edge,now),/invalid_request/);await assert.rejects(()=>db.query('select private.ar_middle_channel_clean_record($1::jsonb)',[JSON.stringify(record('large-categories',{channel_categories:full}))]),/INVALID_CATEGORIES/);
});
test('invalid or secret-bearing category fields in the second direction reject at edge and SQL and retain both previous directions',async()=>{
 await call(snapshot());const prior=await rows(),state=(await db.query('select * from private.ar_middle_channel_sync_state order by order_type')).rows;
 const mutations=[r=>r.source_channel_name=false,r=>r.source_channel_name='x'.repeat(201),r=>r.source_channel_name='https://source.example/?token=secret',r=>r.source_channel_name='Token = secret',r=>r.source_channel_name='data:private',r=>r.source_channel_name=' native ',r=>r.source_channel_name='<b>native</b>',r=>r.source_channel_name='native\u0001',r=>r.channel_categories={},r=>r.channel_categories=[null],r=>r.channel_categories=['native'],r=>r.channel_categories[0].icon='https://source.example/private',r=>delete r.channel_categories[0].sort,r=>delete r.channel_categories[0].category_name,r=>delete r.channel_categories[0].category_id,r=>r.channel_categories.push(clone(r.channel_categories[0])),r=>r.channel_categories[0].category_id=null,r=>r.channel_categories[0].category_id='',r=>r.channel_categories[0].category_id='x'.repeat(201),r=>r.channel_categories[0].category_id='ftp://source.example/private',r=>r.channel_categories[0].category_name=1,r=>r.channel_categories[0].category_name='',r=>r.channel_categories[0].category_name='x'.repeat(201),r=>r.channel_categories[0].category_name='https://source.example/?token=secret',r=>r.channel_categories[0].category_name='password:secret',r=>r.channel_categories[0].category_name='javascript:private',r=>r.channel_categories[0].category_name='<b>UPI</b>',r=>r.channel_categories[0].category_name='UPI\u007f',r=>r.channel_categories[0].sort='1',r=>r.channel_categories[0].sort=true,r=>r.channel_categories[0].sort=1.5,r=>r.channel_categories[0].sort=-2147483649,r=>r.channel_categories[0].sort=2147483648];
 mutations.push(r=>r.source_channel_name='Bearer synthetic-secret',r=>r.channel_categories[0].category_name='Authorization: Bearer synthetic-secret');
 for(const mutate of mutations){const q=snapshot({captured_at:later});q.directions.forEach(d=>d.observed_at=later);q.directions[1].records[0].channel_categories=[{category_id:'category-1',category_name:'UPI',sort:0}];mutate(q.directions[1].records[0]);assert.throws(()=>validateArMiddleChannelRequest(q,now),/invalid_request/);await assert.rejects(()=>call(q));assert.deepEqual(await rows(),prior);assert.deepEqual((await db.query('select * from private.ar_middle_channel_sync_state order by order_type')).rows,state);}
});
test('malformed second direction, count mismatch, duplicate ID, one missing direction and failed empty result preserve the whole prior snapshot',async()=>{
 await call(snapshot());const prior=await rows();
 for(const mutation of [q=>q.directions.pop(),q=>q.directions[1].complete=false,q=>q.directions[1].source_count=0,q=>q.directions[1].records[0].balance='bad',q=>{q.directions[1].records.push(record());q.directions[1].source_count=q.directions[1].fetched_count=2;},q=>{q.directions[1].records=[];q.directions[1].fetched_count=0;}]){
  const q=snapshot({captured_at:later});q.directions.forEach(d=>d.observed_at=later);mutation(q);await assert.rejects(()=>call(q));assert.deepEqual(await rows(),prior);
 }
});
test('newer snapshots remove only their tenant and native direction inventory; replay and late arrivals cannot advance state',async()=>{
 await call(snapshot());await call(snapshot({source_tenant_id:'1013'}));assert.equal((await call(snapshot())).snapshot_applied,true);
 const q=snapshot({captured_at:later});q.directions.forEach(d=>{d.observed_at=later;d.records=[];d.source_count=d.fetched_count=0;});await call(q);
 assert.equal((await rows()).filter(x=>x.source_tenant_id==='1102'&&x.is_present).length,0);assert.equal((await rows()).filter(x=>x.source_tenant_id==='1013'&&x.is_present).length,2);assert.equal((await call(snapshot())).snapshot_applied,false);
 await assert.rejects(()=>call(snapshot({captured_at:later})),/CONFLICT/);
 const r=snapshot({captured_at:latest});r.directions.forEach(d=>d.observed_at=latest);await call(r);const reappeared=(await rows()).filter(x=>x.source_tenant_id==='1102');assert(reappeared.every(x=>x.is_present&&x.first_seen_at.toISOString()===new Date(at).toISOString()));
});
test('rates/balances refresh without a configuration change; source state, fees and weights record configuration changes',async()=>{
 await call(snapshot());const q=snapshot({captured_at:later});q.directions.forEach(d=>{d.observed_at=later;d.records[0].balance='10';d.records[0].success_rate_30m='70';d.records[0].source_updated_at=later;});await call(q);assert((await rows()).every(x=>x.config_changed_at.toISOString()===new Date(at).toISOString()));
 const r=clone(q);r.captured_at=latest;r.snapshot_id=snapshot({captured_at:latest}).snapshot_id;r.directions.forEach(d=>{d.observed_at=latest;d.records[0].weight='1.5';d.records[0].source_state='1';});await call(r);assert((await rows()).every(x=>x.config_changed_at.toISOString()===new Date(latest).toISOString()));
});
test('UUID reuse, changed replay identity and regressing direction observation reject without advancing either direction',async()=>{
 await call(snapshot());const prior=await rows();
 const changedIdentity=snapshot({snapshot_id:'11111111-1111-4111-8111-111111111111'});await assert.rejects(()=>call(changedIdentity),/CONFLICT/);assert.deepEqual(await rows(),prior);
 const reused=snapshot({captured_at:later,snapshot_id:snapshot().snapshot_id});reused.directions.forEach(d=>d.observed_at=later);await assert.rejects(()=>call(reused),/ID_REUSE/);assert.deepEqual(await rows(),prior);
 const regression=snapshot({captured_at:later});regression.directions[0].observed_at='2026-10-06T23:59:59Z';regression.directions[1].observed_at=later;await assert.rejects(()=>call(regression),/CHRONOLOGY/);assert.deepEqual(await rows(),prior);
});
test('native mapping drift revokes both ingestion and channel capability while retaining the prior stored snapshot',async()=>{
 await call(snapshot());const prior=await rows();await db.query("delete from public.ar_config_targets where country_code='IN' and platform='Veer.Game'");
 try{assert.deepEqual((await db.query('select private.ar_middle_channel_capabilities($1) result',[veer])).rows[0].result,{});await assert.rejects(()=>read(),/platform_denied/);await assert.rejects(()=>call(snapshot()),/SCOPE_DENIED/);assert.deepEqual(await rows(),prior);}
 finally{await db.query("insert into public.ar_config_targets values('IN','Veer.Game','AR')");}
});
test('reader preserves source/capability and actual observed times, marks stale, filters providers without claiming partial totals, and merges YASH',async()=>{
 const empty=await read();assert.equal(empty.platforms[0].source,'ar');assert.equal(empty.platforms[0].capabilities.channelStatusSource,'ar_middle');assert(empty.snapshots.every(s=>s.source==='ar_middle'&&s.observedAt===null&&s.complete===false&&s.stale===true&&s.channels.length===0));
 await call(snapshot());const result=await read();assert.equal(result.snapshots.length,2);for(const s of result.snapshots){assert.equal(s.complete,true);assert.equal(s.staleAfterSeconds,900);assert.equal(Date.parse(s.observedAt),Date.parse(at));assert.equal(s.channels[0].success_rate_10m,null);assert.equal(s.channels[0].success_rate_15m,'0');assert(!('payload_hash'in s));}
 const filtered=await read({direction:'charge',providers:['Missing']});assert.equal(filtered.snapshots[0].complete,true);assert.equal(filtered.snapshots[0].sourceCount,1);assert.deepEqual(filtered.snapshots[0].channels,[]);
 const yid=(await db.query("select md5('kb:IN:YASH.BET')::uuid id")).rows[0].id;const mixed=await read({platformIds:[veer,yid]});assert.equal(mixed.platforms.length,2);assert.equal(mixed.snapshots.length,3);assert(!('source'in mixed.snapshots.find(s=>s.platformId===yid)));
});
test('reader rejects stale sessions, gateway bypass, legacy role, hidden platform and malformed scope requests',async()=>{
 for(const [key,value,pattern] of [['test.session','denied',/application_session_denied/],['test.gateway','denied',/role_gateway_required/],['test.mode','legacy',/role_denied/],['test.view','denied',/role_denied/],['test.hidden','Veer.Game',/platform_denied/]]){await setting(key,value);await assert.rejects(()=>read(),pattern);await setting(key,'');}
 for(const bad of [{platformIds:[]},{platformIds:[veer,veer]},{platformIds:['bad']},{platformIds:[yash]},{direction:'deposit'},{providers:['X','X']},{providers:null},{source:'ar_middle'}])await assert.rejects(()=>read(bad),/invalid_|duplicate_|platform_denied/);
});
test('strict edge+SQL whitelist rejects arbitrary source data, 10m relabeling, invalid times, bad decimals and duplicated directions',async()=>{
 const mutations=[q=>q.password='secret',q=>q.directions[0].records[0].merchantCode='merchant-secret',q=>q.directions[0].records[0].success_rate_10m='50',q=>q.directions[0].records[0].success_rate_15m='101',q=>q.directions[0].records[0].weight=1.25,q=>q.directions[0].records[0].fee_rate_basis='percent',q=>q.directions[0].observed_at='2026-10-07 00:00:00',q=>q.directions[1].order_type='deposit',q=>delete q.directions[0].records[0].source_position,q=>q.directions[0].records[0].source_position=1];
 for(const mutate of mutations){const q=snapshot();mutate(q);assert.throws(()=>validateArMiddleChannelRequest(q,now),/invalid_request/);await assert.rejects(()=>call(q));}assert.equal((await rows()).length,0);
});
test('edge hashes collector key, uses service-only atomic RPC and returns a safe acknowledgement after SQL succeeds',async()=>{
 const calls=[];const h=createArMiddleChannelIngestHandler({env:{SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-secret'},now:()=>now,fetch:async(url,init)=>{calls.push({url,init});const q=JSON.parse(init.body);return Response.json({...await call(q.p_request,q.p_token_hash),private_data:'never-return'});}});
 const q=snapshot();q.directions[0].records[0].notes='fee 2% <b>safe</b> token=secret https://private.example +91 9876543210';const res=await h(request(q));assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true,source:'ar_middle',accepted:2,source_count:2,snapshot_applied:true,snapshot_id:q.snapshot_id});assert.equal(calls[0].url,'https://synthetic.supabase.co/rest/v1/rpc/ar_middle_channel_ingest');assert.equal(JSON.parse(calls[0].init.body).p_token_hash,hash);assert.equal(calls[0].init.redirect,'error');assert.equal(res.headers.get('cache-control'),'no-store');assert.doesNotMatch(JSON.stringify(await rows()),/private\.example|9876543210|token=secret|<b>/);
});
test('edge refuses bad methods, forged keys, oversized/chunked requests and unsafe acknowledgements without leaking upstream secrets',async()=>{
 let calls=0;const h=extra=>createArMiddleChannelIngestHandler({env:{SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-secret'},now:()=>now,fetch:async()=>{calls++;return extra||Response.json({message:'AR_MIDDLE_UNAUTHORIZED',detail:token},{status:400});}});
 for(const [q,expected] of [[new Request('https://synthetic'),405],[request(snapshot(),{'X-Collector-Key':''}),401],[request(snapshot(),{'Content-Type':'text/plain'}),415],[request('{bad json'),422],[request(snapshot(),{'Content-Length':String(MAX_AR_MIDDLE_BYTES+1)}),413]])assert.equal((await h()(q)).status,expected);
 assert.equal(calls,0);const denied=await h()(request(snapshot()));assert.equal(denied.status,401);assert.doesNotMatch(await denied.text(),/synthetic|secret|AR_MIDDLE/);
 const badAck=await h(Response.json({ok:true,source:'ar_middle',accepted:0,source_count:0,snapshot_applied:true,snapshot_id:snapshot().snapshot_id,secret:token}))(request(snapshot()));assert.equal(badAck.status,503);
 let cancelled=false;const chunk=new Uint8Array(1024*1024),body=new ReadableStream({start(c){for(let i=0;i<9;i++)c.enqueue(chunk);},cancel(){cancelled=true;}});const oversized=new Request('https://synthetic',{method:'POST',headers:{'X-Collector-Key':token,'Content-Type':'application/json','Content-Length':'1'},body,duplex:'half'});assert.equal((await h()(oversized)).status,413);assert.equal(cancelled,true);
});
