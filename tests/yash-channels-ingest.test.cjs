const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {loadTs,root}=require('./load-typescript.cjs');
const {createYashIngestHandler,validateYashRequest}=loadTs(path.join(root,'supabase/functions/yash-order-ingest/handler.ts'));
const token='synthetic_channel_credential_'+ 'x'.repeat(40),hash=createHash('sha256').update(token).digest('hex');
const now=Date.parse('2026-10-09T06:00:00Z'),t0='2026-10-07T00:00:00Z',t1='2026-10-07T00:01:00Z',t2='2026-10-07T00:02:00Z';
let db;
const row=(id='A',extra={})=>({channel_id:id,channel_name:'Synthetic QR',provider:'SyntheticPay',channel_type:'唤醒',payment_method:'UPI',min_amount:'100',max_amount:'50000',limit_currency:'INR',success_rate_10m:'0',success_rate_30m:null,success_rate_1h:'66.66666667',success_rate_4h:'80',success_rate_8h:'75',success_rate_24h:'70',success_rate_today:'60',success_rate_total:'55',balance:'123456.12345678',balance_currency:'INR',balance_threshold:null,balance_threshold_currency:null,required_deposit_count:0,priority:1,weight:10,status_text:'已启用',enabled:true,notes:'代收 4% 代付 1%',...extra});
const snap=(records=[row()],extra={})=>({action:'channels',schema_version:1,snapshot_id:'11111111-1111-4111-8111-111111111111',order_type:'deposit',observed_at:t0,source_count:records.length,fetched_count:records.length,records,...extra});
const call=async(q,key=hash)=>(await db.query('select public.yash_channel_ingest($1,$2) result',[key,q])).rows[0].result;
const current=async(id='A',kind='deposit')=>(await db.query('select * from private.yash_channels where order_type=$1 and channel_id=$2',[kind,id])).rows[0];
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const name of ['20261009044014_yash_order_ingest.sql','20261009050436_yash_channel_snapshots.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));await db.query("insert into private.yash_ingest_credentials values($1,'synthetic',now()+interval '1 day',null,now())",[hash]);});
beforeEach(async()=>{await db.exec('truncate private.yash_channels,private.yash_channel_sync_state');});
after(async()=>db?.close());
test('channel RPC authenticates every snapshot; private tables and function deny anonymous and authenticated users',async()=>{
 for(const role of ['anon','authenticated']){assert.equal((await db.query("select has_function_privilege($1,'public.yash_channel_ingest(text,jsonb)','execute') ok",[role])).rows[0].ok,false);for(const name of ['yash_channels','yash_channel_sync_state'])assert.equal((await db.query('select has_table_privilege($1,$2,\'select\') ok',[role,'private.'+name])).rows[0].ok,false);}
 await assert.rejects(()=>call(snap(),'b'.repeat(64)),/YASH_UNAUTHORIZED/);assert.equal((await db.query("select bool_and(relrowsecurity) ok from pg_class where oid in ('private.yash_channels'::regclass,'private.yash_channel_sync_state'::regclass)")).rows[0].ok,true);
});
test('snapshot replay remains one row and stale snapshots cannot change current status, balance, or inventory',async()=>{
 const q=snap();assert.equal((await call(q)).snapshot_applied,true);assert.equal((await call(q)).snapshot_applied,true);
 await call(snap([row('A',{weight:90,balance:'200'})],{observed_at:t1}));assert.equal((await call(q)).snapshot_applied,false);assert.equal((await current()).weight,90);assert.equal((await current()).balance,'200.00000000');assert.equal((await db.query('select count(*) n from private.yash_channels')).rows[0].n,1);
 await assert.rejects(()=>call(snap([],{observed_at:t1})),/SNAPSHOT_CONFLICT/);
});
test('new channels auto appear, missing channels remain separate from disabled, reappearance preserves first-seen time',async()=>{
 await call(snap([row(),row('B',{enabled:false,status_text:'禁用'})]));await call(snap([row('B',{enabled:false,status_text:'禁用'}),row('C')],{observed_at:t1}));
 assert.equal((await current()).is_present,false);assert.equal((await current()).enabled,true);assert.equal((await current('B')).enabled,false);assert.equal((await current('C')).is_present,true);
 await call(snap([row()],{observed_at:t2}));const a=await current();assert.equal(a.is_present,true);assert.equal(a.first_seen_at.toISOString(),new Date(t0).toISOString());assert.equal(a.last_seen_at.toISOString(),new Date(t2).toISOString());
});
test('volatile success rates/balances refresh without changing configuration time; weights and enabled state do',async()=>{
 await call(snap());await call(snap([row('A',{success_rate_today:'61',balance:'9'})],{observed_at:t1}));let a=await current();assert.equal(a.config_changed_at.toISOString(),new Date(t0).toISOString());assert.equal(a.success_rate_today,'61.00000000');
 await call(snap([row('A',{success_rate_today:'61',weight:11,enabled:false,status_text:'禁用'})],{observed_at:t2}));a=await current();assert.equal(a.config_changed_at.toISOString(),new Date(t2).toISOString());assert.equal(a.enabled,false);
});
test('complete zero snapshots mark only their direction absent; incomplete or duplicate snapshots change nothing',async()=>{
 await call(snap());await call(snap([row()],{order_type:'withdrawal'}));
 for(const q of [snap([],{observed_at:t1,source_count:1}),snap([row(),row()],{observed_at:t1}),snap([row('NEW'),row('BAD',{success_rate_total:'101'})],{observed_at:t1})])await assert.rejects(()=>call(q));
 assert.equal((await current()).is_present,true);assert.equal(await current('NEW'),undefined);assert.equal((await call(snap([],{observed_at:t2}))).snapshot_applied,true);assert.equal((await current()).is_present,false);assert.equal((await current('A','withdrawal')).is_present,true);
});
test('limit and balance currencies remain independent, exact decimals and null-vs-zero survive ingestion',async()=>{
 await call(snap([row('A',{balance:'0',balance_currency:'USDT',limit_currency:'INR',balance_threshold:'100',balance_threshold_currency:null})]));const a=await current();assert.equal(a.balance,'0.00000000');assert.equal(a.limit_currency,'INR');assert.equal(a.balance_currency,'USDT');assert.equal(a.balance_threshold_currency,null);assert.equal(a.success_rate_10m,'0.00000000');assert.equal(a.success_rate_30m,null);
 await call(snap([row('B',{balance_currency:null})],{observed_at:t1}));assert.equal((await current('B')).balance_currency,null);
});
test('receiver and SQL handle actual RPC end-to-end, sanitize notes, and return only verified acknowledgement',async()=>{
 const calls=[];const handler=createYashIngestHandler({env:{SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-db-secret'},now:()=>now,fetch:async(url,init)=>{calls.push(url);const payload=JSON.parse(init.body);return Response.json(await call(payload.p_request,payload.p_token_hash));}});
 const payload=snap([row('A',{notes:'代收 4% https://secret.example token=abc123 +91 9876543210 <b>业务</b>'})]);
 const res=await handler(new Request('https://synthetic/receiver',{method:'POST',headers:{'X-Yash-Key':token,'Content-Type':'application/json'},body:JSON.stringify(payload)}));assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true,accepted:1,source_count:1,snapshot_applied:true});assert.deepEqual(calls,['https://synthetic.supabase.co/rest/v1/rpc/yash_channel_ingest']);assert.doesNotMatch((await current()).notes,/abc123|9876543210|secret.example|<b>/);assert.match((await current()).notes,/代收 4%/);
});
test('strict edge validation rejects bad snapshots, fields, units, rate bounds, unsafe integer weights and source actions',()=>{
 const bad=[snap([],{source_count:1}),snap([row(),row()]),snap([row('A',{raw_html:'<html/>'})]),snap([row('A',{action_url:'/delete'})]),snap([row('A',{balance:'NaN'})]),snap([row('A',{min_amount:'-1'})]),snap([row('A',{max_amount:'99'})]),snap([row('A',{weight:1.2})]),snap([row('A',{priority:2147483648})]),snap([row('A',{success_rate_10m:'100.001'})]),snap([row('A',{enabled:'true'})]),snap([row('A',{channel_name:'<script>bad</script>'})]),snap([row('A',{notes:'x'.repeat(401)})]),snap([],{observed_at:'2026-10-09 06:00:00'}),snap([],{snapshot_id:'bad'}),snap([],{source_site:'other'})];
 for(const q of bad)assert.throws(()=>validateYashRequest(q,now),/invalid_request/);assert.equal(validateYashRequest(snap([]),now).records.length,0);assert.equal(validateYashRequest(snap([row('A',{balance:'-1'})]),now).records[0].balance,'-1');
});
