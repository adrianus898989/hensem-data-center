// Execute the existing production table and integrated filter JSX with fixture
// orders. No accounts, browser session, API requests or database writes.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {loadTs,root}=require('./load-typescript.cjs');
const text=fs.readFileSync(path.join(root,'src/components/ThirdPartyVolumeDashboard.tsx'),'utf8');
const source=ts.createSourceFile('ThirdPartyVolumeDashboard.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const main=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ThirdPartyVolumeDashboard');
function compile(code){return ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;}
const libs=['format','thirdPartyNameMap','thirdPartyPlatform','platformDisplayCountry','collectionSuccess','withdrawPending','withdrawActual','workOrderDeposit','orderTimeVolume','orderTimeQuery','orderTimePlatforms'];
const dependencies=Object.assign({},...libs.map(name=>loadTs(path.join(root,`src/lib/${name}.ts`))));
const controlsText=fs.readFileSync(path.join(root,'src/components/OrderTimeControls.tsx'),'utf8');
const controls=ts.createSourceFile('OrderTimeControls.tsx',controlsText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const extra=controls.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='TimeQueryExtra');
const selected=source.statements.filter(n=>ts.isVariableStatement(n)||(ts.isFunctionDeclaration(n)&&n!==main));
function createApi(overrides={}){
  const context={...React,...dependencies,exports:{},OrderRecordModal:()=>null,...overrides};
  const names=selected.filter(ts.isFunctionDeclaration).map(n=>n.name.text);
  return new Function('require',...Object.keys(context),compile(selected.map(n=>n.getText(source)).join('\n')+'\n'+extra.getText(controls))+`\nreturn {${names.join(',')},TimeQueryExtra};`)(specifier=>{
    assert.equal(specifier,'react/jsx-runtime');return require(specifier);
  },...Object.values(context));
}
const api=createApi();
const platform='00000000-0000-0000-0000-000000000001';
function sample(provider,direction,count,success,amount,successAmount,channel_type='UPI'){
  return {provider,direction,channel_type,created_date:'2026-09-17',success_date:'2026-09-18',
    submitted_count:count,submitted_amount:amount,success_count:success,success_amount:successAmount,
    pending_count:count-success,pending_amount:amount-successAmount,actual_amount:direction==='withdraw'?successAmount-8:0,
    withdraw_fee:direction==='withdraw'?8:0,cross_day_count:success,cross_day_amount:successAmount,earlier_count:success,earlier_amount:successAmount,missing_success_time_count:0,
    first_created_at:'2026-09-17T10:00:00+05:30',last_created_at:'2026-09-17T18:00:00+05:30',
    first_success_at:'2026-09-18T10:00:00+05:30',last_success_at:'2026-09-18T18:00:00+05:30',last_synced_at:'2026-09-19T00:10:00+05:30'};
}
function fixture(selection={}){
  return {selection:{country:'香港',platforms:['EK7'],channel:'',types:[],direction:'',start:'2026-09-17T00:00:00',end:'2026-09-17T23:59:59',basis:'created',createdStart:'',createdEnd:'',memberId:'',orderNumber:'',status:'all',crossDayOnly:false,...selection},
    payloads:[{id:platform,payload:{platform:'EK7',team:'香港',platforms:[{id:platform,name:'EK7',team:'香港'}],timezone:'Asia/Kolkata',
      rows:[sample('PayA','charge',10,2,1000,900),sample('PayA','withdraw',8,6,800,120,'BANK'),sample('PayB','charge',4,1,400,50)]}}]};
}
function render(result){return renderToStaticMarkup(React.createElement(api.TimeRangeVolumeResult,{result,rateRows:[],feeRateMap:new Map()}));}
const plain=html=>html.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
function table(html){const match=html.match(/<table>([\s\S]*?)<\/table>/);assert.ok(match);return match[1];}
function rows(html){return [...table(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>m[1]);}
function cells(html,kind='td'){return [...html.matchAll(new RegExp(`<${kind}\\b[^>]*>([\\s\\S]*?)<\\/${kind}>`,'g'))].map(m=>m[1]);}
function headings(html){return cells(rows(html)[0],'th').map(x=>plain(x).replace(/[↕↑↓]/g,''));}
function assertAligned(html){
  const all=rows(html),size=cells(all[0],'th').length;
  for(const row of all.slice(1)){
    const count=[...row.matchAll(/<td\b([^>]*)>/g)].reduce((n,m)=>n+Number(m[1].match(/colSpan="(\d+)"/i)?.[1]||1),0);
    assert.equal(count,size,`every data/summary/expanded row aligns with ${size} headers`);
  }
}
test('actual mother table includes both rates calculated by order counts, not money',()=>{
  const result=fixture(),html=render(result),labels=headings(html),dataRows=rows(html).slice(1);
  assert.ok(labels.includes('代收成功率'));assert.ok(labels.includes('代付成功率'));
  const payA=dataRows.find(row=>plain(cells(row)[0]||'')==='PayA');assert.ok(payA);
  const columns=cells(payA);
  assert.match(plain(columns[labels.indexOf('代收成功率')]),/20\.00%.*2 \/ 10 笔/);
  assert.match(plain(columns[labels.indexOf('代付成功率')]),/75\.00%.*6 \/ 8 笔/);
  assert.equal(plain(columns[labels.indexOf('代收金额')]),'900');
  assert.equal(plain(columns[labels.indexOf('代付金额')]),'120');
  assert.equal(plain(columns[labels.indexOf('实际到账金额')]),'112');
  assert.equal(plain(columns[labels.indexOf('提现手续费')]),'8');
  const total=dataRows.find(row=>plain(row).startsWith('全部汇总'));
  assert.match(plain(cells(total)[labels.indexOf('代收成功率')]),/21\.43%.*3 \/ 14 笔/,'aggregate rate is weighted by counts, not average of provider rates');
  assertAligned(html);
});

test('AR missing money renders dashes in table, footer and cards without losing order counts or success rates',()=>{
  const result=fixture();
  result.payloads[0].payload.rows=result.payloads[0].payload.rows.map(r=>({...r,currency:'INR',submitted_amount:null,
    success_amount:null,actual_amount:null,withdraw_fee:null,pending_amount:null,missing_amount_count:r.submitted_count}));
  const html=render(result),labels=headings(html);
  for(const line of rows(html).slice(1)){
    const c=cells(line),name=plain(c[0]);
    for(const label of ['代收金额','代收占比','合计金额','总占比'])assert.equal(plain(c[labels.indexOf(label)]),'—',`${name} ${label}`);
    if(name!=='PayB')for(const label of ['代付金额','代付占比','实际到账金额','提现手续费','代付中金额'])
      assert.equal(plain(c[labels.indexOf(label)]),'—',`${name} ${label}`);
  }
  const a=cells(rows(html).find(line=>plain(cells(line)[0]||'')==='PayA'));
  assert.equal(plain(a[labels.indexOf('代付笔数')]),'6');
  assert.equal(plain(a[labels.indexOf('代付中笔数')]),'2');
  assert.match(plain(a[labels.indexOf('代付成功率')]),/75\.00%/);
  for(const label of ['代收金额','代付金额','代收手续费','代付手续费','合计手续费','业务净额']){
    assert.match(html,new RegExp(`data-label="${label}"[^>]*>[\\s\\S]*?<strong>—<\\/strong>`));
  }
  assert.doesNotMatch(html,/NaN|Infinity|width:NaN/);
  assertAligned(html);
});

test('AR missing-money rows never generate zero fees or aggregate rate/share even with matching fee rules',()=>{
  const result=fixture();
  result.payloads[0].payload.rows=[{...sample('PayA','withdraw',8,6,800,120),currency:'INR',success_amount:null,pending_amount:null,actual_amount:null,withdraw_fee:null}];
  const data=dependencies.timeVolumeData(result),combo=api.aggregateCombo(data.rows,r=>[r.date,r.country,r.platform,r.channel,r.channelType]);
  const rates=[{country:'香港',category:'UPI',thirdParty:'PayA',collectFee:'2%',payoutFee:'1%',totalFee:'3%',collectSingleFee:'2',payoutSingleFee:'3',collectLimit:'',payoutLimit:''}];
  const fees=api.buildFeeCompareRows(combo,rates,[],'daily');
  assert.equal(fees.length,1);
  assert.ok(Number.isNaN(fees[0].payoutFeeAmount));
  const summary=api.summarizeFeeRows(fees);
  assert.equal(api.feeRateText(summary,'payout'),'—');
  assert.equal(api.feeAmountText(summary,'payout'),'—');
  assert.equal(api.feeTotalText(summary),'—');
  const html=renderToStaticMarkup(React.createElement(api.TimeRangeVolumeResult,{result,rateRows:rates,feeRateMap:api.buildRateMap(rates)}));
  const labels=headings(html);
  for(const line of rows(html).slice(1)){
    const c=cells(line);
    for(const label of ['代付手续费','合计手续费','手续费占比','总占比'])
      assert.ok(['—','-'].includes(plain(c[labels.indexOf(label)])),`${label} is not zero or 100 percent`);
  }
  assert.doesNotMatch(html,/NaN|Infinity/);
});

test('cross-currency totals and shares are hidden without hiding a valid provider amount',()=>{
  const result=fixture();
  result.payloads[0].payload.rows=[{...sample('PayA','charge',3,2,150,100),currency:'INR'},
    {...sample('PayB','charge',3,2,250,200),currency:'PKR'}];
  const html=render(result),labels=headings(html);
  for(const line of rows(html).slice(1)){
    const c=cells(line),name=plain(c[0]);
    assert.equal(plain(c[labels.indexOf('代收占比')]),'—');
    assert.equal(plain(c[labels.indexOf('总占比')]),'—');
    if(name.includes('汇总'))assert.equal(plain(c[labels.indexOf('代收金额')]),'—');
    else assert.equal(plain(c[labels.indexOf('代收金额')]),name==='PayA'?'100':'200');
  }
});
test('success-time and filtered subsets never show a false 100% order success rate',()=>{
  for(const selection of [{basis:'success',start:'2026-09-18T00:00:00',end:'2026-09-18T23:59:59'},{status:'success'},{crossDayOnly:true}]){
    const html=render(fixture(selection)),labels=headings(html);
    for(const row of rows(html).slice(1))for(const label of ['代收成功率','代付成功率']){
      const value=plain(cells(row)[labels.indexOf(label)]||'');
      assert.match(value,/—不适用/);assert.doesNotMatch(value,/%/);
    }
    assertAligned(html);assert.match(html,/不含完整|不计算/);
  }
});
test('existing daily result retains table structure and explicitly lacks payout denominator',()=>{
  const data=dependencies.timeVolumeData(fixture());
  const html=renderToStaticMarkup(React.createElement(api.CountryVolumeSinglePage,{country:'香港',rows:data.rows,summary:api.sumRows(data.rows),previousSummary:api.sumRows([]),
    monthlyRows:api.aggregateCombo(data.rows,row=>[row.country,row.channel]),feeRows:[],previousFeeRows:[],canCompare:false,dateRangeLabel:'2026-09-17'}));
  const labels=headings(html);assert.ok(labels.includes('代付成功率'));
  for(const row of rows(html).slice(1))assert.match(plain(cells(row)[labels.indexOf('代付成功率')]),/—待明细接入/);
  assertAligned(html);
});
function findElements(element,type){
  if(Array.isArray(element))return element.flatMap(item=>findElements(item,type));
  if(!React.isValidElement(element))return [];
  return [...(element.type===type?[element]:[]),...findElements(element.props.children,type)];
}
test('provider detail entry routes to order-level drilldown and child columns remain aligned',()=>{
  const data=dependencies.timeVolumeData(fixture());let clicked;
  const hooks={useMemo:fn=>fn(),useEffect:()=>{},useState:initial=>[initial&&typeof initial==='object'&&!Array.isArray(initial)?{'香港|||PayA':true}:initial,()=>{}]};
  const probe=createApi(hooks),grouped=probe.aggregateCombo(data.rows,row=>[row.country,row.channel]);
  const element=probe.MonthlyTable({title:'香港 汇总',subtitle:'fixture',rows:grouped,columns:['统一三方'],columnIndexes:[1],feeRows:[],collectionSuccess:data.collectionSuccess,
    withdrawSuccess:data.withdrawSuccess,withdrawActual:data.withdrawActual,withdrawPending:data.withdrawPending,orderRateHint:data.successRateHint,onView:row=>{clicked=row;}});
  const buttons=findElements(element,'button'),view=buttons.find(button=>button.props.children==='查看');
  assert.ok(view,'real table has detail entry');view.props.onClick();assert.equal(clicked.labelParts[1],'PayA');
  const html=renderToStaticMarkup(element);assertAligned(html);assert.match(html,/volume-child-row/);
});
let filterNode;
function visit(node){if(ts.isJsxElement(node)&&node.openingElement.attributes.getText(source).includes('filter-card volume-search-card'))filterNode=node;ts.forEachChild(node,visit);}
visit(main);assert.ok(filterNode,'the existing dashboard filter card must be tested, not a separate page');
function filterElement(mode='created',overrides={}){
  const noop=()=>{};
  const timeQuery={mode,startClock:'00:00:00',endClock:'23:59:59',memberId:'',orderNumber:'',status:'all',crossDayOnly:false,createdStart:'',createdEnd:'',active:true};
  const context={...api,...dependencies,exports:{},filterOptions:{ready:true,loading:false,error:''},timeQuery,timePlatformOptions:['EK7','GEM7','MAX7'],startDate:'2026-09-17',endDate:'2026-09-17',activeCountryPage:'香港',
    countryFilterOptions:[],countrySelections:[],platforms:['EK7'],platformSelections:['EK7'],platformSelectionCountry:'香港',channel:'',channels:['PayA','PayB'],
    channelTypeOptions:['UPI','BANK'],channelTypeSelections:[],direction:'',isQuerying:false,hasPendingQuery:false,applyDateShortcut:noop,runQuery:noop,
    setChannelTypeSelections:noop,...overrides};
  return new Function('require',...Object.keys(context),compile(`const element=${filterNode.getText(source)};`)+ '\nreturn element;')(require,...Object.values(context));
}
test('summary search keeps time precision and all/multiple platform selection without order lookup filters',()=>{
  const html=renderToStaticMarkup(filterElement());
  assert.equal((html.match(/type="datetime-local"/g)||[]).length,2);
  assert.match(html,/value="2026-09-17T00:00:00"/);assert.match(html,/value="2026-09-17T23:59:59"/);
  for(const label of ['时间口径','平台','统一三方','类型 / 钱包','业务方向'])assert.ok(plain(html).includes(label),label);
  assert.doesNotMatch(html,/会员 ID|订单号|订单状态|只看跨日|平台（必选一个）/);
  const platformSelect=findElements(filterElement(),api.VolumeMultiSelect).find(element=>element.props.label==='平台');
  assert.ok(platformSelect);assert.deepEqual(platformSelect.props.value,['EK7']);assert.equal(platformSelect.props.placeholder,'全部平台');
  assert.equal(findElements(filterElement(),'select').some(element=>element.props.required),false);
  const success=renderToStaticMarkup(filterElement('success'));
  assert.match(success,/更多筛选：限制创建时间/);assert.doesNotMatch(success,/会员 ID|订单号|订单状态|只看跨日/);
  const daily=renderToStaticMarkup(filterElement('daily'));assert.doesNotMatch(daily,/会员 ID|日期区间 · 日汇总|type="date"/);
  assert.equal((daily.match(/type="datetime-local"/g)||[]).length,2);
});

test('summary has one bottom pager and removes redundant daily and order-time headings',()=>{
  const data=dependencies.timeVolumeData(fixture());
  const html=renderToStaticMarkup(React.createElement(api.CountryVolumeSinglePage,{country:'香港',rows:data.rows,summary:api.sumRows(data.rows),previousSummary:api.sumRows([]),
    monthlyRows:api.aggregateCombo(data.rows,row=>[row.country,row.channel]),feeRows:[],previousFeeRows:[],canCompare:false,dateRangeLabel:'2026-09-01 至 2026-09-17'}));
  assert.equal((html.match(/class="table-pager-row"/g)||[]).length,1);
  assert.ok(html.indexOf('class="table-pager-row"')>html.lastIndexOf('</table>'),'paging follows the summary table and both totals');
  assert.doesNotMatch(html,/volume-applied-range|香港盘口 · 2026-09-01 至 2026-09-17/);
  assert.doesNotMatch(html,/<h2>|class="panel-head"/,'no redundant country summary title above the table');
  const timeHtml=render(fixture());
  assert.equal((timeHtml.match(/class="table-pager-row"/g)||[]).length,1);
  assert.ok(timeHtml.indexOf('class="table-pager-row"')>timeHtml.lastIndexOf('</table>'));
  assert.doesNotMatch(timeHtml,/order-result-context|order-result-tags|volume-applied-range|最近同步：|补采完成前/,'the redundant explanation panel and repeated time heading are removed');
  const actualMainJsx=main.body.statements.find(ts.isReturnStatement).expression.getText(source);
  assert.doesNotMatch(actualMainJsx,/数据说明|此页仅展示汇总|打开订单明细/);
  assert.match(actualMainJsx,/role="alert"/,'query failures remain visible after decorative copy is removed');
});

test('default partial-platform coverage stays visible inside the existing platform card',()=>{
  const html=render(fixture({platforms:[],availablePlatforms:['EK7','91CLUB','91CLUB']}));
  assert.match(plain(html),/可查 1 \/ 全部 2 平台/,'available-only results must not look like complete all-platform totals');
  assert.doesNotMatch(html,/order-result-context|order-result-tags/,'coverage must not recreate the removed explanation panel');
  assert.doesNotMatch(plain(render(fixture({platforms:['EK7'],availablePlatforms:['EK7','91CLUB']}))),/可查 .*全部/,'an explicit single-platform result does not inherit other platform warnings');
  assert.doesNotMatch(plain(render(fixture({platforms:[],availablePlatforms:['EK7']}))),/可查 .*全部/,'a fully covered catalog does not show a partial-coverage warning');
});

test('summary hides explanatory copy but preserves progress, failures and optional success-time bounds',()=>{
  const noop=()=>{};
  const query={mode:'success',busy:true,progress:{completed:1,total:3},cancel:noop,optionsLoading:true,optionsError:'平台读取失败',reloadOptions:noop,
    createdStart:'',createdEnd:'',setCreatedStart:noop,setCreatedEnd:noop};
  const hidden=renderToStaticMarkup(React.createElement(api.TimeQueryExtra,{query,hideExplanation:true}));
  assert.doesNotMatch(hidden,/order-query-help|印度后台时间|统计时段内成功的订单/);
  assert.match(hidden,/正在分段读取：1 \/ 3/);assert.match(hidden,/取消查询/);
  assert.match(hidden,/正在读取可查询的平台/);assert.match(hidden,/role="alert"/);assert.match(hidden,/平台读取失败/);
  assert.match(hidden,/更多筛选：限制创建时间/);assert.equal((hidden.match(/type="datetime-local"/g)||[]).length,2);
  const defaults=renderToStaticMarkup(React.createElement(api.TimeQueryExtra,{query}));
  assert.match(defaults,/order-query-help|印度后台时间/,'existing non-summary callers retain help by default');
  const summaryExtra=findElements(filterElement('success'),api.TimeQueryExtra);
  assert.equal(summaryExtra.length,1);assert.equal(summaryExtra[0].props.hideExplanation,true);
});

test('summary filters submit only on explicit search while provider selection resets dependent types',()=>{
  let queryCount=0,provider='',types=['BANK'],prevented=false;
  const element=filterElement('daily',{runQuery:()=>{queryCount++;},setChannel:value=>provider=value,setChannelTypeSelections:value=>types=value});
  assert.equal(element.type,'form');assert.equal(element.props['aria-label'],'三方量搜索');
  const submit=findElements(element,'button').filter(button=>button.props.type==='submit');
  assert.equal(submit.length,1);assert.equal(submit[0].props.children,'查询');
  const single=findElements(element,api.VolumeSingleSelect)[0];assert.ok(single);
  assert.deepEqual(single.props.options,['PayA','PayB']);
  single.props.onChange('PayB');
  assert.equal(provider,'PayB');assert.deepEqual(types,[]);assert.equal(queryCount,0);
  element.props.onSubmit({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(queryCount,1);
  for(const button of findElements(element,'button').filter(button=>button!==submit[0]))
    assert.equal(button.props.type,'button','date shortcuts must not also submit the form');
  const html=renderToStaticMarkup(element);
  assert.doesNotMatch(html,/日期区间 · 日汇总|type="date"/);assert.equal((html.match(/type="datetime-local"/g)||[]).length,2);
  assert.ok(plain(html).includes('开始时间'));assert.ok(plain(html).includes('结束时间'));
});

test('provider search is single-choice, filters case-insensitively, and Enter never submits the enclosing form',()=>{
  const state=[false,''];let stateIndex=0,selected='PayB',focused=0;
  const probe=createApi({useState:initial=>{const index=stateIndex++;return[state[index]??initial,value=>state[index]=typeof value==='function'?value(state[index]):value];},
    useEffect:()=>{},useRef:()=>({current:{focus(){focused++;}}})});
  const draw=()=>{stateIndex=0;return probe.VolumeSingleSelect({label:'统一三方',options:['PayA','PayB'],value:selected,onChange:value=>selected=value,placeholder:'全部三方'});};
  let element=draw();assert.equal(findElements(element,'input').length,0);
  findElements(element,'button')[0].props.onClick();element=draw();
  const input=findElements(element,'input')[0];assert.equal(input.props['aria-label'],'搜索统一三方');
  input.props.onChange({target:{value:' paYA '}});element=draw();
  const choices=findElements(element,'button').filter(button=>button.props.className.includes('volume-single-option'));
  assert.deepEqual(choices.map(button=>button.props.children),['全部三方','PayA']);
  for(const choice of choices)assert.equal(choice.props.type,'button');
  let prevented=false;
  findElements(element,'input')[0].props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(selected,'PayA');assert.equal(state[0],false);assert.equal(state[1],'');assert.ok(focused);
  element=draw();findElements(element,'button')[0].props.onClick();element=draw();
  prevented=false;findElements(element,'input')[0].props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(selected,'PayA','ambiguous search does not choose an arbitrary provider');
  findElements(element,'button').find(button=>button.props.children==='全部三方').props.onClick();
  assert.equal(selected,'');
});

test('multi-select option search also suppresses implicit query submission',()=>{
  const probe=createApi({useState:initial=>[typeof initial==='boolean'?true:initial,()=>{}],useMemo:fn=>fn(),useEffect:()=>{},useRef:()=>({current:null})});
  const element=probe.VolumeMultiSelect({label:'平台',options:['EK7','GEM7'],value:[],onChange:()=>{throw Error('typing is not selection');},placeholder:'全部平台'});
  const input=findElements(element,'input').find(input=>input.props['aria-label']==='搜索平台');assert.ok(input);
  let prevented=false;input.props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  for(const button of findElements(element,'button'))assert.equal(button.props.type,'button');
});

test('daily provider choices include scoped work-order-only providers without leaking other dates or platforms',()=>{
  const declarations=main.body.statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations);
  const statements=['workOrderChannelOptions','channels'].map(name=>{const declaration=declarations.find(node=>node.name.getText(source)===name);assert.ok(declaration,name);return `const ${declaration.getText(source)};`;}).join('\n');
  const workorder=(provider,overrides={})=>({source_system:'AR_WORKORDER',country:'印度',country_code:'IN',platform:'91CLUB',stat_date:'2026-09-17',third_party:provider,
    channel_type:'UPI',submitted_amount:100,submitted_count:1,success_amount:0,success_count:0,...overrides});
  const sourceRows=[workorder('3TPay-QR'),workorder('Intnet'),workorder('未标记三方'),workorder('WrongDay',{stat_date:'2026-09-16'}),
    workorder('WrongPlatform',{platform:'RAJA'}),workorder('WrongCountry',{country:'印尼',country_code:'ID'}),workorder('3cPay-QR',{country:''})];
  for(const [hasLegacyPlatformSelection,optionCountryFilter] of [[true,'印度'],[false,'印度'],[true,'所有国家USDT']]){
    const context={...api,...dependencies,useMemo:fn=>fn(),hasLegacyPlatformSelection,payload:{workOrderDepositRows:sourceRows},countrySelections:['印度'],
      channelOptionRows:[{channel:'3TPay'}],timeOptionsRows:[],startDate:'2026-09-17',endDate:'2026-09-17',optionCountryFilter,platformSelections:['91CLUB']};
    const output=new Function(...Object.keys(context),compile(statements)+'\nreturn {workOrderChannelOptions,channels};')(...Object.values(context));
    const includeWorkorders=hasLegacyPlatformSelection&&optionCountryFilter!=='所有国家USDT';
    assert.deepEqual(output.channels.sort(),(includeWorkorders?['3TPay','3cPay','Intnet']:['3TPay']).sort());
    if(!includeWorkorders)assert.deepEqual(output.workOrderChannelOptions,[],'unclassified work-order rails cannot leak into time or USDT-only choices');
    assert.equal(new Set(output.channels).size,output.channels.length,'canonical provider choices are unique');
  }
});

test('actual summary query accepts all/multiple/single platforms and rejects ambiguous platform names',async()=>{
  const hook=controls.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useOrderTimeQuery');
  const run=hook.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='run');
  for(const [names,duplicate] of [[[],false],[['EK7','GEM7'],false],[['EK7'],false],[['EK7'],true]]){
    let calls=0,error='',stored;
    const noop=()=>{};
    const context={...dependencies,mode:'created',identity:'viewer',currentIdentity:{current:'viewer'},requestSerial:{current:0},flight:{current:null},
      setBusy:noop,setError:value=>error=value,setProgress:noop,optionsLoading:false,optionsError:'',
      platforms:[{id:platform,name:'EK7',team:'香港'},{id:'00000000-0000-0000-0000-000000000002',name:duplicate?'EK7':'GEM7',team:'香港'}],
      createdStart:'',createdEnd:'',session:{},setStored:value=>stored=value,setActive:noop,isOrderQueryDenied:()=>false,
      queryOrderTimeBatches:async filters=>{calls++;assert.equal(filters.length,names.length||2);assert.equal(filters[0].memberId,'');assert.equal(filters[0].status,'all');return [];},orderTimeRpc:()=>{throw Error('unexpected direct request');}};
    const invoke=new Function(...Object.keys(context),compile(run.getText(controls))+'\nreturn run;')(...Object.values(context));
    const ok=await invoke({...fixture().selection,platforms:names});
    const valid=!duplicate;
    assert.equal(ok,valid);assert.equal(calls,valid?1:0);
    if(!valid){assert.match(error,/重名/);assert.equal(stored,undefined);}
    else assert.equal(stored.data.selection.crossDayOnly,false);
  }
});

test('actual time summary clears sensitive previous results on authorization denial, not a network error',async()=>{
  const hook=controls.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useOrderTimeQuery');
  const run=hook.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='run');
  const denial=controls.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='isOrderQueryDenied');
  const denied=new Function('exports',compile(denial.getText(controls))+'\nreturn isOrderQueryDenied;')({});
  for(const failure of [{status:403},{code:'42501'},{status:401},{code:'28000'},new Error('network failed')]){
    let stored='previous',active=true,cleared=false;
    const noop=()=>{};
    const context={...dependencies,mode:'created',identity:'viewer',currentIdentity:{current:'viewer'},requestSerial:{current:0},flight:{current:null},
      setBusy:noop,setError:noop,setProgress:noop,optionsLoading:false,optionsError:'',
      platforms:[{id:platform,name:'EK7',team:'香港'}],setPlatforms:()=>cleared=true,
      createdStart:'',createdEnd:'',session:{},setStored:value=>stored=value,setActive:value=>active=value,isOrderQueryDenied:denied,
      queryOrderTimeBatches:async()=>{throw failure;},orderTimeRpc:noop};
    const invoke=new Function(...Object.keys(context),compile(run.getText(controls))+'\nreturn run;')(...Object.values(context));
    assert.equal(await invoke(fixture().selection),false);
    const shouldClear=denied(failure);
    assert.equal(stored,shouldClear?null:'previous');assert.equal(active,!shouldClear);assert.equal(cleared,shouldClear);
  }
});

if(process.env.ORDER_TIME_UI_PREVIEW==='1'){
  const css=['src/app/globals.css','src/components/OrderTimeDashboard.css','src/components/WithdrawPendingCell.css'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
  const output=path.join(root,'outputs/integrated-order-ui.html');fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>三方量 · 集成页面验收</title><style>${css}\nbody{padding:20px;background:#f2f5fa}main{max-width:1600px;margin:auto;min-width:0}.fixture-label{font-size:12px;color:#62748e}</style><body><main class="third-party-volume-module"><p class="fixture-label">UI验收示例，非生产数据。以下搜索框与汇总表均来自现有三方量页面。</p>${renderToStaticMarkup(filterElement())}${render(fixture())}</main></body></html>`);
  console.log(output);
}
