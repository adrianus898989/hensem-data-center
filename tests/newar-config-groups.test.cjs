const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const contract=fs.readFileSync(path.join(root,'supabase/functions/auto-withdraw-config-ingest/ar-config-contract.ts'),'utf8');
const box={exports:{}};
vm.runInNewContext(ts.transpileModule(contract,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:box,exports:box.exports,Intl,Date});
const {validateConfigSnapshot,NEWAR_SETTING_KEYS}=box.exports;
const fixture=()=>({schema_version:1,source_system:'NEW_AR',snapshot_id:'12345678-1234-4234-8234-123456789012',country_code:'IN',platform:'DhaniWin',timezone:'Asia/Kolkata',observed_at:'2026-09-20T05:00:00Z',observed_local_date:'2026-09-20',parser_version:'newar-config-v2',configuration:{
  fields:['autoWithdraw','ruleEnabled','withdrawAmount','todayProfitAmount','manualRechargeAmount','bonusRechargeAmount','accountBalance','firstDepositAmount','sameDeviceAccountCount','dayWithdrawLimit','lastRechargeDayLimit'].map((key,i)=>({key,label:key,kind:i<2?'boolean':'number',value:null,available:false,description:''})),channels:[],channelRules:[],
  settingGroups:[{id:12,configName:'默认渠道规则',configState:1,allowVirtualWithdraw:0,maxWithdrawAmount:4999,maxWithdrawTime:5,grandWithdrawTotal:1,maxWithdrawRechargeRate:8,needFirstRecharge:1,needUserNoRemark:1,needLimitGroup:0,limitGroup:'',dayProfitAmount:80000,manualRechargeOf3Day:10000,bonusRechargeOf3Day:10000,balance:30000,firstDepositAmount:4999,sameDeviceRegistCount:50,allowInvitedWheelAutoWithdraw:0,sameIpRegistCount:100,sameBankAccountCount:2,checkRejectPackage:0,rejectPackageIds:'',totalRechargeAmountOpreationType:1,totalRechargeAmount:99,checkLowOddsOrderRatio:0,lowOdds:0,lowOddsOrderRatio:0,checkRiskList:0,checkBlackListUserIdAndIp:1,totalWinLoseAmount:50000,autoWithdrawFailCount:3,totalCodingAmountMultiple:4,totalCodingAmountMultipleWithBonus:0,allowPackageIds:'',isDefaultConfig:true}]
}});
const valid=s=>JSON.parse(JSON.stringify(validateConfigSnapshot(s,Date.parse('2026-09-20T06:00:00Z'))));
test('all supplied 36 rule fields survive with zero/empty/false intact and every group retained',()=>{
  const s=fixture();assert.equal(NEWAR_SETTING_KEYS.size,36);
  s.configuration.settingGroups.push({...s.configuration.settingGroups[0],id:13,configName:'第二渠道',configState:0,isDefaultConfig:false,maxWithdrawAmount:100});
  const out=valid(s);assert.deepEqual(out.configuration.settingGroups,s.configuration.settingGroups);
  assert.equal(out.configuration.fields[0].available,false);
  assert.equal(out.configuration.fields[0].value,null);
});
test('legacy v1 still works and never silently opts into v2',()=>{
  const s=fixture();s.parser_version='newar-config-v1';delete s.configuration.settingGroups;
  assert.equal(Object.hasOwn(valid(s).configuration,'settingGroups'),false);
});
test('v2 requires explicit groups, rejects duplicate IDs, objects, secrets, nonfinite or oversized content',()=>{
  for(const mutate of [s=>delete s.configuration.settingGroups,s=>s.configuration.settingGroups.push({...s.configuration.settingGroups[0]}),
    s=>s.configuration.settingGroups[0].id='',s=>s.configuration.settingGroups[0].id=NaN,s=>s.configuration.settingGroups[0].configName='',
    s=>s.configuration.settingGroups[0].authorization='secret',s=>s.configuration.settingGroups[0].configName='Bearer SECRET',
    s=>s.configuration.settingGroups[0].balance={},s=>s.configuration.settingGroups[0].balance=Infinity,
    s=>s.configuration.settingGroups[0].limitGroup='x'.repeat(4001),s=>s.configuration.settingGroups[0].allowPackageIds=Array(1001).fill(1)]) {
    const s=fixture();mutate(s);assert.throws(()=>valid(s));
  }
});
test('unknown raw top level data never stored; complete mirror is kept for deployment',()=>{
  const s=fixture();s.token='PRIVATE_SENTINEL';s.raw='PRIVATE_SENTINEL';
  assert.equal(JSON.stringify(valid(s)).includes('PRIVATE_SENTINEL'),false);
  assert.equal(fs.readFileSync(path.join(root,'BACKEND_CURRENT/ar-config-contract.ts'),'utf8'),contract);
});
test('rule sheet renders every group read-only, including raw field keys and empty values',()=>{
  const src=fs.readFileSync(path.join(root,'src/components/NewARConfigSheet.tsx'),'utf8');
  const mod={exports:{}};
  vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:mod,exports:mod.exports,require});
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const html=renderToStaticMarkup(React.createElement(mod.exports.default,{configuration:valid(fixture()).configuration}));
  assert.match(html,/默认渠道规则/);assert.match(html,/totalCodingAmountMultipleWithBonus/);assert.match(html,/空值/);assert.match(html,/页面未提供/);
  assert.doesNotMatch(html,/<input|<button/);
});
