const assert=require('node:assert/strict');const test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),React=require('react');
const {createRequire}=require('node:module');const {renderToStaticMarkup}=require('react-dom/server');
const {loadTs,root}=require('./load-typescript.cjs');
const sourceText=fs.readFileSync(path.join(root,'src/components/Dashboard.tsx'),'utf8');
const source=ts.createSourceFile('Dashboard.tsx',sourceText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const dashboard=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Dashboard');
const switchNode=dashboard.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='switchModule');
const branch=dashboard.body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(source)==='activeModule === "provider-anomalies"');
let button;
(function visit(n){if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(source)==='button'&&n.openingElement.attributes.getText(source).includes('nav-item')&&n.openingElement.attributes.getText(source).includes('switchModule("provider-anomalies")'))button=n;ts.forEachChild(n,visit);})(dashboard);
function evaluate(code,values={}){const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;return new Function('require','exports',...Object.keys(values),js+'\nreturn output;')(require,{},...Object.values(values));}
test('real anomaly navigation is independent and gated by existing third-party permission',()=>{
  assert.ok(button);assert.ok(branch);
  for(const allowed of [true,false]){
    const opened=[];const element=evaluate(`const output=${button.getText(source)};`,{activeModule:'provider-anomalies',canThirdParty:allowed,switchModule:n=>opened.push(n),DashboardGlyph:()=>null});
    assert.equal(element.props.disabled,!allowed);assert.match(renderToStaticMarkup(element),/三方异常/);
    const go=evaluate(`${switchNode.getText(source)}\nconst output=switchModule;`,{canThirdParty:allowed,canAutoWithdraw:false,canWorkSupport:false,setActiveModule:n=>opened.push(n),setPage:()=>{},loadData:()=>assert.fail('no legacy or full-order prefetch')});
    go('provider-anomalies');assert.deepEqual(opened,allowed?['provider-anomalies']:[]);
  }
});
test('revoked route access does not instantiate anomaly component or change legacy panes',()=>{
  let mounts=0;
  for(const allowed of [false,true]){
    const element=evaluate(`function render(){${branch.getText(source)}return null;}const output=render();`,{activeModule:'provider-anomalies',canThirdParty:allowed,sidebarContent:React.createElement('aside',null,'navigation'),ProviderAnomalyDashboard:()=>{mounts++;return React.createElement('section',null,'real anomaly');},ThirdPartyVolumeDashboard:()=>assert.fail('legacy page must remain independent')});
    const html=renderToStaticMarkup(element);assert.match(html,allowed?/real anomaly/:/管理员未开放/);assert.equal(mounts,allowed?1:0);
  }
  assert.ok(dashboard.body.statements.indexOf(branch)<dashboard.body.statements.findIndex(n=>ts.isReturnStatement(n)));
  assert.match(sourceText,/activeModule === "orders"/);assert.match(sourceText,/activeModule === "volume"/);
});
let fetches=0;
function loadComponent(){
  const filename=path.join(root,'src/components/ProviderAnomalyDashboard.tsx'),text=fs.readFileSync(filename,'utf8');
  const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const mod={exports:{}},native=createRequire(filename);
  new Function('require','module','exports',js)(specifier=>{
    if(specifier.endsWith('.css'))return {};
    if(specifier==='./DashboardAuthGate')return {useDashboardAuth:()=>({session:null,profile:null})};
    if(specifier==='@/lib/providerAnomalyClient')return {fetchAnomalyReport:()=>{fetches++;throw new Error('unexpected request');}};
    if(specifier.startsWith('@/'))return loadTs(path.join(root,'src',specifier.slice(2)+'.ts'));
    return native(specifier);
  },mod,mod.exports);return mod.exports;
}
test('real page initially reads no data and clearly describes local-only settings and insufficient evidence',()=>{
  const component=loadComponent();const html=renderToStaticMarkup(React.createElement(component.default));
  assert.equal(fetches,0);assert.match(html,/请选择日期，查询三方异常/);assert.match(html,/创建至成功耗时，支付时间未接入/);
  assert.match(html,/不能将未成功订单直接判作掉单/);assert.match(html,/只豁免占比/);assert.match(html,/仅本机保存，不修改全员配置/);
  assert.match(html,/最低样本数/);assert.match(html,/最低采集覆盖/);assert.match(html,/同步最大间隔/);
  assert.match(html,/不会自动调量/);assert.match(html,/无法判断/);assert.match(html,/00点附近采集窗口/);
  assert.doesNotMatch(html,/订单号|会员 ID|全部正常|系统运行正常/);
});
test('unknown real risk rows show source detail without fabricated zero counts or a green badge',()=>{
  const lib=loadTs(path.join(root,'src/lib/providerAnomaly.ts')),component=loadComponent();
  const source={key:'source',country:'香港',platform:'EK7',provider:'KnownPay',canonicalProvider:'KnownPay',currency:'未提供币种',timezone:'Asia/Kolkata',delay:null,share:null,midnight:null,successDays:[{date:'2026-09-18',total:null,success:null,coverage:null,latestAt:null}]};
  const row=lib.scoreProvider([source],lib.DEFAULT_RISK_THRESHOLDS);
  const html=renderToStaticMarkup(React.createElement('div',null,React.createElement('table',null,React.createElement('tbody',null,React.createElement(component.ProviderRiskRow,{row}))),React.createElement(component.ProviderRiskEvidence,{row})));
  assert.match(html,/无法判断/);assert.match(html,/香港 · EK7/);assert.match(html,/逐日成功率与零点档案/);assert.match(html,/代收 — \/ — 笔/);
  assert.doesNotMatch(html,/pa-normal|🟢|代收 0 \/ 0|风险分：0/);
});
test('pagination stays below results and all styles are scoped to the new page',()=>{
  const text=fs.readFileSync(path.join(root,'src/components/ProviderAnomalyDashboard.tsx'),'utf8');
  assert.ok(text.indexOf('className="pa-pagination"')>text.indexOf('className="pa-table-wrap"'));
  const css=fs.readFileSync(path.join(root,'src/components/ProviderAnomalyDashboard.css'),'utf8');
  assert.doesNotMatch(css,/(?:^|})\s*(?:table|td|th|button|input|\.main|\.nav-item)\s*[{,]/);
  assert.match(text,/result=stored\?\.owner===identity\?stored:null/);
  assert.match(text,/isDashboardDataDenied\(err\)/);assert.match(text,/setStored\(null\)/);
});
