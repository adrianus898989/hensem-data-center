const assert=require('node:assert/strict');
const {test}=require('node:test');
const path=require('node:path');
const fs=require('node:fs');
const {loadTs,root}=require('./load-typescript.cjs');
const lib=loadTs(path.join(root,'src/lib/newarDetailSearch.ts'));
const platform={platform:'POPZAR',country:'巴基斯坦',country_code:'PK',timezone:'Asia/Karachi',launch_at:null,datasets:['charge','withdraw','workorder']};
const draft={platform:'POPZAR',dataset:'withdraw',basis:'created',start:'2026-09-18T00:00:00',end:'2026-09-18T23:59:59',member:'0001',order:'0002',status:'failed'};
test('NEWAR queries use exact platform-local half-open interval including end second',()=>{
  const body=lib.newarDetailRequest(draft,platform);
  assert.equal(body.p_start_at,'2026-09-17T19:00:00.000Z');assert.equal(body.p_end_at,'2026-09-18T19:00:00.000Z');
  assert.deepEqual(body.p_filters,{member_id:'0001',order_number:'0002',status_group:'failed'});assert.equal(body.p_limit,50);
  assert.equal(lib.newarLocalInstant(draft.start,'Asia/Kolkata'),'2026-09-17T18:30:00.000Z');
});
test('bad dates/timezones/ranges and cross-platform requests are rejected',()=>{
  for(const change of [{start:'2026-02-30T00:00:00'},{start:draft.end,end:draft.start},{end:'2026-11-01T00:00:00'},
    {platform:'92BLAZE'},{dataset:'all'},{basis:'processed'},{status:'bogus'},{member:'x'.repeat(201)}]){
    assert.throws(()=>lib.newarDetailRequest({...draft,...change},platform));
  }
  assert.throws(()=>lib.newarLocalInstant(draft.start,'UTC'));
});
test('local rendering and date buttons are independent from browser timezone',()=>{
  assert.equal(lib.newarLocalTime('2026-09-17T19:00:00Z','Asia/Karachi'),'2026-09-18 00:00:00');
  assert.equal(lib.newarLocalTime(null,'Asia/Karachi'),'—');
  assert.equal(lib.newarDay('Asia/Kolkata',0,Date.parse('2026-09-17T18:45:00Z')),'2026-09-18');
  assert.equal(lib.newarDay('Asia/Karachi',0,Date.parse('2026-09-17T18:45:00Z')),'2026-09-17');
});
test('metadata validates unique supported platforms and server-provided business scope',()=>{
  assert.deepEqual(lib.validateNewarPlatforms({platforms:[platform]}),[platform]);
  for(const list of [[platform,platform],[{...platform,timezone:'UTC'}],[{...platform,datasets:[]}],[{...platform,platform:'unknown'}]])assert.throws(()=>lib.validateNewarPlatforms({platforms:list}));
});
test('response must belong to applied query; missing data cannot look like empty success',()=>{
  const request=lib.newarDetailRequest(draft,platform);
  const page={platform:'POPZAR',dataset:'withdraw',basis:'created',timezone:platform.timezone,rows:[],hasMore:false,nextCursor:null};
  assert.deepEqual(lib.validateNewarPage(page,request,platform).rows,[]);
  for(const change of [{platform:'DhaniWin'},{dataset:'charge'},{basis:'success'},{rows:null},{hasMore:true}])assert.throws(()=>lib.validateNewarPage({...page,...change},request,platform));
});
test('UI clears stale owner results, authenticates all reads, and labels missing processed time honestly',()=>{
  const source=fs.readFileSync(path.join(root,'src/components/NewarDetailSearch.tsx'),'utf8');
  for(const text of ['dashboardAuthenticatedFetch','currentOwner.current===owner','result?.owner===owner','setResult(null)','真实处理时间（尚未采集）','工单最后更新时间不冒充处理时间','未同步','币种未确认'].filter(x=>x!=='未同步'))assert.ok(source.includes(text),text);
  assert.ok(source.includes('dashboard_newar_detail_search'));
  assert.ok(!source.includes('SERVICE_ROLE'));
});
