const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {loadTs,root} = require('./load-typescript.cjs');
const api=loadTs(path.join(root,'src/lib/autoWithdrawReasonsClient.ts'));
function executeTs(file,requireFn,deno={}) {
  const code=ts.transpileModule(fs.readFileSync(file,'utf8').replaceAll('import.meta.main','false'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports','Deno',code)(requireFn,module,module.exports,deno);
  return module.exports;
}
const edge=executeTs(path.join(root,'BACKEND_CURRENT/withdraw-reasons-ingest.ts'),()=>{throw Error('Unexpected dependency');});
// Reuse the original offline Edge suite under node:test, without source/network access.
executeTs(path.join(root,'tests/withdraw-reasons-ingest.test.ts'),name=>{
  assert.equal(name,'../BACKEND_CURRENT/withdraw-reasons-ingest.ts');return edge;
},{test});
function fixture() {
  return {schema_version:1,source_system:'NEWAR',country_code:'IN',platform:'DHANI.WIN',stat_date:'2026-09-09',timezone:'Asia/Kolkata',
    snapshot_id:'01111111-0000-4000-8000-000000000001',snapshot_at:'2026-09-10T01:00:00Z',classifier_version:'note-template-v2',
    coverage:{complete:true,expected_count:1,fetched_count:1,unique_count:1,missing_order_ids:0,note_header_found:true,incomplete_note_count:0},
    totals:{total:1,auto:0,manual:1,unknown:0,success:1,reject:0,other:0},
    groups:[{operator_class:'manual',reason_key:'a'.repeat(64),reason_label:'广告代理',classification:'unclassified',count:1,success:1,reject:0,other:0,samples:[]}]};
}
function dual() {const member=fixture();return {...structuredClone(member),note_field:'remark',member_notes:member,classifier_version:'newar-remark-v3'};}
function day(s=dual()) {return {source_system:s.source_system,country_code:s.country_code,platform:s.platform,stat_date:s.stat_date,updated_at:s.snapshot_at,snapshot:s};}
test('complete dual channel validates independently and remains backward compatible',()=>{
  assert.equal(edge.validateSnapshot(dual()).note_field,'remark');
  assert.equal(edge.validateSnapshot(fixture()).source_system,'NEWAR');
  assert.equal(api.validateReasonsDay(day()).snapshot.note_field,'remark');
  assert.equal(api.reasonNoteSnapshot(day(fixture()),'reasons'),null);
  assert.equal(api.reasonNoteSnapshot(day(fixture()),'member').groups[0].reason_label,'广告代理');
});
for (const [name,mutate] of [
  ['null marker',s=>s.note_field=null],['unknown marker',s=>s.note_field='userRemark'],
  ['missing marker',s=>delete s.note_field],['other source',s=>s.source_system='PANDA'],
  ['recursive member',s=>s.member_notes.member_notes=fixture()],['member marker',s=>s.member_notes.note_field='remark'],
  ['member null',s=>s.member_notes=null],['member source',s=>s.member_notes.source_system='AR'],
  ['member platform',s=>s.member_notes.platform='OTHER'],['member date',s=>s.member_notes.stat_date='2026-09-08'],
  ['member timezone',s=>s.member_notes.timezone='UTC'],['member timestamp',s=>s.member_notes.snapshot_at='2026-09-10T01:00:01Z'],
  ['member totals',s=>s.member_notes.totals.manual=0],
]) test(`reject dual ${name} at Edge and display validator`,()=>{
  const s=dual();mutate(s);assert.throws(()=>edge.validateSnapshot(s));assert.throws(()=>api.validateReasonsDay(day(s)));
});
test('Edge rejects extra member fields and coverage mismatch',()=>{
  const s=dual();s.member_notes.raw_user_id='not permitted';assert.throws(()=>edge.validateSnapshot(s));
  delete s.member_notes.raw_user_id;s.member_notes.coverage.fetched_count=2;assert.throws(()=>edge.validateSnapshot(s));
});
test('saved member fallback has independent totals but must match exact platform and day',()=>{
  const s=dual();delete s.member_notes;const row=day(s);row.member_notes_snapshot=fixture();
  api.validateReasonsDay(row);assert.equal(api.reasonNoteSnapshot(row,'member'),row.member_notes_snapshot);
  row.member_notes_snapshot.platform='OTHER';assert.throws(()=>api.validateReasonsDay(row));
});
