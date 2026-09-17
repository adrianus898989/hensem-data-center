// Public synthetic renderer/client tests. Optional WG_UI_HAR_FIXTURE enables
// additional LOCAL safe-HAR validation; no private fixture is needed by CI.
// No browser login, network requests or backend writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
function syntheticConfiguration(){
  const levels=[...Array.from({length:10},(_,index)=>({id:index+1,level_id:index+1,name:'VIP'+index})),
    {id:180111,level_id:10000,name:'刷子玩家'},{id:15,level_id:10005,name:'代理返佣固定级别'},
    {id:30002,level_id:10006,name:'黑名单客户'},{id:60002,level_id:10007,name:'推广代理'},
    {id:120002,level_id:10008,name:'活动黑名单'},{id:150002,level_id:10009,name:'测试账号'}];
  const amount={minAuditAmount:'0',total24Amount:'',selectType:0,merchList:[],reviewAmount:'0',reviewAmountByTime:24,receivedAmount:'0',receivedAmountByTime:24,designateBank:null};
  const toggle=()=>({status:false});
  const setting={exemptSwitch:1,unavoidableCauseRemarkSwitch:0,levelIds:[1,2,10005],tagIds:[2],registerTime:0,
    requiredLevelIds:[10006,10008,10009],requiredTagIds:[1],requiredRegisterTime:0,noRequiredTagIds:[],otherCondition:null,
    exemptAmountList:[{...amount,currency:'BRL',currencyName:''}],PIXCondition:[],reviewBankCodeList:null,betGameLimit:{games:null,days:0},
    exemptMemberLevelAmount:[{...amount,memberLevelId:0,minAuditAmount:'50000',reviewAmount:'50000',receivedAmount:'',receivedAmountByTime:0},...levels.map(level=>({...amount,memberLevelId:level.level_id}))],
    mustBeReviewedAmountList:[{...amount,currency:'BRL',currencyName:'',designateBank:[]}],
    mustBeReviewedMemberLevelAmountList:[0,...levels.map(level=>level.level_id)].map(id=>({...amount,memberLevelId:id,minAuditAmount:'500',reviewAmount:'',receivedAmount:'500',designateBank:[]})),
    otherConditionV2:{firstFewWithdrawals:{status:true,value:1},withdrawalAccountFirstWithdrawal:{status:false,excludeNoWallet:false,excludeThirdPartyWallet:false},
      riskControlRulesAndNotAddressed:{status:true},gamblingRiskControlRulesAndNotAddressed:toggle(),depositAndWithdrawalDifferenceGreaterThan0:toggle(),accumulatedHistoricalLoss:toggle(),
      last3DaysSystemReleaseAudit:{status:false,day:3},firstDepositIsComplete:{status:true},depositAndWithdrawalCPFIsInconsistent:toggle(),withdrawalIsRefusedOrCancelled:{status:true,value:3},
      withdrawalIPDoesNotHaveTheSameName:toggle(),codingMultiple:{status:true,day:3,multiple:2},depositAndWithdrawalDifference:{status:true,ratio:1,difference:100},
      memberSuccessWithdraw:{status:true,severalTimes:3},withdrawalDeviceAccountNumber:{status:true,value:10},rechargeWithdrawalBalanceDifference:{status:true,day:3,multiple:10000},
      firstUseWalletWithdraw:toggle(),firstUseNoWalletWithdraw:toggle(),perUseNoWalletWithdraw:toggle(),perUseWalletWithdraw:toggle(),
      totalWithdrawalFrequency:{status:false,severalTimes:1},mustBeReceivedDiscount:{severalHours:24,specifiedDiscount:[]},manualDepositAudit:{status:true,day:7},
      sportRollingBetProfit:{status:false,amount:0},exemptRechargeWithdrawalDifference:{status:false,day:0,difference:0},exemptCodingMultiple:{status:false,day:0,multiple:0},requiredWithdrawTypes:null}};
  const settings=Object.fromEntries(['0','278','8311','12588'].map(key=>[key,structuredClone(setting)]));
  settings['278'].requiredLevelIds=[10006];settings['8311'].requiredLevelIds=[10008];settings['12588'].requiredLevelIds=[10009];settings['8311'].unavoidableCauseRemarkSwitch=1;
  return {settings,dictionaries:{levels,tags:[{id:1,name:'测试标签甲'},{id:2,name:'测试标签乙'}],
    activities:[{optType:6,optTypeTxt:'活动',dealTypeList:[{dealType:6109,dealTypeTxt:'充值活动',activeList:[{ActiveId:1,ActiveName:'合成充值优惠'}]}]},
      {optType:7,optTypeTxt:'任务',dealTypeList:[{dealType:7101,dealTypeTxt:'合成任务',activeList:[]}]}],
    withdraw_types:[{id:1,name:'合成提现方式',weight:0,child:[{id:101,name:'合成提现子类型',weight:0}]}],merchants:[{id:1,value:'合成渠道甲'},{id:2,value:'合成渠道乙'}]},
    completeness:{available:['settings','levels','tags','activities','withdraw_types','merchants'],unavailable:['games','banks']}};
}
const config=syntheticConfiguration();
const members=[{site_code:'278',name:'26bet'},{site_code:'8311',name:'POPKKK'},{site_code:'12588',name:'POPMIU'}];
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const contract={};new Function('exports',compile(fs.readFileSync(path.join(root,'src/lib/wgConfigContract.ts'),'utf8')))(contract);
const source=fs.readFileSync(path.join(root,'src/components/WGConfigSheet.tsx'),'utf8');
function sheet(react=React){const exports={};new Function('require','exports',compile(source))(name=>name.endsWith('.css')?{}:name==='react'?react:require(name),exports);return exports;}
const component=sheet();
const render=(configuration=config)=>renderToStaticMarkup(React.createElement(component.default,{configuration,members}));
const brand=(setting=config.settings['0'],configuration=config)=>renderToStaticMarkup(React.createElement(component.WGBrandSettings,{setting,configuration}));
const section=(html,key)=>html.split('data-field="'+key+'"')[1]?.split('data-field="')[0]||'';

