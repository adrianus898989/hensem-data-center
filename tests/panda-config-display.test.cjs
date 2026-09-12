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
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','exports',compiled)(name=>name.endsWith('.css')?{}:name==='../lib/pandaConfigOptionCatalog.json'?require('../src/lib/pandaConfigOptionCatalog.json'):require(name),exportsObject);
const render=(config,props={})=>renderToStaticMarkup(React.createElement(exportsObject.default,{configuration:config,countryCode:'BR',platform:'TEST',...props}));

test('Panda registered targets partition 29 Panghu / 24 Brazil / 1 Philippines without source mutation',()=>{
  const before=JSON.stringify(targets);
  const counts={};
  for(const target of targets){const key=configDisplayGroup(target,'PANDA').key;counts[key]=(counts[key]||0)+1;}
  assert.deepEqual(counts,{BR_PANGHU:29,BR:24,PH:1});
  assert.equal(JSON.stringify(targets),before);
  assert.equal(targets.length,54);
});
test('Known Panghu aliases stay separate; ordinary Brazil, other countries, and AR stay unchanged',()=>{
  const target=platform=>({country_code:'BR',country_name:'巴西',platform});
  for(const label of ['VIP345','FF555','5v555','27ff','222o','776F','222VIP','56L'])assert.deepEqual(configDisplayGroup(target(label),'PANDA'),{key:'BR_PANGHU',name:'胖虎巴西'});
  for(const label of ['SSS55','43R','POPCRA','POPNOV','POPFEZ','PLAYER BR','VIP345-extra'])assert.equal(configDisplayGroup(target(label),'PANDA').key,'BR');
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
  assert.match(html,/aria-label="选中状态未核实"/);
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
  assert.doesNotMatch(html,/默认层级|十元层级|全选/);
  assert.match(html,/超24小时/);
  assert.deepEqual(config.values.auditGameLimit,{});
  const empty=structuredClone(config);empty.values.autoWithdrawalLimitLevel=[];
  assert.match(render(empty),/未选择会员层级（\[\]）/);
  const unknown=structuredClone(config);unknown.values.autoWithdrawalLimitType='futureMode';unknown.values.autoWithdrawLimitRegTime='futureAge';
  const unknownHtml=render(unknown);
  assert.match(unknownHtml,/futureMode/);assert.match(unknownHtml,/futureAge/);
  assert.match(unknownHtml,/当前接口原值：futureMode/);
});
test('Source screenshot options are complete and ordered, with read-only disclosure instead of editable choices',()=>{
  const html=render(configuration);
  const registration=html.split('data-field="autoWithdrawLimitRegTime"')[1].split('data-field=')[0];
  const ages=['不限','超24小时','超3天','超7天','超30天'];
  let last=-1;
  for(const age of ages){const position=registration.indexOf(age);assert(position>last);last=position;}
  assert.equal((registration.match(/type="radio"/g)||[]).length,5);
  assert.equal((registration.match(/checked=""/g)||[]).length,1);
  const conditions=html.split('aria-label="其他免审条件（只读）"')[1].split('<h4>')[0];
  last=-1;
  for(const label of ['充提差额大于0的会员才免审核','历史累计亏损会员才免审核','近3天有自动解除稽核的会员必须审核','已完成首充会员才免审','代理提现必须审核(多次)','代理提现必须审核(一次)','游戏撤单后首笔提现必须审核','领取佣金必须审核(多次)','领取佣金必须审核(一次)','风控关联会员必须审核','会员首次提现若使用CPF方式则免审']){
    const position=conditions.indexOf(label);assert(position>last,label);last=position;
  }
  assert.equal((conditions.match(/class="pwc-condition"/g)||[]).length,11);
  assert.equal((conditions.match(/class="pwc-option-info"/g)||[]).length,11);
  assert.doesNotMatch(source,/onChange|onClick|fetch\(|localStorage|sessionStorage|setItem/);
});
test('Unmapped selected conditions stay visibly unknown, never silently become unchecked source options',()=>{
  const config=structuredClone(configuration);
  config.values.autoWithdrawLimitOther=['AgentWithdrawalsReviewed','CPFFirstWithdrawalExempt'];
  config.values.autoWithdrawLimitRegTime='futureAge';
  const before=JSON.stringify(config),html=render(config);
  assert.equal((html.match(/aria-label="勾选状态未核实"/g)||[]).length,0);
  assert.equal((html.match(/aria-label="选中状态未核实"/g)||[]).length,5);
  assert.doesNotMatch(html,/未映射条件：CPFFirstWithdrawalExempt/);
  assert.match(html,/checked=""\/>会员首次提现若使用CPF方式则免审/);
  assert.match(html,/当前接口原值：futureAge/);
  assert.equal(JSON.stringify(config),before);
  for(const item of [null]){
    const empty=structuredClone(config);empty.values.autoWithdrawLimitOther=item;
    assert.doesNotMatch(render(empty),/class="pwc-condition"/);
  }
  const missing=structuredClone(config);delete missing.values.autoWithdrawLimitOther;
  missing.unavailable_fields=['autoWithdrawLimitOther'];
  assert.doesNotMatch(render(missing),/class="pwc-condition"/);
});
test('HAR verified monetary fields divide cents by 100 without mutating captured values',()=>{
  const config=structuredClone(configuration);config.values.autoWithdrawDailyLimit=12345;
  assert.match(render(config),/value="123.45"/);
  assert.doesNotMatch(render(config),/金额单位尚未核实/);
  assert.equal(config.values.autoWithdrawDailyLimit,12345);
  const client=fs.readFileSync(path.join(root,'src/lib/pandaAutoWithdrawConfigClient.ts'),'utf8');
  assert.match(client,/country_code:"eq\."\+target\.country_code,platform:"eq\."\+target\.platform/);
  assert.doesNotMatch(client,/configDisplayGroup|BR_PANGHU/);
});

test('All 22 source enum values render their real selected state and 11 source tooltips',()=>{
  const catalog=require('../src/lib/pandaConfigOptionCatalog.json');
  for(const key of ['autoWithdrawalLimitType','autoWithdrawLimitRegTime','successRateType'])for(const option of catalog[key].options){
    const config=structuredClone(configuration);config.values[key]=option.code;
    const section=render(config).split('data-field="'+key+'"')[1].split('data-field=')[0];
    assert(section.includes('checked=""/>'+option.label));
    assert.equal((section.match(/checked=""/g)||[]).length,1);
  }
  for(const option of catalog.autoWithdrawLimitOther.options){
    const config=structuredClone(configuration);config.values.autoWithdrawLimitOther=[option.code];
    const html=render(config);assert(html.includes('checked=""/>'+option.label));assert(html.includes(option.tooltip));
  }
  const config=structuredClone(configuration);config.values.autoWithdrawalLimitType='firstWithdraw';
  assert.doesNotMatch(render(config),/data-field="autoWithdrawalLimitAmount"/);
  assert.equal(config.values.autoWithdrawalLimitAmount,configuration.values.autoWithdrawalLimitAmount);
  assert.match(render(config),/不自动下架/);
});
test('BR-only CPF option does not leak into PH, but unexpected saved raw values are retained',()=>{
  const config=structuredClone(configuration);config.values.autoWithdrawLimitOther=[];
  const ph=render(config,{countryCode:'PH'});assert.doesNotMatch(ph.split('pwc-technical')[0],/会员首次提现若使用CPF方式则免审/);
  assert.equal((ph.match(/class="pwc-condition"/g)||[]).length,10);
  config.values.autoWithdrawLimitOther=['CPFFirstWithdrawalExempt'];
  assert.match(render(config,{countryCode:'PH'}),/未映射条件：CPFFirstWithdrawalExempt/);
});
test('Per-platform level and channel names show all actual options without allowing edits',()=>{
  const config=structuredClone(configuration);config.values.autoWithdrawalLimitLevel=[17];
  const dictionary={country_code:'BR',platform:'TEST',observed_local_date:'2026-09-11',levels:[{id:17,name:'默认层级'},{id:29,name:'五元玩家'}],channels:[{id:1198,name:'本盘通道甲',withdraw_type_id:config.values.autoWithdrawalChannel[0].tenantWithdrawTypeId},{id:5001,name:'本盘通道乙',withdraw_type_id:config.values.autoWithdrawalChannel[0].tenantWithdrawTypeId},{id:5002,name:'另一提现类型',withdraw_type_id:999}]};
  const before=JSON.stringify({config,dictionary}),html=render(config,{dictionary});
  assert.match(html,/checked=""\/>默认层级/);assert.match(html,/disabled=""\/>五元玩家/);
  assert.match(html,/class="pwc-level-grid"/);assert.match(html,/全选/);
  assert.match(html,/本盘通道甲/);assert.match(html,/本盘通道乙/);assert.doesNotMatch(html,/另一提现类型/);
  assert.match(html,/展开查看选项（只读）/);assert.doesNotMatch(html,/<form|<button|<select/);
  assert.equal(JSON.stringify({config,dictionary}),before);
  const wrong=render(config,{dictionary:{...dictionary,platform:'OTHER'}});
  assert.doesNotMatch(wrong,/本盘通道甲|五元玩家/);assert.match(wrong,/通道 ID：1198/);
  config.values.autoWithdrawalLimitLevel=[17,29];assert.match(render(config,{dictionary}),/checked=""\/>全选/);
  config.values.autoWithdrawalLimitLevel=[17,29,1000];assert.match(render(config,{dictionary}),/层级 ID：1000/);
  assert.doesNotMatch(render(config,{dictionary}),/checked=""\/>全选/);
});
module.exports={render,configuration,configDisplayGroup,targets};
