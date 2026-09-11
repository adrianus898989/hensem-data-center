const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const ts=require('typescript');
const target={country_code:'BR',platform:'TEST',timezone:'Etc/GMT+3'};
const code=ts.transpileModule(fs.readFileSync(require.resolve('../src/lib/pandaAutoWithdrawConfigClient.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function client(readConfig){const exports={};new Function('require','exports',code)(()=>({readConfig}),exports);return exports;}
const core={...target,observed_local_date:'2026-09-11',configuration:{values:{autoWithdrawalSwitch:true},unavailable_fields:[]}};
const names={schema_version:1,source_system:'PANDA',...target,channels:[],levels:[]};
test('Name fetch uses exact source target, remains independent, and attaches only same-platform dictionary',async()=>{
 const calls=[];
 const api=client(async(table,filter)=>{calls.push({table,filter});return table==='panda_config_latest'?[structuredClone(core)]:[{dictionary:names}];});
 const result=await api.fetchPandaConfigSnapshot(target,{},new AbortController().signal);
 assert.deepEqual(result.dictionary,names);assert.equal(calls.length,2);
 for(const {filter} of calls){assert.equal(filter.country_code,'eq.BR');assert.equal(filter.platform,'eq.TEST');assert.equal(filter.limit,'1');}
 assert.equal(core.dictionary,undefined);
});
test('Missing view, no dictionary, or cross-platform data never hides or changes core configuration',async()=>{
 for(const mode of ['failed','empty','platform','country','timezone','malformed']){
  const d={...names};if(mode==='platform')d.platform='OTHER';if(mode==='country')d.country_code='PH';if(mode==='timezone')d.timezone='UTC';if(mode==='malformed')d.levels=null;
  const api=client(async table=>{if(table==='panda_config_latest')return [structuredClone(core)];if(mode==='failed')throw Error('read failed');return mode==='empty'?[]:[{dictionary:d}];});
  const result=await api.fetchPandaConfigSnapshot(target,{},new AbortController().signal);
  assert.equal(result.dictionary,null,mode);assert.deepEqual(result.configuration,core.configuration);
 }
});
test('A dictionary is never substituted for an absent or failed configuration',async()=>{
 const empty=client(async table=>table==='panda_config_latest'?[]:[{dictionary:names}]);
 assert.equal(await empty.fetchPandaConfigSnapshot(target,{},new AbortController().signal),null);
 const broken=client(async table=>{if(table==='panda_config_latest')throw Error('core read failed');return [{dictionary:names}];});
 await assert.rejects(()=>broken.fetchPandaConfigSnapshot(target,{},new AbortController().signal),/core read failed/);
});