test('Synthetic settings render with all brands and source-order sections, without modifying any saved values',()=>{
  contract.validateWGConfiguration(config);
  const before=JSON.stringify(config),html=render();
  const tabs=html.split('aria-label="WG 品牌设置"')[1].split('</div>')[0];
  let last=-1;for(const name of ['默认设置','26bet（278）','POPKKK（8311）','POPMIU（12588）']){const index=tabs.indexOf(name);assert(index>last,name);last=index;}
  last=-1;for(const key of ['exemptSwitch','unavoidableCauseRemarkSwitch','requiredLevelIds','requiredTagIds','noRequiredTagIds','requiredRegisterTime','requiredWithdrawTypes','withdrawalAccountFirstWithdrawal','firstFewWithdrawals','requiredTurnover','PIXCondition','riskConditions','mustBeReceivedDiscount','betGameLimit','mustBeReviewedMemberLevelAmountList','levelIds','tagIds','registerTime','walletConditions','totalWithdrawalFrequency','exemptTurnover','exemptMemberLevelAmount','paymentSettings']){const index=html.indexOf('data-field="'+key+'"');assert(index>last,key);last=index;}
  assert.equal(JSON.stringify(config),before);
  assert.match(html,/免财务出款人工审核步骤，不含风控出款/);
});
test('All saved controls are readonly/disabled; there is no save/copy/apply action or source request',()=>{
  const html=render(),inputs=html.match(/<input\b[^>]*>/g)||[];
  assert(inputs.length>120);
  assert(inputs.every(input=>/readonly=""|disabled=""/.test(input)));
  const buttons=html.match(/<button\b[^>]*>/g)||[];
  assert(buttons.length>10&&buttons.every(button=>/role="tab"/.test(button)));
  assert.doesNotMatch(html,/<form|<select|type="submit"|应用到全部|>确认</);
  assert.doesNotMatch(source,/\bonChange\b|\bfetch\s*\(|localStorage|sessionStorage|\.settings\[[^\]]+\]\s*=/);
});
test('Level selection uses level_id, never the unrelated dictionary record id',()=>{
  const copy=structuredClone(config);copy.settings['0'].requiredLevelIds=[10006];
  const html=section(brand(copy.settings['0'],copy),'requiredLevelIds');
  assert.match(html,/checked=""[^>]*\/><span>黑名单客户/);
  assert.doesNotMatch(html,/未映射 ID：10006/);
  copy.settings['0'].requiredLevelIds=[30002];
  const wrong=section(brand(copy.settings['0'],copy),'requiredLevelIds');
  assert.match(wrong,/未映射 ID：30002/);
  assert.doesNotMatch(wrong,/checked=""[^>]*\/><span>黑名单客户/);
});
test('All/partial selection and unknown selected IDs are explicit',()=>{
  const copy=structuredClone(config),ids=copy.dictionaries.levels.map(level=>level.level_id);
  copy.settings['0'].requiredLevelIds=ids;
  assert.match(section(brand(copy.settings['0'],copy),'requiredLevelIds'),/checked=""[^>]*\/><span>全选/);
  copy.settings['0'].requiredLevelIds=[ids[0]];
  assert.match(section(brand(copy.settings['0'],copy),'requiredLevelIds'),/aria-checked="mixed"/);
  copy.settings['0'].requiredLevelIds=[...ids,999999];
  const html=section(brand(copy.settings['0'],copy),'requiredLevelIds');
  assert.doesNotMatch(html,/checked=""[^>]*\/><span>全选/);assert.match(html,/未映射 ID：999999/);
});
test('Default and each brand keep independent switches and selected lists',()=>{
  for(const [key,setting] of Object.entries(config.settings)){
    const html=brand(setting);
    const levels=section(html,'requiredLevelIds');
    for(const level of config.dictionaries.levels){
      const escaped=level.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const match=levels.match(new RegExp('<input[^>]*><span>'+escaped));
      assert(match,key+':'+level.name);
      assert.equal(/checked=""/.test(match[0]),setting.requiredLevelIds.includes(level.level_id),key+':'+level.name);
    }
    const remark=section(html,'unavoidableCauseRemarkSwitch');
    assert.match(remark,new RegExp('当前原值：'+setting.unavoidableCauseRemarkSwitch+'；开关映射待核实'));
    assert.doesNotMatch(remark,/checked=""|class="selected"/);
    assert.match(section(html,'exemptSwitch'),/checked=""[^>]*\/>开启免审自动出款/);
  }
});
test('Unverified remark switch preserves every raw code without any selected-state hint; verified switch stays unchanged',()=>{
  for(const value of [0,1,7,null]){
    const copy=structuredClone(config);copy.settings['0'].unavoidableCauseRemarkSwitch=value;
    const before=JSON.stringify(copy),html=brand(copy.settings['0'],copy),remark=section(html,'unavoidableCauseRemarkSwitch');
    assert.match(remark,new RegExp('当前原值：'+JSON.stringify(value)+'；开关映射待核实'));
    assert.equal((remark.match(/aria-label="开关选中状态未核实"/g)||[]).length,2);
    assert.doesNotMatch(remark,/<input|class="selected"|aria-checked="true"/);
    assert.match(remark,/关闭不免审原因订单备注/);assert.match(remark,/开启不免审原因订单备注/);
    assert.match(section(html,'exemptSwitch'),/class="selected"><input type="radio" disabled="" checked=""\/>开启免审自动出款/);
    assert.equal(JSON.stringify(copy),before);
  }
});
test('Layer zero means 全部层级 and is independent of global currency values; no currency scaling',()=>{
  const html=brand();
  const exempt=section(html,'exemptMemberLevelAmount');
  assert.match(exempt,/aria-selected="true"[^>]*>全部层级/);
  assert.match(exempt,/value="50000"/);assert.doesNotMatch(exempt,/value="500\.00"/);
  const required=section(html,'mustBeReviewedMemberLevelAmountList');assert.match(required,/value="500"/);
  assert.match(html,/全局币种免审条件[^]*?value="0"/);
  assert.equal(config.settings['0'].exemptMemberLevelAmount[0].minAuditAmount,'50000');
  assert.equal(config.settings['0'].exemptAmountList[0].minAuditAmount,'0');
});
test('Empty string, zero, null and unknown enum cannot masquerade as one another',()=>{
  const copy=structuredClone(config);
  copy.settings['0'].requiredRegisterTime=72;
  copy.settings['0'].exemptMemberLevelAmount[0].selectType=91;
  const html=brand(copy.settings['0'],copy);
  const registration=section(html,'requiredRegisterTime');
  assert.match(registration,/当前接口原值：72/);assert.doesNotMatch(registration,/checked=""/);
  assert.match(section(html,'requiredWithdrawTypes'),/当前原值[^]*?<pre>null<\/pre>/);
  assert.match(section(html,'mustBeReviewedMemberLevelAmountList'),/placeholder="未填写" value=""/);
  assert.match(section(html,'paymentSettings'),/当前代付模式原码：91/);
  assert.doesNotMatch(section(html,'paymentSettings'),/checked=""[^>]*\/>自动匹配三方代付/);
});
test('Offer tree preserves all source names and hierarchy but makes only expansion interactive',()=>{
  const html=section(brand(),'mustBeReceivedDiscount');
  assert.match(html,/<details class="wgc-tree-branch"><summary>/);
  for(const item of config.dictionaries.activities)assert(html.includes(item.optTypeTxt));
  for(const name of ['活动','充值活动','合成充值优惠','任务'])assert(html.includes(name),name);
  assert.doesNotMatch(html,/checked=""/);
  assert.match(html,/指定优惠选项（只读）/);
});
test('Grouped discount selections use the complete parent path, preserve empty children and stay readonly',()=>{
  const copy=structuredClone(config);
  const selected=[{optType:6,dealType:6109,activeIds:[1]},{optType:7,dealType:7101,activeIds:[]}];
  copy.settings['0'].otherConditionV2.mustBeReceivedDiscount.specifiedDiscount=selected;
  copy.dictionaries.activities[1].dealTypeList[0].activeList=[{ActiveId:1,ActiveName:'合成同ID不同路径'}];
  copy.settings['0'].betGameLimit.games=[{categoryId:1,platformId:2,gameIds:[]}];
  contract.validateWGConfiguration(copy);
  const before=JSON.stringify(copy),html=brand(copy.settings['0'],copy),offers=section(html,'mustBeReceivedDiscount');
  assert.match(offers,/checked=""[^>]*\/><span>合成充值优惠/);
  assert.doesNotMatch(offers,/checked=""[^>]*\/><span>合成同ID不同路径/);
  assert.match(offers,/空 activeIds 或未匹配部分不推断为全选、全不选/);
  const raw=offers.match(/<pre>([\s\S]*?)<\/pre>/)[1].replaceAll('&quot;','"');
  assert.deepEqual(JSON.parse(raw),selected);
  assert.match(section(html,'betGameLimit'),/空 gameIds 不推断为全部游戏或没有游戏/);
  assert.equal(JSON.stringify(copy),before);
  assert((html.match(/<input\b[^>]*>/g)||[]).every(input=>/readonly=""|disabled=""/.test(input)));
});
test('Unknown game and bank catalogs are not replaced by guessed screenshot options',()=>{
  const html=render();assert.match(html,/游戏名单、银行名单尚未提供/);
  assert.match(section(html,'betGameLimit'),/游戏名称与候选名单尚未同步/);
  assert.doesNotMatch(section(html,'betGameLimit'),/TADA|BGaming|Funkygames/);
  assert.match(section(html,'mustBeReviewedMemberLevelAmountList'),/银行名称待同步/);
});
test('Tab callbacks change browse state only, not the snapshot or selected conditions',()=>{
  const before=JSON.stringify(config),states=[];let cursor=0;
  const fakeReact={...React,useState(initial){const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],next=>{states[index]=typeof next==='function'?next(states[index]):next;}];}};
  const exports=sheet(fakeReact);
  cursor=0;let tree=exports.default({configuration:config,members});
  const find=(node,predicate)=>{if(!node)return null;if(Array.isArray(node)){for(const child of node){const result=find(child,predicate);if(result)return result;}return null;}if(typeof node==='object'){if(predicate(node))return node;return find(node.props?.children,predicate);}return null;};
  const tab=find(tree,node=>node.type==='button'&&node.props.children==='POPKKK（8311）');assert(tab);tab.props.onClick();
  cursor=0;tree=exports.default({configuration:config,members});
  const panel=find(tree,node=>node.props?.role==='tabpanel');assert.equal(panel.props['aria-label'],'POPKKK（8311）');
  const brandNode=find(tree,node=>node.type===exports.WGBrandSettings);assert.equal(brandNode.props.setting,config.settings['8311']);
  assert.equal(JSON.stringify(config),before);
});

