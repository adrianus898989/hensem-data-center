/* Runs the production receiver with synthetic requests and an isolated RPC stub. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {loadTs,root}=require('./load-typescript.cjs');
const {createYashIngestHandler,validateYashRequest,sanitizeYashRaw,YASH_RAW_KEYS,MAX_YASH_BYTES}=loadTs(path.join(root,'supabase/functions/yash-order-ingest/handler.ts'));
const token='synthetic_yash_scoped_token_'+ 'x'.repeat(40),serviceKey='synthetic_service_key_never_return',now=Date.parse('2026-10-09T06:00:00Z');
const uuid='11111111-1111-4111-8111-111111111111',clone=x=>JSON.parse(JSON.stringify(x));
const record=(extra={})=>({source_site:'yash',order_type:'deposit',order_no:'synthetic-order-1',uid:'synthetic-member-1',child_order_no:'child-1',supplier_order_no:'supplier-order-1',supplier:'TestPay',channel:'UPI',payment_method:'UPI',source_category:'用户充值',order_category:'普通充值',operator:'Admin',amount:'1000.12345678',fee:null,balance_before:'-10.5',balance_after:null,credited_amount:'1000.12345678',discount_percent:'0',status:'成功',created_at:'2026-10-09T01:00:00+00:00',completed_at:'2026-10-09T01:02:00Z',source_timezone:'Asia/Kolkata',is_first_order:false,currency:'INR',currency_basis:'platform_default',raw_fields:{UID:'synthetic-member-1','订单号':'synthetic-order-1','充值金额':'1000.12345678'},observed_at:'2026-10-09T02:00:00.123456+00:00',...extra});
const batch=(rows=[record()])=>({action:'ingest',schema_version:1,batch_id:uuid,records:rows});
const receipt=(extra={})=>({action:'receipt',schema_version:1,window_id:uuid,order_type:'deposit',stream:'createTime',start_at:'2026-10-09T01:00:00Z',end_exclusive:'2026-10-09T02:00:00Z',snapshot_at:'2026-10-09T03:00:00Z',source_timezone:'Asia/Kolkata',source_count:1,order_keys:['synthetic-order-1'],...extra});
const request=(data,headers={},options={})=>new Request('https://receiver.example/functions/v1/yash-order-ingest',{method:'POST',headers:{'X-Yash-Key':token,'Content-Type':'application/json',...headers},body:typeof data==='string'?data:JSON.stringify(data),...options});
function harness(extra={}){const calls=[];let response=extra.response;const handler=createYashIngestHandler({env:{SUPABASE_URL:'https://synthetic-project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:serviceKey,...extra.env},now:()=>now,fetch:async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});if(extra.throw)throw Error('sensitive_upstream_secret');if(response)return response;const q=JSON.parse(init.body).p_request;return Response.json(q.action==='check'?{ok:true,schema_version:1,source_site:'yash'}:q.action==='ingest'?{ok:true,accepted:q.records.length}:{ok:true,verified:true,source_count:q.source_count,uploaded_count:q.source_count,stored_count:q.source_count});}});return {handler,calls};}

test('activation, both order kinds and exact-window receipts use one atomic token-hashed RPC with safe acknowledgement',async()=>{
 const h=harness();for(const data of [{action:'check'},batch([record(),record({order_type:'withdrawal',fee:'2.1'})]),receipt()]){
  const response=await h.handler(request(data));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);const body=await response.json();assert.equal(body.ok,true);assert.doesNotMatch(JSON.stringify(body),new RegExp(token+'|'+serviceKey+'|synthetic-member|supplier-order'));
 }
 assert.equal(h.calls.length,3);for(const call of h.calls){assert.equal(call.url,'https://synthetic-project.supabase.co/rest/v1/rpc/yash_order_ingest');assert.equal(call.body.p_token_hash,createHash('sha256').update(token).digest('hex'));assert.equal(Object.hasOwn(call.body,'token'),false);assert.equal(call.init.headers.Authorization,'Bearer '+serviceKey);assert.equal(call.init.headers.apikey,serviceKey);assert.equal(call.init.redirect,'error');assert.equal(call.init.cache,'no-store');assert(call.init.signal);}
 assert.equal(h.calls[1].body.p_request.records[0].amount,'1000.12345678');assert.equal(h.calls[1].body.p_request.records[0].balance_before,'-10.5');
});

test('unknown structured record or envelope keys reject before any data reaches RPC',async()=>{
 const inputs=[{...batch(),password:'secret'},{...receipt(),url:'https://other.example'},batch([record({bank_account:'bank-secret'})]),batch([record({attachment:'https://files.example/video.mp4'})]),batch([record({cookie:'source-session'})]),batch([record({source_site:'another-site'})]),batch([record({order_type:['deposit']})]),batch([record({currency_basis:['platform_default']})]),receipt({stream:['createTime']}),{action:'check',source_site:'another-site'}];
 const h=harness();for(const data of inputs){const r=await h.handler(request(data));assert.equal(r.status,422);assert.deepEqual(await r.json(),{ok:false,error:'invalid_request'});}assert.equal(h.calls.length,0);
});

test('raw source evidence is scalar-only and allowlisted; contacts, credentials, bank details and media never persist',async()=>{
 const raw={UID:'id-1','订单号':'order-1','充值金额':100,'供应商商户':'TestPay https://secret.example/a?token=secret','提现账户类型':'UPI','币种':'INR',cookie:'session-secret',password:'password-secret','银行卡号':'bank-secret','手机号':'phone-secret',pdf:'file-secret','支付通道':{secret:'compound-secret'},'支付方式':'x'.repeat(257),'优惠比例':Number.MAX_SAFE_INTEGER+1,'充值前余额':null};
 const h=harness(),data=batch([record({operator:'Alice +91 9876543210 https://secret.example/token',raw_fields:raw})]);assert.equal((await h.handler(request(data))).status,200);const saved=h.calls[0].body.p_request.records[0];assert.equal(saved.raw_fields.UID,'id-1');assert.equal(saved.raw_fields['充值金额'],100);assert.equal(saved.raw_fields['充值前余额'],null);assert.match(saved.operator,/已移除/);assert.doesNotMatch(JSON.stringify(saved),/session-secret|password-secret|bank-secret|phone-secret|file-secret|compound-secret|9876543210|secret\.example/);assert(!Object.hasOwn(saved.raw_fields,'支付通道'));assert(!Object.hasOwn(saved.raw_fields,'优惠比例'));
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261009044014_yash_order_ingest.sql'),'utf8'),keys=[...sql.match(/where key=any\(array\[([^]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);assert.deepEqual([...YASH_RAW_KEYS].sort(),keys.sort());assert.deepEqual(sanitizeYashRaw({UID:false,'订单号':null}),{UID:false,'订单号':null});assert.equal(validateYashRequest(batch([record({operator:'operator-1234567890abcdef'})]),now).records[0].operator,'operator-1234567890abcdef');
});

test('money stays exact decimal text, bounds precision, and preserves signed balances only',()=>{
 assert.equal(validateYashRequest(batch([record({amount:'9999999999999999.99999999',balance_after:'-1'})]),now).records[0].amount,'9999999999999999.99999999');
 for(const changes of [{amount:1},{amount:null},{amount:'-1'},{fee:'-1'},{credited_amount:'-1'},{discount_percent:'-1'},{amount:'1e3'},{amount:'1,000'},{amount:'10000000000000000'},{amount:'1.123456789'},{fee:true}])assert.throws(()=>validateYashRequest(batch([record(changes)]),now),/invalid_request/);
});

test('UTC instants, source timezone metadata and time ordering fail closed without using the machine timezone',()=>{
 for(const source_timezone of ['Asia/Kolkata','Asia/Shanghai','UTC','UTC+05:30','UTC+08:00','UTC-03:00','UTC+14:00'])assert.equal(validateYashRequest(batch([record({source_timezone})]),now).records[0].source_timezone,source_timezone);
 for(const changes of [{source_timezone:'UTC+14:01'},{source_timezone:'UTC-15:00'},{source_timezone:'UTC+05:60'},{source_timezone:'Machine/Local'},{created_at:'2026-10-09 01:00:00'},{created_at:'2026-10-09T06:30:00+05:30'},{created_at:'2026-02-30T01:00:00Z'},{created_at:'2019-12-31T23:59:59Z'},{created_at:'2026-10-09T06:06:00Z'},{observed_at:'2026-10-09T00:00:00Z'},{completed_at:'2026-10-08T00:00:00Z'}])assert.throws(()=>validateYashRequest(batch([record(changes)]),now),/invalid_request/);
});

test('unknown token currency stays unpriced; currency evidence cannot be fabricated by defaults',()=>{
 for(const changes of [{currency:'INR',currency_basis:'platform_default'},{currency:'USDT',currency_basis:'source_field'},{currency:null,currency_basis:'token_type_unverified'}])assert.doesNotThrow(()=>validateYashRequest(batch([record(changes)]),now));
 for(const changes of [{currency:null,currency_basis:'source_field'},{currency:'USDT',currency_basis:'platform_default'},{currency:'INR',currency_basis:'token_type_unverified'},{currency:'inr'},{currency_basis:'guessed'}])assert.throws(()=>validateYashRequest(batch([record(changes)]),now),/invalid_request/);
});

test('one malformed record or duplicate native identity rejects the entire batch and 500 is the hard cap',async()=>{
 const h=harness();for(const data of [batch([]),batch([record(),record()]),batch([record(),record({order_no:'second',amount:'bad'})]),batch(Array.from({length:501},(_,i)=>record({order_no:'order-'+i}))),{...batch(),batch_id:'not-uuid'},{...batch(),schema_version:'1'}]){assert.equal((await h.handler(request(data))).status,422);}assert.equal(h.calls.length,0);
 assert.equal(validateYashRequest(batch(Array.from({length:500},(_,i)=>record({order_no:'order-'+i}))),now).records.length,500);
});

test('receipt needs exact unique key count and a bounded complete UTC window, including proven empty windows',()=>{
 assert.equal(validateYashRequest(receipt({source_count:0,order_keys:[]}),now).source_count,0);assert.equal(validateYashRequest(receipt({source_count:50000,order_keys:Array.from({length:50000},(_,i)=>'order-'+i)}),now).order_keys.length,50000);
 for(const changes of [{source_count:2},{order_keys:[1]},{source_count:2,order_keys:['same','same']},{source_count:-1,order_keys:[]},{source_count:1.1},{source_count:50001,order_keys:Array.from({length:50001},(_,i)=>'o'+i)},{order_keys:['x'.repeat(201)]},{end_exclusive:'2026-10-09T01:00:00Z'},{start_at:'2026-10-07T00:00:00Z'},{snapshot_at:'2026-10-09T01:30:00Z'},{stream:'updatedTime'},{order_type:'workorder'},{window_id:'invalid'}])assert.throws(()=>validateYashRequest(receipt(changes),now),/invalid_request/);
});

test('a claimed or chunked oversized request is rejected before RPC even when Content-Length lies',async()=>{
 const h=harness();assert.equal((await h.handler(request({action:'check'},{'Content-Length':String(MAX_YASH_BYTES+1)}))).status,413);let cancelled=false;const chunk=new Uint8Array(1024*1024),body=new ReadableStream({start(controller){for(let i=0;i<13;i++)controller.enqueue(chunk);},cancel(){cancelled=true;}});const req=new Request('https://receiver.example',{method:'POST',headers:{'X-Yash-Key':token,'Content-Type':'application/json','Content-Length':'1'},body,duplex:'half'});assert.equal((await h.handler(req)).status,413);assert.equal(cancelled,true);assert.equal(h.calls.length,0);
});

test('method, credential, encoding and content-type failures never disclose secrets or invoke storage',async()=>{
 const h=harness(),requests=[new Request('https://receiver.example'),request({action:'check'},{'X-Yash-Key':''}),request({action:'check'},{'X-Yash-Key':'bad','Authorization':'Bearer forged-jwt'}),request({action:'check'},{'Content-Type':'text/plain'}),request('{not JSON')],statuses=[405,401,401,415,422];
 for(let i=0;i<requests.length;i++){const response=await h.handler(requests[i]);assert.equal(response.status,statuses[i]);assert.doesNotMatch(await response.text(),new RegExp(token+'|'+serviceKey));}assert.equal(h.calls.length,0);
});

test('atomic RPC auth, validation, network and storage failures are mapped without echoing upstream detail',async()=>{
 for(const [data,status] of [[{message:'YASH_UNAUTHORIZED',detail:'secret'},401],[{message:'YASH_INVALID_WINDOW'},422],[{message:'YASH_SCOPE_DENIED'},422],[{message:'YASH_DUPLICATE_KEYS'},422],[{code:'23514',detail:'secret'},422],[{message:'sensitive_db_error',detail:token,hint:serviceKey},503]]){const h=harness({response:Response.json(data,{status:400})}),r=await h.handler(request(batch()));assert.equal(r.status,status);assert.doesNotMatch(await r.text(),/secret|sensitive|YASH_|synthetic_/);}
 assert.equal((await harness({throw:true}).handler(request(batch()))).status,503);for(const env of [{SUPABASE_URL:''},{SUPABASE_SERVICE_ROLE_KEY:''},{SUPABASE_URL:'http://wrong.example'},{SUPABASE_URL:'https://secret@wrong.example'},{SUPABASE_URL:'https://wrong.example/path'}]){const h=harness({env});assert.equal((await h.handler(request(batch()))).status,503);assert.equal(h.calls.length,0);}
});

test('only validated acknowledgement fields are returned; incomplete receipts stay incomplete and bad counts cannot advance the collector',async()=>{
 const h=harness({response:Response.json({ok:true,accepted:1,secret:token,records:[record()]})}),r=await h.handler(request(batch()));assert.deepEqual(await r.json(),{ok:true,accepted:1});
 const partial={ok:true,verified:false,source_count:1,uploaded_count:0,stored_count:2};assert.deepEqual(await (await harness({response:Response.json(partial)}).handler(request(receipt()))).json(),partial);
 for(const [input,data] of [[batch(),{ok:true,accepted:0}],[{action:'check'},{ok:true,schema_version:1,source_site:'other'}],[receipt(),{ok:true,verified:true,source_count:1,uploaded_count:0,stored_count:1}],[receipt(),{ok:true,verified:false,source_count:1,uploaded_count:2,stored_count:2}],[receipt(),{ok:true,verified:'true',source_count:1,uploaded_count:1,stored_count:1}]])assert.equal((await harness({response:Response.json(data)}).handler(request(input))).status,503);
});
