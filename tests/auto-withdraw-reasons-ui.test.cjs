const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadTs, root } = require('./load-typescript.cjs');
const target = {country:'印度',platform:'TPPLAY',date:'2026-09-09'};

// Component render tests with injected hook state; no browser, login or network.
function render({expanded=false,inline=true,allowed=true,empty=false,error='',rowExpanded=false,loading=false,dayOverride=null,operator='manual',search='',page=1}={}) {
  const api = loadTs(path.join(root,'src/lib/autoWithdrawReasonsClient.ts'));
  let state = 0;
  const day = dayOverride || {stat_date:target.date,updated_at:'2026-09-10T10:49:00Z',grouping_version:'reason-category-v1',snapshot:{
    classifier_version:'note-template-v2',timezone:'Asia/Kolkata',snapshot_at:'2026-09-10T10:48:00Z',coverage:{incomplete_note_count:0},
    totals:{total:33,manual:33,auto:0,unknown:0,success:32,reject:1,other:0},
    groups:[{operator_class:'manual',reason_key:'group',reason_label:'受限游戏类型投注',classification:'template',count:33,success:32,reject:1,other:0,
      variants:[{reason_label:'会员在限制的游戏类型中总的投注数:1',count:14},{reason_label:'会员在限制的游戏类型中总的投注数:3',count:19}],samples:['脱敏样本']}]}};
  const states=[expanded?target:null,inline,expanded?{key:JSON.stringify(target),viewerKey:'test-user',day:empty?null:day}:null,error,loading,0,operator,search,page,rowExpanded];
  const react={...React,useState: initial=>React.useState(state<states.length?states[state++]:initial)};
  const source=ts.transpileModule(fs.readFileSync(path.join(root,'src/components/AutoWithdrawReasons.tsx'),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',source)(name=>{
    if(name==='react')return react;
    if(name==='react/jsx-runtime')return require(name);
    if(name==='@/lib/autoWithdrawReasonsClient')return api;
    if(name==='./DashboardAuthGate')return {useDashboardAuth:()=>({session:{access_token:'test',user:{id:'test-user'}},profile:{active:allowed,role:'owner'}})};
    throw new Error(`Unexpected dependency ${name}`);
  },module,module.exports);
  const {AutoWithdrawReasonsProvider:Provider,AutoWithdrawReasonsButton:Button,AutoWithdrawReasonsInlineRow:Row}=module.exports;
  return renderToStaticMarkup(React.createElement(Provider,{startDate:target.date,endDate:target.date,availableRows:[{...target,total:33,manualCount:33}]},
    React.createElement('table',null,React.createElement('tbody',null,
      React.createElement('tr',null,React.createElement('td',null,React.createElement(Button,target))),
      React.createElement(Row,target), React.createElement(Row,{...target,platform:'OTHER'})))));
}

test('collapsed platform stays compact with no blank details row',()=>{
  const html=render(); assert.match(html,/展开原因/); assert.match(html,/aria-expanded="false"/);
  assert.doesNotMatch(html,/class="wr-expanded-row"|role="dialog"|colSpan="16"/i);
});
test('expanded reason panel appears below exactly the selected platform, not a modal',()=>{
  const html=render({expanded:true});
  assert.equal((html.match(/class="wr-expanded-row"/g)||[]).length,1);
  assert.match(html,/colSpan="16"/i); assert.match(html,/role="region"/); assert.doesNotMatch(html,/role="dialog"|wr-backdrop/);
  assert.match(html,/收起原因/); assert.match(html,/aria-expanded="true"/);
  assert.match(html,/合并 2 项/); assert.match(html,/展开明细/);
  assert.match(html,/受限游戏类型投注/); assert.match(html,/100.00%/);
  assert.doesNotMatch(html,/会员在限制的游戏类型中总的投注数/);
});
test('toolbar lookup retains a dialog without duplicate inline panel',()=>{
  const html=render({expanded:true,inline:false});assert.match(html,/role="dialog"/);assert.match(html,/aria-modal="true"/);
  assert.doesNotMatch(html,/class="wr-expanded-row"/);
});
test('missing capture or service error is not displayed as zero successful collection',()=>{
  const missing=render({expanded:true,empty:true});assert.match(missing,/尚未同步原因数据/);assert.doesNotMatch(missing,/受限游戏类型投注/);
  const failure=render({expanded:true,error:'原因统计读取失败'});assert.match(failure,/role="alert"/);assert.doesNotMatch(failure,/合并明细/);
});
test('no permission means no row action or expanded data',()=>{
  const html=render({expanded:true,allowed:false});assert.doesNotMatch(html,/受限游戏类型投注|class="wr-expanded-row"|aria-expanded/);
});
test('original remarks expand across the reason table, not in a narrow last cell',()=>{
  const html=render({expanded:true,rowExpanded:true});
  assert.match(html,/wr-variant-row/); assert.match(html,/colSpan="5"/i);
  assert.match(html,/会员在限制的游戏类型中总的投注数:1/); assert.match(html,/>14<\/strong>/); assert.match(html,/>19<\/strong>/);
  assert.match(html,/脱敏示例，非全部订单明细/);
});
test('same-scope manual refresh keeps the visible table and open details',()=>{
  const html=render({expanded:true,rowExpanded:true,loading:true});
  assert.match(html,/读取中/); assert.match(html,/wr-variant-row/); assert.match(html,/受限游戏类型投注/);
});
test('redundant prose, versions, timestamps and one-page controls are removed',()=>{
  const html=render({expanded:true});
  assert.doesNotMatch(html,/每分钟|直接读取 Supabase|系统已自动合并|原因占比 =|reason-category-v1|note-template-v2|采集时间|入库时间|下一页/);
  assert.match(html,/方式未识别/); assert.match(html,/原因已归类；原记录未识别自动或人工/);
  assert.doesNotMatch(html,/操作方式待确认/);
});

