const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {loadTs,root}=require('./load-typescript.cjs');
const {configDisplayGroup}=loadTs(path.join(root,'src/lib/pandaConfigDisplayGroup.ts'));
const targets=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/panda-config-targets.json'),'utf8')).targets;
const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/panda-supplied-response.json'),'utf8')).result.data.json;
const values=structuredClone(raw);
for(const key of ['auditGameLimit','levelMultiples'])values[key]=JSON.parse(values[key]);
const configuration={values,unavailable_fields:[]};
const source=fs.readFileSync(path.join(root,'src/components/PandaConfigSheet.tsx'),'utf8');
const exportsObject={};
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','exports',compiled)(name=>name.endsWith('.css')?{}:require(name),exportsObject);
const render=config=>renderToStaticMarkup(React.createElement(exportsObject.default,{configuration:config}));

test('Panda registered targets partition 31 Panghu / 22 Brazil / 1 Philippines without source mutation',()=>{
  const before=JSON.stringify(targets);
  const counts={};
  for(const target of targets){const key=configDisplayGroup(target,'PANDA').key;counts[key]=(counts[key]||0)+1;}
  assert.deepEqual(counts,{BR_PANGHU:31,BR:22,PH:1});
  assert.equal(JSON.stringify(targets),before);
  assert.equal(targets.length,54);
});
test('Known Panghu aliases stay separate; ordinary Brazil, other countries, and AR stay unchanged',()=>{
  const target=platform=>({country_code:'BR',country_name:'巴西',platform});
  for(const label of ['VIP345','FF555','5v555','27ff','222o','POPCRA','POPNOV','POPFEZ','222VIP','56L'])assert.deepEqual(configDisplayGroup(target(label),'PANDA'),{key:'BR_PANGHU',name:'胖虎巴西'});
  for(const label of ['SSS55','43R','776F','PLAYER BR','VIP345-extra'])assert.equal(configDisplayGroup(target(label),'PANDA').key,'BR');
  assert.deepEqual(configDisplayGroup(target('VIP345'),'AR'),{key:'BR',name:'巴西'});
  assert.equal(configDisplayGroup({...target('VIP345'),country_code:'PH'},'PANDA').key,'PH');
});
test('Configured controls are truly read-only; fields and source values stay unchanged',()=>{
  const before=JSON.stringify(configuration),html=render(configuration);
  const inputs=html.match(/<input\b[^>]*>/g)||[];
  assert(inputs.length>=10);
  assert(inputs.every(tag=>/readonly=""|disabled=""/.test(tag)));
  assert((html.match(/<select\b[^>]*>/g)||[]).every(tag=>/disabled=""/.test(tag)));
  assert.match(html,/value="10\.00"/);
  assert.match(html,/value="1999\.00"/);
  assert.match(html,/value="80\.00"/);
  assert.match(html,/value="1000"/);
  assert.equal(JSON.stringify(configuration),before);
  assert.equal((html.match(/type="checkbox"[^>]*checked=""/g)||[]).length,3);
  assert.doesNotMatch(html,/<button|<form|<textarea/);
});
test('Technical fields are collapsed, channel IDs preserved, and no names are invented',()=>{
  const html=render(configuration);
  assert.match(html,/<details class="pwc-technical"><summary>技术详情/);
  const front=html.split('<details class="pwc-technical">')[0];
  assert.doesNotMatch(front,/<small[^>]*>autoWithdraw|<small[^>]*>AgentWithdrawals|CBPAY|KUBAO|CEPAY/);
  for(const id of [1198,1213,1210,1424])assert.match(front,new RegExp('通道 ID：'+id));
  assert.match(front,/PIX 是提现类型/);
  assert.equal((front.match(/class="pwc-channel"/g)||[]).length,4);
});
test('Missing/null/unknown enums are not rendered as zero or an invented disabled state',()=>{
  const config=structuredClone(configuration);
  delete config.values.orderVolume;config.unavailable_fields=['orderVolume'];
  config.values.autoWithdrawManualGiftLimit=null;
  config.values.autoWithdrawLimitOther=['UnmappedSelected'];
  config.values.successRateType='UnknownRateMode';
  const html=render(config);
  assert.match(html,/data-field="orderVolume"[^]*?接口未提供/);
  assert.match(html,/data-field="autoWithdrawManualGiftLimit"[^]*?接口返回空值/);
  assert.match(html,/未映射条件：UnmappedSelected/);
  assert.match(html,/UnknownRateMode/);
  assert.doesNotMatch(html,/aria-label="成功率配置（只读）"/);
});
test('Each platform displays its returned level IDs and empty game object, without screenshot-derived options',()=>{
  const config=structuredClone(configuration);
  config.values.autoWithdrawalLimitType='firstWithdraw';
  config.values.auditGameLimit={};
  config.values.autoWithdrawalLimitLevel=[17,29];
  config.values.autoWithdrawLimitOther=['MembersWithPositiveDepositWithdrawalDifference'];
  const html=render(config);
  assert.match(html,/checked=""\/>会员首次提现必须审核/);
  assert.match(html,/接口返回空对象（\{\}）/);
  assert.match(html,/层级 ID：17/);assert.match(html,/层级 ID：29/);
  assert.match(html,/checked=""\/>充提差额大于0的会员才免审核/);
  assert.doesNotMatch(html,/默认层级|十元层级|全选|超24小时/);
  assert.deepEqual(config.values.auditGameLimit,{});
  const empty=structuredClone(config);empty.values.autoWithdrawalLimitLevel=[];
  assert.match(render(empty),/未选择会员层级（\[\]）/);
  const unknown=structuredClone(config);unknown.values.autoWithdrawalLimitType='futureMode';unknown.values.autoWithdrawLimitRegTime='futureAge';
  const unknownHtml=render(unknown);
  assert.match(unknownHtml,/futureMode/);assert.match(unknownHtml,/futureAge/);
  assert.doesNotMatch(unknownHtml,/aria-label="首次提款限制（只读）"/);
});
test('Nonzero unverified money is not rescaled and display grouping is not used in API requests',()=>{
  const config=structuredClone(configuration);config.values.autoWithdrawDailyLimit=12345;
  assert.match(render(config),/value="12345"/);
  assert.match(render(config),/金额单位尚未核实/);
  const client=fs.readFileSync(path.join(root,'src/lib/pandaAutoWithdrawConfigClient.ts'),'utf8');
  assert.match(client,/country_code:"eq\."\+target\.country_code,platform:"eq\."\+target\.platform/);
  assert.doesNotMatch(client,/configDisplayGroup|BR_PANGHU/);
});

module.exports={render,configuration,configDisplayGroup,targets};
