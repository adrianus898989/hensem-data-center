const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const moduleObject={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/adminWorkorderRecordsRequest.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleObject,exports:moduleObject.exports});const validate=moduleObject.exports.validateWorkorderRecordsRequest;
const base={action:'workorderRecords',country:'IN',view:'records',operation:'summary',filters:{from:'2026-09-01',to:'2026-09-30'}};
test('summary and original list preserve column filters without broadening unrelated views',()=>{assert.equal(validate(base).operation,'summary');assert.equal(validate({...base,view:'orders',operation:'list'}).view,'orders');for(const q of [{...base,view:'missing'},{...base,view:'workload'},{...base,operation:'orderDetail'},{...base,view:'orders',operation:'detail'},{...base,filters:{registrationStatus:'missing'}}])assert.throws(()=>validate(q));});
test('original detail requires exact complete platform, direction and original number with bounded server paging',()=>{const q={...base,view:'orders',operation:'orderDetail',filters:{platform:'SYNTHETIC',issueKind:'withdraw',orderNo:'WD-SYNTHETIC'},limit:20,offset:100};assert.equal(validate(q).offset,100);for(const filters of [{...q.filters,from:'2026-09-01'},{...q.filters,provider:'P'},{...q.filters,issueKind:''},{...q.filters,orderNo:''},{...q.filters,workorderId:'TICKET'}])assert.throws(()=>validate({...q,filters}));for(const limit of [0,500,'20'])assert.throws(()=>validate({...q,limit}));});
test('summary rejects oversized dates, unknown keys and numeric identity coercion',()=>{for(const q of [{...base,filters:{from:'2026-06-01',to:'2026-09-30'}},{...base,filters:{from:'2026-02-30',to:'2026-03-01'}},{...base,filters:{orderNo:123}},{...base,account:{all:true}},{...base,operation:'delete'}])assert.throws(()=>validate(q));});

test('team is an explicit scalar for collected records and original-order list and summary',()=>{
 for(const view of ['records','orders'])for(const operation of ['list','summary']){const q=validate({...base,view,operation,filters:{...base.filters,team:'  M8  ',platform:'SYNTHETIC'}});assert.equal(q.filters.team,'M8');assert.equal(q.filters.platform,'SYNTHETIC');}
 assert.equal(validate({...base,filters:{team:''}}).filters.team,'');assert.equal(Object.hasOwn(validate(base).filters,'team'),false);
 for(const team of [null,undefined,7,['M8'],{team:'M8'},'A\nB','x'.repeat(201)])assert.throws(()=>validate({...base,filters:{team}}));
});
test('team cannot broaden unrelated views or precise detail identities',()=>{
 for(const team of ['M8',''])for(const q of [
  {...base,view:'missing',operation:'list',filters:{...base.filters,team}},
  {...base,view:'workload',operation:'list',filters:{...base.filters,team}},
  {...base,view:'records',operation:'detail',filters:{platform:'SYNTHETIC',workorderId:'W-1',team}},
  {...base,view:'orders',operation:'orderDetail',filters:{platform:'SYNTHETIC',orderNo:'P-1',issueKind:'deposit',team}}
 ])assert.throws(()=>validate(q));
});