function manyReasons(count=41) {
  return {stat_date:target.date,updated_at:'2026-09-10T10:49:00Z',snapshot:{coverage:{incomplete_note_count:0},
    totals:{total:count,manual:count,auto:0,unknown:0,success:count,reject:0,other:0},
    groups:Array.from({length:count},(_,i)=>({operator_class:'manual',reason_key:`r${String(i+1).padStart(2,'0')}`,
      reason_label:`分类原因 ${i+1}`,classification:'template',count:1,success:1,reject:0,other:0,samples:[]}))}};
}

test('compact detail puts date in the header and counts in a strip, with no metric cards',()=>{
  const html=render({expanded:true});
  assert.match(html,/class="wr-inline-panel wr-review"/);
  assert.match(html,/<header class="wr-header">[\s\S]*统计日期[\s\S]*type="date"[\s\S]*关闭原因统计[\s\S]*<\/header>/);
  assert.match(html,/class="wr-overview"/);assert.doesNotMatch(html,/class="wr-stats"/);
  assert.match(html,/人工处理<\/span><strong>33<\/strong><small title="占总笔数">100.00%/);
  assert.match(html,/自动出款<\/span><strong>0<\/strong><small title="占总笔数">0.00%/);
});

test('21 and 41 reason categories expose top and bottom pagination and last entries',()=>{
  for (const count of [21,41]) {
    const dayOverride=manyReasons(count);
    const first=render({expanded:true,dayOverride});
    assert.equal((first.match(/aria-label="原因分类分页"/g)||[]).length,2);
    assert.match(first,new RegExp(`1–20 / 共 ${count} 类`));
    const last=render({expanded:true,dayOverride,page:Math.ceil(count/20)});
    assert.match(last,new RegExp(`分类原因 ${count}<`));
    assert.match(last,new RegExp(`${count}–${count} / 共 ${count} 类`));
    assert.match(last,/disabled="" aria-label="下一页原因"/);
  }
});

test('search and fewer refreshed categories clamp page and show matched counts only',()=>{
  const dayOverride=manyReasons();
  const html=render({expanded:true,dayOverride,search:'分类原因 41',page:3});
  assert.match(html,/分类原因 41/);assert.match(html,/匹配 1 类 · 1 笔/);
  assert.match(html,/该原因笔数 ÷ 人工处理 41 笔/);
  assert.match(html,/2.44%/);assert.doesNotMatch(html,/aria-label="原因分类分页"/);
  const reduced=render({expanded:true,dayOverride:manyReasons(2),page:3});
  assert.match(reduced,/分类原因 1/);assert.match(reduced,/分类原因 2/);
});

test('long original remarks are present in full with correct span for other-status column',()=>{
  const dayOverride=manyReasons(1);
  const long='原始备注完整内容：'+'不同金额、日期和数字均需完整保留。'.repeat(40)+'结束标记';
  dayOverride.snapshot.totals={total:1,manual:1,auto:0,unknown:0,success:0,reject:0,other:1};
  dayOverride.snapshot.groups[0]={...dayOverride.snapshot.groups[0],success:0,other:1,variants:[{reason_label:long,count:1}]};
  const html=render({expanded:true,rowExpanded:true,dayOverride});
  assert.ok(html.includes(long));assert.match(html,/colSpan="6"/i);
  assert.match(html,/其他状态/);assert.match(html,/<th>其他<\/th>/);
});

test('inline width follows visible parent, without 1100px ceiling or height clipping',()=>{
  const css=fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8');
  assert.doesNotMatch(css,/\.wr-inline-panel\{[^}]*1100px/);
  assert.doesNotMatch(css,/\.wr-inline-panel\{[^}]*max-height:680px/);
  assert.match(css,/@supports\(width:1cqw\)\{\.wr-inline-panel\{width:calc\(100cqw - 16px\)\}\}/);
  assert.match(css,/\.wr-inline-panel\.wr-review \.wr-body\{overflow:visible\}/);
  assert.match(css,/\.wr-review \.wr-reason-text\{white-space:pre-wrap;overflow-wrap:anywhere/);
  assert.match(css,/\.wr-review \.wr-variant-item\{[^}]*white-space:pre-wrap;overflow-wrap:anywhere/);
});
