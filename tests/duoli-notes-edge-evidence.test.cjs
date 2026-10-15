const {loadEdge}=require('./load-edge-typescript.cjs');
const assert=require('node:assert/strict');
const { test }=require('node:test');
const { createHandler, PLATFORMS }=loadEdge(require('node:path').join(__dirname,'../supabase/functions/duoli-detail-ingest/handler.ts'));
const { createHandler:originalHandler }=loadEdge(require('node:path').join(__dirname,'fixtures/duoli-notes/edge-v3-handler.ts'));

// Offline only: injected fetch, synthetic credentials and source records.
const key = 'synthetic-custom-key-for-unit-tests';
const serverKey = 'sb_secret_synthetic_server_only_key_1234567890';
const scope = { window_id:'00000000-0000-4000-8000-000000000001', platform:'UANG', business:'withdraw',
  stream:'updated', start_at:'2026-10-04T01:00:00Z', end_exclusive:'2026-10-04T01:10:00Z' };
const batchId = '00000000-0000-4000-8000-000000000002';
const scalar = (state='present', text='synthetic business flow', redacted=false, truncated=false) => ({state,text,redacted,truncated});
const notes = () => ({version:1,fields:{condition:scalar(),remark:scalar('missing',null)}});
const row = () => ({order_id:'synthetic-order',source_order_id:'synthetic-id',platform:'UANG',business_type:'withdraw',
  order_no:'synthetic-order-no',member_id:'synthetic-member',created_at:'2026-10-01T17:00:00Z',created_day:'2026-10-02',
  updated_at:scope.start_at,status_code:'3',status_text:'synthetic',currency:null,operator:'synthetic-operator',provider:null,
  provider_code:null,channel:null,amount_raw:'10',amount_source:'amount',amount_unit:'source_unverified',amount_fields_raw:{amount:'10'},
  raw:{amount:10,status:3},audit_completed_at:null,audit_duration_seconds:null});
const batch = () => ({schema_version:2,action:'batch',...scope,batch_id:batchId,observed_at:scope.end_exclusive,rows:[{...row(),source_notes:notes()}]});
const ack = body => ({ok:true,schema_version:2,action:'batch',...scope,batch_id:body.batch_id,received:body.rows.length,
  written:body.rows.length,replayed:false,status_coverage:'requested_all_unverified',query_mode:'source_time_stream'});
const checkAck = () => ({ok:true,schema_version:2,action:'check',platforms:[...PLATFORMS],receiver_version:'DOLI_DETAIL_R2',
  status_coverage:'requested_all_unverified',query_mode:'source_time_stream'});
const request = body => new Request('https://receiver.example/duoli',{method:'POST',headers:{'x-api-key':key,'content-type':'application/json'},body:JSON.stringify(body)});
function setup(upstream, factory=createHandler){
  const calls=[];
  const handler=factory({env:name=>({SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:serverKey})[name],fetch:async(...args)=>{
    calls.push(args);return new Response(JSON.stringify(upstream));
  }});
  return {handler,calls};
}
async function rejected(body){
  const {handler,calls}=setup(ack(body));const result=await handler(request(body));
  assert.equal(result.status,400);assert.equal(calls.length,0);
  assert.deepEqual(await result.json(),{ok:false,schema_version:2,error:'invalid_request'});
}

test('actual v3 rejects optional evidence; candidate forwards exact native values and notes to v2 RPC',async()=>{
  const body=batch();const old=setup(ack(body),originalHandler);
  assert.equal((await old.handler(request(body))).status,400);assert.equal(old.calls.length,0);
  const fresh=setup({...ack(body),secret:serverKey,rows:body.rows});const result=await fresh.handler(request(body));
  assert.equal(result.status,200);assert.deepEqual(await result.json(),ack(body));assert.equal(fresh.calls.length,1);
  assert.equal(fresh.calls[0][0],'https://project.example/rest/v1/rpc/duoli_detail_ingest_v2');
  assert.deepEqual(JSON.parse(fresh.calls[0][1].body),{p_key:key,p_body:body});
  assert.equal(fresh.calls[0][1].headers.apikey,serverKey);assert.equal(fresh.calls[0][1].headers.Authorization,undefined);
});

