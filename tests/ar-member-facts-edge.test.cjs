'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{createHash,randomUUID}=require('node:crypto');
const {loadTs,root}=require('./load-typescript.cjs');
const {validateAROrderPayload,createAROrderHandler}=loadTs(path.join(root,'supabase/functions/ar-order-ingest/handler.ts'));
const at='2026-10-10T00:00:00Z',now=()=>new Date('2026-10-10T01:00:00Z');
const key='synthetic_ar_order_scoped_key_'+ 'x'.repeat(40);
const fields={order_no:'SYNTHETIC',member_id:'MEMBER',amount:'100.00',amount_text:'100.00',status:'待支付',applied_at:'2026-10-10 00:00:00',completed_at:null,operator:null,raw_channel:'SyntheticPay',channel_type:'UPI',remark:null,manual_remark:null};
const batch=(extra={},row={})=>({action:'ingest',batch_id:randomUUID(),source_system:'AR',country_code:'IN',platform:'JALWA',order_kind:'recharge',observed_at:at,orders:[{...fields,...row}],...extra});
const req=(payload,extra={})=>new Request('https://synthetic/functions/v1/ar-order-ingest',{method:'POST',headers:{'X-AR-Key':key,'content-type':'application/json'},body:JSON.stringify(payload),...extra});
const ack=p=>p.action==='check'?{ok:true,source_system:'AR',details_version:1,scope_count:41}:{ok:true,batch_id:p.batch_id,order_count:p.orders.length,status:'accepted',...(p.money_format_version===1?{money_format_version:1,money_local_count:1,money_usdt_count:1,money_missing_local_count:0}:{})};

test('deployed v2 baseline is preserved outside the two optional member-fact validation changes',()=>{
 const baseline=fs.readFileSync(path.join(root,'tests/fixtures/ar-order-ingest-production.ts'),'utf8');
 const production=baseline.slice(0,baseline.indexOf('if(import.meta.main'));
 const handler=fs.readFileSync(path.join(root,'supabase/functions/ar-order-ingest/handler.ts'),'utf8');
 const restored=handler.replace("const MEMBER_FIELDS = ['member_level','recharge_count'];\n",'').replace(/    if \(!object\(row\)\) invalid\(\);\n    const required=[\s\S]*?\n    if \(!text\(row\.order_no/,"    if (!object(row)) invalid(); exact(row,dual?[...FIELDS,...MONEY_FIELDS]:FIELDS);\n    if (!text(row.order_no");
 assert.equal(restored.trimEnd(),production.trimEnd());assert.match(baseline,/exact\(row,dual\?\[\.\.\.FIELDS,\.\.\.MONEY_FIELDS\]:FIELDS\)/);
});
test('old twelve-field, either optional field and explicit null remain valid without synthesizing facts',()=>{
 for(const row of [{},{member_level:null,recharge_count:null},{member_level:0},{recharge_count:0},{member_level:9999,recharge_count:999999999}]){
  const p=batch({},row);assert.equal(validateAROrderPayload(p,now()),p);assert.deepEqual(p.orders[0],{...fields,...row});
 }
 const dual=batch({order_kind:'withdraw',money_format_version:1},{amount_local:'100.00',amount_usdt:'2.00',currency_local:'INR',member_level:0,recharge_count:0});assert.equal(validateAROrderPayload(dual,now()),dual);
});
test('member facts reject string/bool/container, fractions, negative, oversized and unverified aliases before RPC',async()=>{
 let calls=0;const h=createAROrderHandler({SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'},async()=>{calls++;throw Error('unexpected transport');},now);
 for(const field of ['member_level','recharge_count'])for(const value of ['0','L0',true,{},[],1.5,-1,field==='member_level'?10000:1000000000]){
  const p=batch({}, {[field]:value});assert.throws(()=>validateAROrderPayload(p,now()),/invalid_payload/);assert.equal((await h(req(p))).status,422);
 }
 for(const row of [{vipLevel:0},{rechargeCount:1},{member_level:0,recharge_count:0,raw_source:{private:'never-store'}}])assert.throws(()=>validateAROrderPayload(batch({},row),now()),/invalid_payload/);
 const missing=batch({}, {member_level:0});delete missing.orders[0].status;assert.throws(()=>validateAROrderPayload(missing,now()),/invalid_payload/);assert.equal(calls,0);
});
test('HTTP handler forwards facts intact with hashed scoped key, existing RPC path and a minimal unchanged ACK',async()=>{
 let capture;const h=createAROrderHandler({SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'},async(url,init)=>{
  capture={url,init,body:JSON.parse(init.body)};return Response.json({...ack(capture.body.p_payload),private_unrelated:'must-not-return'});
 },now);
 const p=batch({}, {member_level:0,recharge_count:12});const response=await h(req(p));assert.equal(response.status,200);assert.deepEqual(await response.json(),ack(p));
 assert.equal(capture.url,'https://synthetic.supabase.co/rest/v1/rpc/publish_ar_collected_orders');assert.equal(capture.body.p_token_hash,createHash('sha256').update(key).digest('hex'));assert.deepEqual(capture.body.p_payload,p);
 assert.equal(capture.init.redirect,'error');assert.equal(capture.init.cache,'no-store');assert(!capture.init.body.includes(key));
});
test('check, dual-money proof, malformed ACK and storage failures retain the original public protocol',async()=>{
 let reply;const h=createAROrderHandler({SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'},async(_url,init)=>{const p=JSON.parse(init.body).p_payload;return reply?.(p)||Response.json(ack(p));},now);
 assert.deepEqual(await (await h(req({action:'check'}))).json(),ack({action:'check'}));
 const p=batch({order_kind:'withdraw',money_format_version:1},{amount_local:'100.00',amount_usdt:'2.00',currency_local:'INR',member_level:3});assert.deepEqual(await (await h(req(p))).json(),ack(p));
 reply=p=>Response.json({...ack(p),money_local_count:0});assert.equal((await h(req(p))).status,503);
 for(const [message,status,error] of [['ARO_AUTH_INVALID',401,'invalid_key'],['ARO_SCOPE_DENIED',403,'scope_denied'],['ARO_BATCH_CONFLICT',409,'batch_conflict'],['ARO_INVALID_MEMBER_FACT',422,'invalid_payload'],['private_database_error',503,'storage_unavailable']]){
  reply=()=>Response.json({message},{status:400});const r=await h(req(p));assert.equal(r.status,status);assert.deepEqual(await r.json(),{ok:false,error});
 }
});
test('method, key, media, exact country/platform scope, required fields and duplicates still fail closed',async()=>{
 let calls=0;const h=createAROrderHandler({SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'},async()=>{calls++;return Response.json({});},now);
 assert.equal((await h(new Request('https://synthetic',{method:'GET'}))).status,405);
 assert.equal((await h(req(batch(),{headers:{'X-AR-Key':'bad','content-type':'application/json'}}))).status,401);
 assert.equal((await h(req(batch(),{headers:{'X-AR-Key':key,'content-type':'text/plain'}}))).status,415);
 for(const p of [batch({platform:'UNKNOWN'}),batch({country_code:'BR'}),batch({orders:[{...fields},{...fields,member_level:0}]}),batch({money_format_version:1})])assert.equal((await h(req(p))).status,422);
 assert.equal(calls,0);
});
