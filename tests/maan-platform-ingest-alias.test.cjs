const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {loadEdge} = require('./load-edge-typescript.cjs');
const root = path.resolve(__dirname, '..');
const edgePath = file => path.join(root, 'supabase/functions', file);
const detail = loadEdge(edgePath('newar-detail-ingest/handler.ts'));
const business = loadEdge(edgePath('newar-business-ingest/handler.ts'));
const collection = loadEdge(edgePath('collection-success-ingest/index.ts'));
const issue = loadEdge(edgePath('workorder-issue-ingest/index.ts'));
const pending = loadEdge(edgePath('withdraw-pending-ingest/index.ts'));
const reasons = loadEdge(edgePath('withdraw-reasons-ingest/core.ts'));
const config = loadEdge(edgePath('auto-withdraw-config-ingest/ar-config-contract.ts'));
const identity = loadEdge(edgePath('_shared/newar-platform-identity.ts'));
const NOW = new Date('2026-10-08T00:00:00Z'), now = NOW.getTime();
const ID = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);
const env = {SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-only'};
const scope = {country_code: 'IN', platform: 'MAAN.WIN', timezone: 'Asia/Kolkata'};
const canonicalScope = {...scope, platform: 'MAANWIN'};
const base = () => ({schema_version:1,...scope,stat_date:'2026-10-06',snapshot_id:ID,snapshot_at:'2026-10-07T01:00:00Z'});
const cover = () => ({complete:true,expected_count:0,fetched_count:0,unique_count:0});
const collectionSnapshot = () => ({...base(),source_system:'RECHARGE_REVIEW',coverage:cover(),totals:{submitted_count:0,success_count:0},groups:[]});
const pendingSnapshot = () => ({...base(),source_system:'WITHDRAW_REVIEW',coverage:cover(),totals:{pending_count:0,pending_amount:0},groups:[]});
const issueSnapshot = () => ({...base(),source_system:'AR_WORKORDER',country:'印度',coverage:{...cover(),target_count:0,ignored_count:0,unmapped_count:0},
  totals:Object.fromEntries(['submitted','success','withdraw_not_received','withdraw_success'].flatMap(k=>[[`${k}_count`,0],[`${k}_amount`,0]])),groups:[]});
function reasonsSnapshot() {
  const member = {...base(),source_system:'NEWAR',classifier_version:'note-template-v2',coverage:{...cover(),missing_order_ids:0,note_header_found:true,incomplete_note_count:0},
    totals:{total:0,auto:0,manual:0,unknown:0,success:0,reject:0,other:0},groups:[]};
  return {...structuredClone(member),classifier_version:'newar-remark-v3',note_field:'remark',member_notes:member};
}
const configSnapshot = () => ({schema_version:1,source_system:'NEW_AR',...scope,snapshot_id:ID,observed_at:'2026-10-06T01:00:00Z',observed_local_date:'2026-10-06',parser_version:'newar-config-v1',configuration:{
  fields:['autoWithdraw','ruleEnabled','withdrawAmount','todayProfitAmount','manualRechargeAmount','bonusRechargeAmount','accountBalance','firstDepositAmount','sameDeviceAccountCount','dayWithdrawLimit','lastRechargeDayLimit'].map((key,i)=>({key,label:key,kind:i<2?'boolean':'number',value:null,available:false,description:''})),channels:[],channelRules:[]}});
const batch = () => ({schema_version:1,batch_id:ID,platform:'MAAN.WIN',dataset:'charge',records:[{source_id:'synthetic-order',amount:'10.00',status_code:'Cancel',status_group:'failed',created_at:'2026-10-06T01:00:00Z',captured_at:'2026-10-07T01:00:00Z',raw:{}}]});
const coverage = () => ({schema_version:1,coverage_id:ID,platform:'MAAN.WIN',dataset:'charge',basis:'created',start_at:'2026-10-05T18:30:00Z',end_at:'2026-10-06T18:30:00Z',observed_at:'2026-10-07T01:00:00Z',source_total:1,fetched_count:1,unique_count:1,record_count:1,prelaunch_excluded:0,batch_ids:[ID],source_evidence:{request_completed:true,request_count:1,query_digest:'a'.repeat(64)}});
function businessBatch(kind = 'third_party_volume') {
  const payload = structuredClone(JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/newar_business_payloads.json')))[kind]);
  for (const rows of Object.values(payload)) if (Array.isArray(rows)) for (const row of rows) Object.assign(row,{country:'印度',country_code:'IN',platform:'MAAN.WIN',stat_date:'2026-10-06'});
  return {action:'ingest',kind,batch_id:ID,platform:'MAAN.WIN',captured_at:'2026-10-07T01:00:00Z',payload};
}
const summaryRequest = () => ({action:'summary',platform:'MAAN.WIN',kind:'third_party_volume',direction:'charge',start_at:'2026-10-05T18:30:00Z',end_at:'2026-10-06T18:30:00Z'});
const req = (body, header, key=token) => new Request('https://synthetic.invalid/edge',{method:'POST',headers:{'Content-Type':'application/json',[header]:key},body:JSON.stringify(body)});
const ack = s => ({ok:true,status:'accepted',snapshot_id:s.snapshot_id,current_snapshot_id:s.snapshot_id});
function frozenDate() { return class extends Date {constructor(...args){super(...(args.length?args:[now]));} static now(){return now;}}; }

test('only exact confirmed alias is canonical; no punctuation/case guessing or foreign-country rewriting',()=>{
  for (const v of ['maan.win','MAAN-WIN','MAAN WIN','MAAN.WIN ','OTHER',null]) assert.equal(identity.canonicalNewarPlatform(v),v);
  assert.equal(identity.canonicalNewarPlatform('MAAN.WIN'),'MAANWIN');
  assert.deepEqual(identity.canonicalMaanScope({country_code:'PK',platform:'MAAN.WIN'}),{country_code:'PK',platform:'MAAN.WIN'});
  assert.deepEqual(identity.canonicalMaanScope({country_code:'IN',platform:'DhaniWin'}),{country_code:'IN',platform:'DhaniWin'});
});
const snapshotCases = [
  ['collection',collectionSnapshot,collection.validateCollectionSnapshot,NOW],['pending',pendingSnapshot,pending.validateWithdrawPendingSnapshot,NOW],
  ['workorder',issueSnapshot,issue.validateWorkorderIssueSnapshot,NOW],['reasons',reasonsSnapshot,reasons.validateSnapshot,NOW],['config',configSnapshot,config.validateConfigSnapshot,now],
];
for (const [name,fixture,validate,clock] of snapshotCases) {
  test(`${name}: dotted and canonical inputs normalize identically without mutating evidence, IDs or caller`,()=>{
    const original=fixture(),copy=structuredClone(original),value=validate(original,clock);
    assert.deepEqual(original,copy);assert.equal(value.platform,'MAANWIN');assert.equal(value.snapshot_id,ID);
    const canonical=structuredClone(original);canonical.platform='MAANWIN';if(canonical.member_notes)canonical.member_notes.platform='MAANWIN';
    assert.deepEqual(value,validate(canonical,clock));
    if(value.member_notes)assert.equal(value.member_notes.platform,'MAANWIN');
  });
  test(`${name}: both spellings reject wrong country/timezone/source/prelaunch day, timestamp and clock`,()=>{
    for(const platform of ['MAAN.WIN','MAANWIN'])for(const mutate of [s=>s.country_code='PK',s=>s.timezone='Asia/Karachi',s=>s.source_system='WRONG',
      s=>{s.stat_date='2026-10-05';if(name==='config'){delete s.stat_date;s.observed_local_date='2026-10-05';s.observed_at='2026-10-05T01:00:00Z';}},
      s=>{if(name==='config')s.observed_at='2026-10-05T18:29:59Z';else s.snapshot_at='2026-10-05T18:29:59Z';}]) {
      const s=fixture();s.platform=platform;mutate(s);assert.throws(()=>validate(s,clock),`${platform}: ${mutate}`);
    }
    const s=fixture();assert.throws(()=>validate(s,name==='config'?Date.parse('2026-10-05T18:29:59Z'):new Date('2026-10-05T18:29:59Z')));
  });
}
test('complete-day snapshot sources retain closed-day checks; reasons/config may observe live day',()=>{
  for(const [,fixture,validate] of snapshotCases.slice(0,3)){const s=fixture();s.stat_date='2026-10-07';assert.throws(()=>validate(s,new Date('2026-10-07T01:00:00Z')));}
  assert.doesNotThrow(()=>config.validateConfigSnapshot(configSnapshot(),Date.parse('2026-10-06T02:00:00Z')));
});
test('detail and coverage normalize consistently, retain exact identity/digest, reject prelaunch for both names',()=>{
  for(const [fixture,validate] of [[batch,detail.validateNewarBatch],[coverage,detail.validateNewarCoverage]]){
    const input=fixture(),old=structuredClone(input);assert.equal(validate(input,now).platform,'MAANWIN');assert.deepEqual(input,old);
    assert.deepEqual(validate({...input,platform:'MAANWIN'},now),validate(input,now));
    for(const platform of ['MAAN.WIN','MAANWIN']){const bad=fixture();bad.platform=platform;if(bad.records)bad.records[0].created_at='2026-10-05T18:29:59Z';else bad.start_at='2026-10-05T18:29:59Z';assert.throws(()=>validate(bad,now));assert.throws(()=>validate(input,Date.parse('2026-10-05T18:29:59Z')));}
  }
  assert.deepEqual(detail.validateNewarCoverage(coverage(),now).source_evidence,coverage().source_evidence);
});
test('business all nested row sets, mirrors and summary retain country/source/date boundaries',()=>{
  for(const kind of Object.keys(business.NEWAR_BUSINESS_FIELDS)){
    const b=businessBatch(kind),copy=structuredClone(b),out=business.validateNewarBusinessBatch(b,now);assert.equal(out.platform,'MAANWIN');assert.deepEqual(b,copy);
    for(const rows of Object.values(out.payload))if(Array.isArray(rows))for(const row of rows)assert.equal(row.platform,'MAANWIN');
    const canonical=identity.canonicalNewarEnvelope(b);assert.deepEqual(out,business.validateNewarBusinessBatch(canonical,now));
    for(const platform of ['MAAN.WIN','MAANWIN']){const bad=businessBatch(kind);bad.platform=platform;for(const rows of Object.values(bad.payload))if(Array.isArray(rows))for(const row of rows)row.stat_date='2026-10-05';assert.throws(()=>business.validateNewarBusinessBatch(bad,now));}
  }
  for(const platform of ['MAAN.WIN','MAANWIN']){assert.equal(business.validateNewarSummaryRequest({...summaryRequest(),platform},now).platform,'MAANWIN');assert.throws(()=>business.validateNewarSummaryRequest({...summaryRequest(),platform,start_at:'2026-10-05T18:29:59Z'},now));}
  const wrong=businessBatch();wrong.payload.rows[0].country='巴基斯坦';assert.throws(()=>business.validateNewarBusinessBatch(wrong,now));
});
function rpcHarness(factory,header,respond) {
  const calls=[];const handler=factory({env,now:()=>now,fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body,options});assert.match(body.p_token_hash,/^[a-f0-9]{64}$/);assert.notEqual(body.p_token_hash,token);return respond(body,url);}});
  return {calls,run:(body,key)=>handler(req(body,header,key))};
}
test('detail actual HTTP paths submit canonical batch/coverage, preserve ID and echo old coverage spelling after validation',async()=>{
  let h=rpcHarness(detail.createNewarDetailHandler,'X-Newar-Detail-Key',body=>Response.json(body.p_batch?{ok:true,batch_id:ID,status:'accepted',received_count:1,written_count:1,stale_count:0}:{ok:true,coverage_id:ID,platform:'MAANWIN',dataset:'charge',basis:'created',complete:true,status:'accepted',record_count:1}));
  assert.equal((await h.run({action:'ingest',batch:batch()})).status,200);assert.equal(h.calls[0].body.p_batch.platform,'MAANWIN');
  let r=await h.run({action:'coverage',coverage:coverage()});assert.equal(r.status,200);assert.equal((await r.json()).platform,'MAAN.WIN');assert.equal(h.calls[1].body.p_coverage.platform,'MAANWIN');
  r=await h.run({action:'coverage',coverage:{...coverage(),platform:'MAANWIN'}});assert.equal((await r.json()).platform,'MAANWIN');
  h=rpcHarness(detail.createNewarDetailHandler,'X-Newar-Detail-Key',()=>Response.json({ok:true,coverage_id:ID,platform:'MAAN.WIN',dataset:'charge',basis:'created',complete:true,status:'accepted',record_count:1}));assert.equal((await h.run({action:'coverage',coverage:coverage()})).status,503);
});
test('business receipt and statistics echo caller spelling; underlying canonical receipt mismatch is rejected',async()=>{
  const response = body => {
    if(body.p_request){const r=body.p_request;return {ok:true,version:1,source:'newar_detail_stats',...r,action:undefined,available:true,availability:{rows:true},coverage:{basis:'created',range_complete:true},components:['rows'],payload:{rows:identity.canonicalNewarEnvelope(businessBatch()).payload.rows},summary:null,partial:{order_counts:null,fee_totals:null}};}
    const b=body.p_batch;return {ok:true,batch_id:ID,kind:b.kind,platform:'MAANWIN',status:'accepted',counts:Object.fromEntries(['rows','operator_rows','employee_rows','type_rows'].map(k=>[k,b.payload[k]?.length||0])),operator_insert:0,operator_update:b.payload.operator_rows?.length||0};
  };
  const h=rpcHarness(business.createNewarBusinessHandler,'X-Newar-Business-Key',body=>Response.json(response(body)));
  const b=businessBatch();let r=await h.run(b);assert.equal(r.status,200);assert.equal((await r.json()).platform,'MAAN.WIN');assert.equal(h.calls[0].body.p_batch.platform,'MAANWIN');
  r=await h.run({action:'summary',request:summaryRequest()});assert.equal(r.status,200);const out=await r.json();assert.equal(out.platform,'MAAN.WIN');assert.equal(out.payload.rows[0].platform,'MAAN.WIN');assert.equal(h.calls[1].body.p_request.platform,'MAANWIN');
  const mismatch=rpcHarness(business.createNewarBusinessHandler,'X-Newar-Business-Key',body=>Response.json({...response(body),platform:'DhaniWin'}));assert.equal((await mismatch.run(b)).status,503);assert.equal((await mismatch.run({action:'summary',request:summaryRequest()})).status,503);
});
test('detail/business dedicated auth, scope and conflict errors retain status; alias never bypasses RPC scope',async()=>{
  for(const [factory,header,body,prefix] of [[detail.createNewarDetailHandler,'X-Newar-Detail-Key',{action:'ingest',batch:batch()},'NEWAR'],[business.createNewarBusinessHandler,'X-Newar-Business-Key',businessBatch(),'NEWAR_BUSINESS']]){
    for(const [suffix,status] of [['AUTH_INVALID',401],['SCOPE_DENIED',403],['BATCH_CONFLICT',409]]){
      const h=rpcHarness(factory,header,()=>Response.json({message:`${prefix}_${suffix}`},{status:400}));assert.equal((await h.run(body)).status,status);assert.equal(h.calls.length,1);assert.equal((await h.run(body,'')).status,401);assert.equal(h.calls.length,1);
    }
  }
});
function snapshotHarness(factory,header,source,options={}) {
  const credential={source_system:source,allowed_source_systems:[source],allowed_scopes:[canonicalScope],expires_at:'2027-01-01T00:00:00Z',revoked:false,...options.credential};
  const calls=[];const handler=factory({env,now:()=>NOW,fetch:async(url,init)=>{
    calls.push({url,body:init.body?JSON.parse(init.body):null});
    if(url.includes('_credentials?'))return Response.json([credential]);
    const body=JSON.parse(init.body);if(options.respond)return options.respond(body,url);
    return Response.json(ack(body.p_snapshot));
  }});return {calls,run:body=>handler(req(body,header))};
}
for(const [name,factory,header,source,fixture] of [
  ['collection',collection.createCollectionSuccessHandler,'X-Collection-Key','RECHARGE_REVIEW',collectionSnapshot],
  ['workorder',issue.createWorkorderIssueHandler,'X-Workorder-Issue-Key','AR_WORKORDER',issueSnapshot],
  ['pending',pending.createWithdrawPendingHandler,'X-Withdraw-Pending-Key','WITHDRAW_REVIEW',pendingSnapshot],
  ['reasons',reasons.createWithdrawReasonsHandler,'X-Reasons-Key','NEWAR',reasonsSnapshot],
])test(`${name}: HTTP uses canonical scoped credential, denies unauthorized/revoked/expired before publish`,async()=>{
  let h=snapshotHarness(factory,header,source);let r=await h.run({action:'ingest',snapshot:fixture()});assert.equal(r.status,200,await r.text());assert.equal(h.calls[1].body.p_snapshot.platform,'MAANWIN');
  for(const [patch,status] of [[{revoked:true},401],[{expires_at:'2020-01-01T00:00:00Z'},401],[{allowed_scopes:[{...canonicalScope,platform:'DhaniWin'}]},403]]){
    h=snapshotHarness(factory,header,source,{credential:patch});r=await h.run({action:'ingest',snapshot:fixture()});assert.equal(r.status,status,await r.text());assert.equal(h.calls.length,1);
  }
});
test('pending chunks and final snapshot share exact canonical identity while order/manifest content is retained',async()=>{
  const s=pendingSnapshot();s.coverage={complete:true,expected_count:1,fetched_count:1,unique_count:1};s.totals={pending_count:1,pending_amount:10};s.groups=[{raw_channel:'UPI',channel_type:'UPI',pending_count:1,pending_amount:10}];
  const chunkScope=Object.fromEntries(['source_system','country_code','platform','stat_date','timezone','snapshot_id','snapshot_at'].map(k=>[k,s[k]]));
  const orders=[{order_no:'synthetic-order',member_id:'synthetic-member',amount:'10.00',applied_at:'2026-10-06 12:00:00',raw_channel:'UPI',channel_type:'UPI',status:'已提交'}];
  const body={action:'orders-chunk',scope:chunkScope,chunk_index:0,chunk_count:1,orders};
  const h=snapshotHarness(pending.createWithdrawPendingHandler,'X-Withdraw-Pending-Key','WITHDRAW_REVIEW',{respond:(b)=>Response.json(b.p_scope?{ok:true,status:'accepted',snapshot_id:ID,chunk_index:0,chunk_count:1,order_count:1}:{...ack(b.p_snapshot),details_version:1,order_count:1})});
  let r=await h.run(body);assert.equal(r.status,200,await r.text());assert.equal(h.calls[1].body.p_scope.platform,'MAANWIN');assert.deepEqual(h.calls[1].body.p_orders,orders);assert.equal(body.scope.platform,'MAAN.WIN');
  r=await h.run({action:'ingest',snapshot:s,orders_manifest:{details_version:1,chunk_count:1,order_count:1}});assert.equal(r.status,200,await r.text());assert.deepEqual(h.calls[3].body.p_snapshot.platform,h.calls[1].body.p_scope.platform);
});
test('reasons report canonical filter and dual snapshot echo, aliases cannot broaden scope or duplicate platform',async()=>{
  const canonical=reasons.validateSnapshot(reasonsSnapshot(),NOW);
  const h=snapshotHarness(reasons.createWithdrawReasonsHandler,'X-Reasons-Key','NEWAR',{respond:b=>{assert.deepEqual(b.p_platforms,['MAANWIN']);return Response.json({ok:true,snapshots:[{country_code:'IN',platform:'MAANWIN',snapshot:canonical}]});}});
  let r=await h.run({action:'report',start:'2026-10-06',end:'2026-10-06',platforms:['MAAN.WIN']});assert.equal(r.status,200, r.status===200?'':await r.clone().text());const row=(await r.json()).snapshots[0];assert.equal(row.platform,'MAAN.WIN');assert.equal(row.snapshot.platform,'MAAN.WIN');assert.equal(row.snapshot.member_notes.platform,'MAAN.WIN');
  r=await h.run({action:'report',start:'2026-10-06',end:'2026-10-06',platforms:['MAAN.WIN','MAANWIN']});assert.equal(r.status,422);
  r=await h.run({action:'report',start:'2026-10-06',end:'2026-10-06',platforms:['OTHER']});assert.equal(r.status,403);
});
function configHarness(options={}) {
  const calls=[];let handler;
  const cred={allowed_targets:['IN:MAANWIN'],expires_at:'2027-01-01T00:00:00Z',...options.credential};
  loadEdge(edgePath('auto-withdraw-config-ingest/auto-withdraw-config-ingest.ts'),{Date:frozenDate(),Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},fetch:async(url,init)=>{
    const body=init.body?JSON.parse(init.body):null;calls.push({url,body});
    if(url.includes('ar_config_credentials?'))return Response.json([cred]);
    if(url.includes('ar_config_targets?'))return Response.json([{timezone:'Asia/Kolkata',source_system:options.source||'NEW_AR'}]);
    if(url.includes('ar_config_latest?'))return Response.json([{country_code:'IN',platform:'MAANWIN',snapshot_id:ID},{country_code:'PK',platform:'MAANWIN',snapshot_id:ID},{country_code:'IN',platform:'OTHER',snapshot_id:ID}]);
    assert.ok(url.endsWith('rpc/ingest_ar_config'));return Response.json({status:'accepted',snapshot_id:ID});
  }});return {calls,run:body=>handler(req(body,'X-Config-Key'))};
}
test('config actual handler canonicalizes target/RPC, unchanged configuration hash and report echoes exact authorized alias',async()=>{
  const h=configHarness();let r=await h.run({action:'ingest',snapshot:configSnapshot()});assert.equal(r.status,200,await r.text());assert.ok(h.calls[1].url.includes('platform=eq.MAANWIN'));assert.equal(h.calls[2].body.p_snapshot.platform,'MAANWIN');
  const hash=h.calls[2].body.p_hash;const s=configSnapshot();s.platform='MAANWIN';r=await h.run({action:'ingest',snapshot:s});assert.equal(r.status,200);assert.equal(h.calls[5].body.p_hash,hash);
  r=await h.run({action:'report',country_code:'IN',platforms:['MAAN.WIN']});assert.equal(r.status,200);assert.deepEqual((await r.json()).snapshots,[{country_code:'IN',platform:'MAAN.WIN',snapshot_id:ID}]);
  for(const [opts,status] of [[{credential:{allowed_targets:['IN:DhaniWin']}},403],[{credential:{expires_at:'2020-01-01T00:00:00Z'}},401],[{source:'AR'},400]]){const denied=configHarness(opts);r=await denied.run({action:'ingest',snapshot:configSnapshot()});assert.equal(r.status,status);assert.equal(denied.calls.some(c=>c.url.includes('rpc/')),false);}
});
test('92NOVA and existing non-MAAN targets preserve fresh production launch restrictions',()=>{
  const nova={...configSnapshot(),platform:'92NOVA',country_code:'PK',timezone:'Asia/Karachi',observed_at:'2026-10-11T01:00:00Z',observed_local_date:'2026-10-11'};
  assert.doesNotThrow(()=>config.validateConfigSnapshot(nova,Date.parse('2026-10-12T00:00:00Z')));assert.throws(()=>config.validateConfigSnapshot({...nova,observed_at:'2026-10-10T01:00:00Z',observed_local_date:'2026-10-10'},Date.parse('2026-10-12T00:00:00Z')));
  const dhani={...collectionSnapshot(),platform:'DhaniWin',stat_date:'2026-09-01',snapshot_at:'2026-09-02T00:00:00Z'};assert.equal(collection.validateCollectionSnapshot(dhani,NOW).platform,'DhaniWin');
});