test('only verified v2 capability1 survives ACK whitelist; legacy check is byte-equivalent',async()=>{
  const body={schema_version:2,action:'check'};
  const old=setup({...checkAck(),source_notes_version:1},originalHandler);
  assert.deepEqual(await(await old.handler(request(body))).json(),checkAck());
  const fresh=setup({...checkAck(),source_notes_version:1,secret:serverKey});
  assert.deepEqual(await(await fresh.handler(request(body))).json(),{...checkAck(),source_notes_version:1});
  assert.deepEqual(await(await setup(checkAck()).handler(request(body))).json(),checkAck());
  for(const version of [null,0,2,true,'1']){
    const r=await setup({...checkAck(),source_notes_version:version}).handler(request(body));
    assert.equal(r.status,502);assert.deepEqual(await r.json(),{ok:false,schema_version:2,error:'upstream_failure'});
  }
});

test('missing empty invalid present withheld states and Unicode512 boundary preserve protocol',async()=>{
  for(const value of [scalar('missing',null),scalar('empty',null),scalar('invalid',null),scalar('withheld',null,true),
    scalar('present','😀'.repeat(512)),scalar('present','synthetic [redacted]',true,true)]){
    const body=batch();body.rows[0].source_notes.fields.condition=value;
    const r=await setup(ack(body)).handler(request(body));assert.equal(r.status,200);
  }
  for(const value of [scalar('present','😀'.repeat(513)),scalar('present',''),scalar('present','  '),scalar('present','bad\u007f'),
    scalar('present','bad\u0001'),scalar('missing','not null'),scalar('empty',null,true),scalar('invalid',null,false,true),
    scalar('withheld',null,false),scalar('unknown',null),scalar('present',{nested:'private'}),{...scalar(),extra:'private'}]){
    const body=batch();body.rows[0].source_notes.fields.condition=value;await rejected(body);
  }
});

test('evidence exact keys forbid invented reason aliases and non-object or wrong version values',async()=>{
  for(const value of [null,[],{}, {...notes(),version:'1'}, {...notes(),version:2}, {...notes(),reason:'inferred'},
    {version:1,fields:{condition:scalar()}},{version:1,fields:{...notes().fields,conf_pay_remarks:scalar()}}]){
    const body=batch();body.rows[0].source_notes=value;await rejected(body);
  }
  const raw=batch();raw.rows[0].raw.remark='not allowlisted';await rejected(raw);
  const invented=batch();invented.rows[0].reason='inferred';await rejected(invented);
});

test('optional notes remain withdrawal schema2 only and ordinary legacy batches retain original ACK',async()=>{
  const recharge=batch();recharge.business='recharge';recharge.rows[0].business_type='recharge';await rejected(recharge);
  const legacy=batch();delete legacy.rows[0].source_notes;
  for(const factory of [originalHandler,createHandler]){
    const c=setup(ack(legacy),factory);assert.deepEqual(await(await c.handler(request(legacy))).json(),ack(legacy));
  }
  const v1={schema_version:1,action:'batch',window_id:scope.window_id,batch_id:batchId,platform:'UANG',business:'withdraw',local_day:'2026-10-04',end_exclusive:scope.end_exclusive,observed_at:scope.end_exclusive,rows:[{...row(),source_notes:notes()}]};
  delete v1.rows[0].audit_completed_at;delete v1.rows[0].audit_duration_seconds;
  v1.rows[0].created_at=scope.start_at;v1.rows[0].created_day='2026-10-04';
  const {handler,calls}=setup(ack(batch()));assert.equal((await handler(request(v1))).status,400);assert.equal(calls.length,0);
});

test('old queued body replay ACK and 200row/1MiB/auth limits remain enforced with no note echo',async()=>{
  const body=batch();delete body.rows[0].source_notes;
  const result=await setup({...ack(body),replayed:true,source_notes:notes()}).handler(request(body));
  assert.deepEqual(await result.json(),{...ack(body),replayed:true});
  const atCap=batch();atCap.rows=Array.from({length:200},()=>structuredClone(atCap.rows[0]));
  assert.equal((await setup(ack(atCap)).handler(request(atCap))).status,200);
  const over=batch();over.rows=Array.from({length:201},()=>structuredClone(over.rows[0]));await rejected(over);
  const huge=new Request('https://receiver.example',{method:'POST',headers:{'x-api-key':key,'content-type':'application/json'},body:' '.repeat(1_048_576)});
  const h=setup(ack(body));assert.equal((await h.handler(huge)).status,413);assert.equal(h.calls.length,0);
  const noKey=new Request('https://receiver.example',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const n=setup(ack(body));assert.equal((await n.handler(noKey)).status,401);assert.equal(n.calls.length,0);
});