const clientSource=fs.readFileSync(path.join(root,'src/lib/wgAutoWithdrawConfigClient.ts'),'utf8');
function client(readConfig){const exports={};new Function('require','exports',compile(clientSource))(name=>name==='./wgConfigContract'?contract:{readConfig},exports);return exports;}
const target={country_code:'BR',country_name:'巴西',platform:'26BET',timezone:'America/Sao_Paulo',site_code:'278',members};
const stored={country_code:'BR',platform:'26BET',site_code:'278',timezone:'America/Sao_Paulo',observed_at:'2026-01-01T12:00:00+00:00',observed_local_date:'2026-01-01',snapshot_id:'11111111-1111-4111-8111-111111111111',parser_version:'wg-config-v1',received_at:'2026-01-01T12:01:00+00:00',configuration:config};
test('WG index and detail use only exact scoped WG read tables, with a validated reconstructed snapshot',async()=>{
  const calls=[],api=client(async(table,query)=>{calls.push({table,query});return table==='wg_config_targets'?[target]:[stored];});
  const index=await api.fetchWGConfigIndex({},new AbortController().signal);assert.equal(index.targets[0],target);
  const result=await api.fetchWGConfigSnapshot(target,{},new AbortController().signal);assert.deepEqual(result.configuration,config);
  assert.deepEqual(calls.map(call=>call.table),['wg_config_targets','wg_config_latest','wg_config_latest']);
  assert.equal(calls[2].query.country_code,'eq.BR');assert.equal(calls[2].query.platform,'eq.26BET');
  assert.doesNotMatch(clientSource,/POST|PUT|PATCH|DELETE|\/api\/|X-Config-Key|source.*host|document|localStorage/);
});
test('Wrong group/site/timezone/date/parser and incomplete brands fail closed',async()=>{
  for(const mutate of [r=>r.country_code='VN',r=>r.platform='98VV',r=>r.site_code='3257',r=>r.timezone='UTC',r=>r.observed_local_date='2026-01-02',r=>r.parser_version='unknown',r=>delete r.configuration.settings['8311'],r=>r.configuration.settings['999']=structuredClone(r.configuration.settings['0'])]){
    const altered=structuredClone(stored);mutate(altered);
    const api=client(async()=>[altered]);await assert.rejects(()=>api.fetchWGConfigSnapshot(target,{},new AbortController().signal),/WG 配置响应不完整/);
  }
});
test('Absent configuration and transport/abort failure never become fabricated configuration',async()=>{
  assert.equal(await client(async()=>[]).fetchWGConfigSnapshot(target,{},new AbortController().signal),null);
  await assert.rejects(()=>client(async()=>{throw Error('aborted');}).fetchWGConfigSnapshot(target,{},new AbortController().signal),/aborted/);
  const invalidTarget={...target,site_code:278};
  await assert.rejects(()=>client(async table=>table==='wg_config_targets'?[invalidTarget]:[]).fetchWGConfigIndex({},new AbortController().signal),/WG 配置响应不完整/);
});
test('WG remains isolated while AR/PANDA/NEW_AR use the shared browser shell',()=>{
  const auto=fs.readFileSync(path.join(root,'src/components/AutoWithdrawConfig.tsx'),'utf8');
  assert.match(auto,/system==="WG"\?<WGConfigBrowser\/>:system==="GAME66_HK"/);
  assert.match(auto,/function ConfigBrowser\(\{system\}:\{system:"AR"\|"NEW_AR"\|"PANDA"\}\)/);
  assert.match(auto,/system==="NEW_AR"\?fetchNewARConfigIndex/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'src/lib/pandaConfigDisplayGroup.ts'),'utf8'),/WG/);
  const browser=fs.readFileSync(path.join(root,'src/components/WGConfigBrowser.tsx'),'utf8');
  assert.match(browser,/配置已同步，部分选项未齐/);
  assert.match(browser,/controller\.abort\(\)/);assert.match(browser,/!controller\.signal\.aborted/);
  assert.doesNotMatch(browser,/fetchPanda|fetchConfigSnapshot|\/api\/|X-Config-Key/);
});
test('Optional LOCAL safe HAR projection validates and renders without mutation',{skip:!process.env.WG_UI_HAR_FIXTURE},()=>{
  const local=JSON.parse(fs.readFileSync(process.env.WG_UI_HAR_FIXTURE,'utf8')).configuration;
  contract.validateWGConfiguration(local);const before=JSON.stringify(local),html=render(local);
  assert.equal(JSON.stringify(local),before);assert.match(html,/默认设置/);
  assert((html.match(/<input\b[^>]*>/g)||[]).every(input=>/readonly=""|disabled=""/.test(input)));
  for(const [key,setting] of Object.entries(local.settings)){
    const markup=brand(setting,local);assert.match(markup,/必审会员层级/);
    for(const level of local.dictionaries.levels)assert(markup.includes(level.name),key+':'+level.name);
    const remark=section(markup,'unavoidableCauseRemarkSwitch');
    assert.match(remark,new RegExp('当前原值：'+setting.unavoidableCauseRemarkSwitch+'；开关映射待核实'));
    assert.doesNotMatch(remark,/<input|class="selected"/);
  }
});
