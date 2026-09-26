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
const libs=['format','thirdPartyNameMap','thirdPartyPlatform','platformDisplayCountry','collectionSuccess','withdrawPending','withdrawActual','workOrderDeposit','orderTimeVolume','orderTimeQuery','orderTimePlatforms','orderTimeComparison','orderTimePending','orderTimeDaily'];
const dependencies=Object.assign({},...libs.map(name=>loadTs(path.join(root,`src/lib/${name}.ts`))));
const controlsText=fs.readFileSync(path.join(root,'src/components/OrderTimeControls.tsx'),'utf8');
const controls=ts.createSourceFile('OrderTimeControls.tsx',controlsText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const extra=controls.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='TimeQueryExtra');
const selected=source.statements.filter(n=>ts.isVariableStatement(n)||(ts.isFunctionDeclaration(n)&&n!==main));
function createApi(overrides={}){
  const context={...React,...dependencies,exports:{},OrderRecordModal:()=>null,useOrderTimeDaily:()=>({loading:false}),useOrderTimeComparison:()=>({status:'loading'}),useMidnightPending:()=>({snapshots:[],error:'载入中'}),...overrides};
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
test('real mixed AR-null/NEWAR-PKR metadata displays Pakistan money and identifies missing pending snapshots by name',()=>{
  const result=fixture({country:'巴基斯坦',platforms:[],availablePlatforms:['92GAME','LG789','3PATTI-SUPER']});
  Object.assign(result.payloads[0].payload,{platform:'92.GAME',country:'巴基斯坦',team:'巴基斯坦'});
  result.payloads[0].payload.rows.forEach(row=>row.currency=null);
  result.payloads.push({id:'lg',payload:{platform:'LG789',country:'巴基斯坦',rows:[{...sample('PayA','charge',10,5,1000,500),currency:'PKR'}]}});
  const snapshots=[{schema_version:1,source_system:'WITHDRAW_REVIEW',country_code:'PK',platform:'92.GAME',stat_date:'2026-09-17',timezone:'Asia/Karachi',snapshot_id:'midnight',snapshot_at:'2026-09-17T19:00:00Z',coverage:{complete:true,expected_count:0,fetched_count:0,unique_count:0},totals:{pending_count:0,pending_amount:0},groups:[]}];
  const custom=createApi({useMidnightPending:()=>({snapshots})});
  const html=renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result,rateRows:[],feeRateMap:new Map()}));
  assert.match(html,/1,450/);assert.match(html,/1,400/);assert.match(plain(html),/35.00%/);
  assert.doesNotMatch(html,/withdraw-pending-context/);
  assert.doesNotMatch(plain(html),/暂无该日代付中快照：|充值／提现明细单独统计/);
});
test('default all-platform view renders daily-only amounts, names the basis, and does not fabricate a success rate',()=>{
  const result=fixture({country:'巴基斯坦',platforms:[],availablePlatforms:['92GAME','3PATISUPER','3PATTI-SUPER']});
  Object.assign(result.payloads[0].payload,{platform:'92.GAME',country:'巴基斯坦',team:'巴基斯坦'});
  const dailyRows=[{id:'daily',date:'2026-09-17',country:'巴基斯坦',platform:'3PATTI-SUPER',channel:'PayA',rawChannel:'PayA',channelType:'UPI',direction:'代收',amount:673300,count:300},
    {id:'daily-pay',date:'2026-09-17',country:'巴基斯坦',platform:'3PATTI-SUPER',channel:'PayA',rawChannel:'PayA',channelType:'BANK',direction:'代付',amount:505835,count:77}];
  const custom=createApi({useOrderTimeDaily:()=>({loading:false,rows:dailyRows})});
  const html=renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result,rateRows:[],feeRateMap:new Map()}));
  assert.match(plain(html),/3PATTI-SUPER：已纳入日汇总金额和成功笔数/);
  assert.match(html,/674,250/);assert.match(html,/505,955/);
  const provider=cells(rows(html).find(row=>plain(row).startsWith('PayA')));
  const labels=headings(html);
  assert.match(plain(provider[labels.indexOf('代收成功率')]),/20.00%2 \/ 10 笔已采明细部分/);
  assert.match(plain(provider[labels.indexOf('代付成功率')]),/75.00%6 \/ 8 笔已采明细部分/);
  const dialog=renderToStaticMarkup(React.createElement(custom.PlatformCoverageDialog,{result:{...result,dailyRows},onClose(){}}));
  assert.match(plain(dialog),/已展示日汇总（1）3PATTI-SUPER/);
  assert.match(plain(dialog),/尚无可查明细（0）/);
  assertAligned(html);
});
function assertAligned(html){
  const all=rows(html),size=cells(all[0],'th').length;
  for(const row of all.slice(1)){
    const count=[...row.matchAll(/<td\b([^>]*)>/g)].reduce((n,m)=>n+Number(m[1].match(/colSpan="(\d+)"/i)?.[1]||1),0);
    assert.equal(count,size,`every data/summary/expanded row aligns with ${size} headers`);
  }
}
function indiaFixture(selection={}){
  const result=fixture({country:'印度',platforms:[],...selection});
  Object.assign(result.payloads[0].payload,{platform:'DhaniWin',team:'NEWAR',country:'印度'});
  return result;
}
function renderWithWorkOrders(result,stored){
  let index=0;
  const custom=createApi({useState:initial=>React.useState(index++===0?stored:initial)});
  return renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result,rateRows:[],feeRateMap:new Map()}));
}
const issue=(provider='PayA',platform='DHANIWIN(新AR)',country_code='IN')=>({system_name:'AR',source_system:'AR_WORKORDER',stat_date:'2026-09-17',country_code,platform,third_party:provider,channel_type:'BANK',submitted_amount:200,submitted_count:2,success_amount:100,success_count:1,withdraw_not_received_amount:300,withdraw_not_received_count:3,withdraw_success_amount:100,withdraw_success_count:1});
test('only Hong Kong and Red Crab expose actual payout and withdrawal fee columns for daily and hourly ranges',()=>{
  for(const country of ['香港','红膏蟹','印度','巴基斯坦','巴西','印尼','越南','菲律宾','马来','缅甸','尼日利亚','哥伦比亚','墨西哥','智利','胖虎巴西','所有国家USDT']){
    for(const start of ['2026-09-17T00:00:00','2026-09-17T10:00:00']){
      const result=fixture({country,start});
      Object.assign(result.payloads[0].payload,{country,team:country});
      const html=render(result),labels=headings(html),supported=['香港','红膏蟹'].includes(country);
      for(const column of ['实际到账金额','提现手续费'])assert.equal(labels.includes(column),supported,`${country} ${start} ${column}`);
      const provider=cells(rows(html).find(line=>plain(cells(line)[0]||'')==='PayA'));
      assert.equal(plain(provider[labels.indexOf('代付金额')]),'120','requested payout money stays unchanged');
      assert.equal(plain(provider[labels.indexOf('代付笔数')]),'6');
      if(supported){
        assert.equal(plain(provider[labels.indexOf('实际到账金额')]),'112');
        assert.equal(plain(provider[labels.indexOf('提现手续费')]),'8');
      }
      assert.match(html,/data-label="代付手续费"/);assertAligned(html);
    }
  }
});
test('India confirmed provider aliases merge amounts, rates and both workorder groups without changing totals',()=>{
  const result=indiaFixture(),p=result.payloads[0].payload;
  p.rows=['LKgoPayINR-PaytmQR','LKgoPayINR-Bank','LKgoPayI','LKgoPay','LKgoPay-QR'].map((name,i)=>({...sample(name,i%2?'withdraw':'charge',5,4,500,400),currency:'INR'}));
  p.rows.push({...sample('3TPayINR-Bank','withdraw',2,1,200,100),currency:'INR'},
    {...sample('3TPay-QR','charge',2,1,200,100),currency:'INR'});
  const stored={result,rows:[issue('LKgoPay'),issue('LKgoPayINR-PaytmQR'),issue('3TPay')]};
  let index=0;
  const custom=createApi({useState:initial=>React.useState(index++===0?stored:initial)});
  const rates=['LKgoPay','3TPay'].map(thirdParty=>({country:'印度',category:'UPI',thirdParty,collectFee:'2%',payoutFee:'1%',totalFee:'3%',collectSingleFee:'0',payoutSingleFee:'0',collectLimit:'',payoutLimit:''}));
  const html=renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result,rateRows:rates,feeRateMap:api.buildRateMap(rates)}));
  const labels=headings(html),body=rows(html),lk=cells(body.find(line=>plain(cells(line)[0]||'')==='LKgoPay'));
  assert.equal(body.filter(line=>plain(cells(line)[0]||'')==='LKgoPay').length,1);
  assert.equal(body.filter(line=>plain(cells(line)[0]||'')==='3TPay').length,1);
  for(const alias of ['LKgoPayINR-Bank','LKgoPayINR-PaytmQR','LKgoPayI','LKgoPay-QR','3TPayINR-Bank'])assert.ok(!body.some(line=>plain(cells(line)[0]||'')===alias));
  assert.equal(plain(lk[labels.indexOf('代收金额')]),'1,200');
  assert.equal(plain(lk[labels.indexOf('代付金额')]),'800');
  assert.equal(plain(lk[labels.indexOf('存款未到账（日）提交金额')]),'400');
  assert.equal(plain(lk[labels.indexOf('提款未到账（日）提交金额')]),'600');
  const stats=[['代收金额','1,300'],['代付金额','900'],['代收手续费','26'],['代付手续费','9'],['合计手续费','35'],['业务净额','365']];
  for(const [label,value] of stats)assert.match(html,new RegExp(`data-label="${label}"[^>]*>[\\s\\S]*?<strong>${value}<\\/strong>`));
  assertAligned(html);
});
test('full-day and hourly order results retain both daily workorder groups and workorder-only providers',()=>{
  for(const start of ['2026-09-17T00:00:00','2026-09-17T10:00:00']){
    const result=indiaFixture({start}),html=renderWithWorkOrders(result,{result,rows:[issue(),issue('OnlyIssue'),issue('Foreign','OTHER','PK')]});
    const labels=headings(html),line=rows(html).find(line=>plain(cells(line)[0]||'')==='PayA'),c=cells(line);
    assert.equal(plain(c[labels.indexOf('存款未到账（日）提交金额')]),'200');
    assert.equal(plain(c[labels.indexOf('存款未到账（日）提交笔数')]),'2');
    assert.equal(plain(c[labels.indexOf('提款未到账（日）提交金额')]),'300');
    assert.equal(plain(c[labels.indexOf('提款未到账（日）成功笔数')]),'1');
    assert.ok(plain(html).includes('OnlyIssue'));assert.ok(!plain(html).includes('Foreign'));
    assert.match(html,/工单按所选日期整日统计/);assertAligned(html);
    const all=cells(rows(html).find(line=>plain(line).startsWith('全部汇总')));
    assert.equal(plain(all[labels.indexOf('代收金额')]),'950','restoring workorders never adds their money to payment volume');
  }
});
test('unavailable or stale workorders retain columns as dashes and cannot leak previous date/platform data',()=>{
  const result=indiaFixture();
  for(const stored of [null,{result:indiaFixture(),rows:[issue()]},{result,rows:[],error:'工单统计暂未载入，请重新查询。'}]){
    const html=renderWithWorkOrders(result,stored),labels=headings(html),c=cells(rows(html).find(line=>plain(cells(line)[0]||'')==='PayA'));
    assert.equal(plain(c[labels.indexOf('存款未到账（日）提交金额')]),'—');
    assert.equal(plain(c[labels.indexOf('提款未到账（日）提交金额')]),'—');assertAligned(html);
  }
  const single=indiaFixture({platforms:['DhaniWin']});
  const html=renderWithWorkOrders(single,{result:single,rows:[issue(),issue('Excluded','91CLUB')]});
  assert.ok(!plain(html).includes('Excluded'));
});
test('workorder request is date/country scoped, canceled on result change and never publishes a late response',async()=>{
  const effects=[],writes=[],result=indiaFixture({start:'2026-09-17T10:00:00'});let resolve,captured;
  const custom=createApi({useState:initial=>[initial,value=>writes.push(value)],useMemo:fn=>fn(),useEffect:fn=>effects.push(fn),
    dashboardBusinessFetch:(url,options)=>{captured={url,options};return new Promise(r=>resolve=r);}});
  custom.TimeRangeVolumeResult({result,rateRows:[],feeRateMap:new Map()});
  const cleanup=effects[0]();assert.equal(captured.url,'/api/third-party-workorder-metrics?country=%E5%8D%B0%E5%BA%A6&start=2026-09-17&end=2026-09-17');
  cleanup();assert.equal(captured.options.signal.aborted,true);
  resolve(Response.json({basis:'daily',country:'印度',start:'2026-09-17',end:'2026-09-17',rows:[issue()]}));
  await new Promise(r=>setImmediate(r));assert.deepEqual(writes,[]);
});
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
function sortingHarness(props={}){
  const state=[];let cursor=0,element;
  const probe=createApi({useMemo:fn=>fn(),useEffect:()=>{},useState:initial=>{
    const index=cursor++;if(!(index in state))state[index]=initial;
    return [state[index],value=>state[index]=typeof value==='function'?value(state[index]):value];
  }});
  const data=dependencies.timeVolumeData(fixture());
  const base=probe.aggregateCombo(data.rows,row=>[row.country,row.channel])[0];
  const amounts=[['Unknown',NaN],['Small',20],['Large',100],['Zero',0],['Same',20],['Infinite',Infinity]];
  const defaults={title:'',subtitle:'',columns:['统一三方'],columnIndexes:[1],stickyFirstColumn:true,
    rows:amounts.map(([name,amount])=>({...base,key:name,labelParts:['香港',name],collectAmount:amount,totalAmount:amount,rows:[]}))};
  const draw=(extra={})=>{cursor=0;element=probe.MonthlyTable({...defaults,...props,...extra});return renderToStaticMarkup(element);};
  const click=key=>{
    function visit(node){
      if(Array.isArray(node))return node.map(visit).find(Boolean);
      if(!React.isValidElement(node))return null;
      if(node.props.sortKey===key)return node;
      return visit(node.props.children);
    }
    const header=visit(element);assert.ok(header,`sort header ${key}`);
    findElements(header.type(header.props),'button')[0].props.onClick();
  };
  return {draw,click,base,defaults};
}
const sortedNames=html=>[...html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>plain(cells(m[1])[0]));
test('real summary sorting defaults to total descending, toggles correctly, keeps unknowns last and retains a user choice on new results',()=>{
  const h=sortingHarness();let html=h.draw();
  assert.deepEqual(sortedNames(html),['Large','Small','Same','Zero','Unknown','Infinite']);
  assert.match(html,/<th[^>]*aria-sort="descending"[^>]*><button[^>]*><span>合计金额<\/span><span class="sort-arrow" aria-hidden="true">↓/);
  h.click('collectAmount');html=h.draw();
  assert.deepEqual(sortedNames(html),['Large','Small','Same','Zero','Unknown','Infinite']);
  assert.match(html,/<th[^>]*aria-sort="descending"[^>]*><button[^>]*><span>代收金额/);
  h.click('collectAmount');html=h.draw();
  assert.deepEqual(sortedNames(html),['Zero','Small','Same','Large','Unknown','Infinite']);
  assert.match(html,/<th[^>]*aria-sort="ascending"[^>]*><button[^>]*><span>代收金额<\/span><span class="sort-arrow" aria-hidden="true">↑/);
  html=h.draw({rows:[...h.defaults.rows].reverse()});
  assert.deepEqual(sortedNames(html),['Zero','Same','Small','Large','Infinite','Unknown'],'new results retain selected ascending order and stable ties');
  h.click('dimension:1');html=h.draw();
  assert.deepEqual(sortedNames(html),['Infinite','Large','Same','Small','Unknown','Zero']);
  assert.match(html,/sticky-first-dimension/);assertAligned(html);
});
test('display-unavailable payout metrics sort last even when their backing metric contains zero',()=>{
  const metric=name=>name.endsWith('Unknown')?{state:'missing',amount:0,count:0,actualAmount:0,feeAmount:0}
    :{state:'complete',amount:name.endsWith('Small')?20:100,count:1,actualAmount:name.endsWith('Small')?20:100,feeAmount:2};
  const view={compare:keys=>({current:metric(keys[0]||'Large')})};
  const h=sortingHarness({withdrawActual:view,withdrawPending:view});
  const selected=h.defaults.rows.filter(row=>['Unknown','Small','Large'].includes(row.key));
  for(const key of ['withdrawActualAmount','withdrawActualFee','withdrawPendingAmount','withdrawPendingCount']){
    h.draw({rows:selected});h.click(key);h.draw({rows:selected});h.click(key);
    const html=h.draw({rows:selected});assert.equal(sortedNames(html).at(-1),'Unknown',key);
  }
});
test('numeric summary headings all use aligned compact buttons and expose only the current direction',()=>{
  const h=sortingHarness(),html=h.draw();
  const headers=[...html.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)];
  for(const [,attributes,content] of headers){
    if(!content.includes('th-sort-btn'))continue;
    if(!content.includes('统一三方'))assert.match(attributes,/\bnum\b/);
    assert.match(content,/<\/span><span class="sort-arrow" aria-hidden="true">[↕↑↓]<\/span>/);
  }
  assert.equal(headers.filter(([,attributes])=>/aria-sort="descending"/.test(attributes)).length,1);
});
test('confirmed zero-fee share sorts as zero while unconfigured fees remain last in both directions',()=>{
  const feeRows=['Unknown','Zero','Large'].map(channel=>({country:'香港',platform:'EK7',channel,channelType:'UPI',
    collectAmount:100,collectCount:1,payoutAmount:0,payoutCount:0,totalAmount:100,totalCount:1,
    collectFeeRate:channel==='Large'?0.1:0,collectSingleFee:0,collectFeeAmount:channel==='Large'?10:0,
    collectFeeKnownZero:channel==='Zero',payoutFeeRate:0,payoutSingleFee:0,payoutFeeAmount:0,payoutFeeKnownZero:false,
    estimatedFee:channel==='Large'?10:0,level:channel==='Unknown'?'missing':'normal',rows:[]}));
  const summary=api.buildFeeSummaryMap(feeRows,'monthly');
  assert.equal(summary.get('香港|||Zero').collectHasFee,true);
  assert.equal(summary.get('香港|||Zero').totalFeeShare,0);
  assert.equal(summary.get('香港|||Unknown').collectHasFee,false);
  const h=sortingHarness({feeRows});
  const rows=['Unknown','Zero','Large'].map(name=>h.defaults.rows.find(row=>row.key===name));
  h.draw({rows});h.click('feeShare');
  assert.deepEqual(sortedNames(h.draw({rows})),['Large','Zero','Unknown']);
  h.click('feeShare');
  assert.deepEqual(sortedNames(h.draw({rows})),['Zero','Large','Unknown']);
});
test('provider detail entry routes to order-level drilldown and child columns remain aligned',()=>{
  const data=dependencies.timeVolumeData(fixture());let clicked;
  const hooks={useMemo:fn=>fn(),useEffect:()=>{},useState:initial=>[initial&&typeof initial==='object'&&!Array.isArray(initial)&&!initial.key?{'香港|||PayA':true}:initial,()=>{}]};
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

test('platform card is keyboard-clickable and dialog names missing, empty and contributing platforms separately',()=>{
  const result=indiaFixture({availablePlatforms:['DhaniWin','DHANIWIN(新AR)','UNCONNECTED_A','UNCONNECTED_B','91CLUB']});
  result.payloads.push({id:'empty',payload:{platform:'91CLUB',country:'印度',rows:[]}});
  const html=render(result);
  assert.match(html,/<button[^>]*aria-haspopup="dialog"[^>]*data-label="平台"/);
  assert.match(html,/可查 2 \/ 全部 4 平台/);
  const dialog=renderToStaticMarkup(React.createElement(api.PlatformCoverageDialog,{result,onClose(){}}));
  assert.match(plain(dialog),/尚无可查明细（2）UNCONNECTED_AUNCONNECTED_B/);
  assert.match(plain(dialog),/已查询、当前条件无数据（1）91CLUB/);
  assert.match(plain(dialog),/本次有数据（1）DhaniWin/);
  assert.match(dialog,/不代表已确认漏采/);
  const single={...result,selection:{...result.selection,platforms:['DhaniWin']},payloads:[result.payloads[0]]};
  assert.deepEqual(dependencies.timePlatformCoverage(single).unavailable,[]);
});

test('order-time cards restore positive, negative and zero-base comparisons without losing coverage or daily workorders',()=>{
  const result=indiaFixture({availablePlatforms:['DhaniWin','BIG']}),previous=indiaFixture();
  previous.payloads[0].payload.rows=[sample('PayA','charge',10,1,1000,500),sample('PayA','withdraw',8,8,800,240,'BANK')];
  const rates=[{country:'印度',category:'UPI',thirdParty:'PayA',collectFee:'2%',payoutFee:'1%',collectSingleFee:'0',payoutSingleFee:'0'},
    {country:'印度',category:'UPI',thirdParty:'PayB',collectFee:'2%',payoutFee:'1%',collectSingleFee:'0',payoutSingleFee:'0'}];
  const custom=createApi({useOrderTimeComparison:()=>({status:'ready',previous})});
  const html=renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result,rateRows:rates,feeRateMap:api.buildRateMap(rates)}));
  const stat=label=>plain(html.match(new RegExp(`data-label="${label}"[\\s\\S]*?(?:<\\/div>|<\\/button>)`))[0]);
  assert.match(stat('代收金额'),/950较昨日\+450 \+90.00%/);
  assert.match(stat('代付金额'),/120较昨日−?\-?120 \-50.00%/);
  assert.match(stat('平台'),/较昨日0 0.00%.*可查 1 \/ 全部 2 平台/);
  for(const name of ['主三方','代收笔数','代付笔数','代收手续费','代付手续费','合计手续费','业务净额'])assert.match(stat(name),/较昨日/);
  assert.match(html,/存款未到账（日）/);assert.match(html,/提款未到账（日）/);
  const zero=createApi({useOrderTimeComparison:()=>({status:'ready',previous:{...previous,payloads:[]}})});
  const zeroHtml=renderToStaticMarkup(React.createElement(zero.TimeRangeVolumeResult,{result,rateRows:[],feeRateMap:new Map()}));
  const zeroStats=zeroHtml.slice(0,zeroHtml.indexOf('</section>'));
  assert.match(zeroStats,/无基数/);assert.doesNotMatch(zeroStats,/Infinity|NaN|100.00%/);
});

test('full-day cards use historical daily totals without old raw details and preserve current totals/workorders',()=>{
  const result=indiaFixture();
  result.payloads[0].payload.rows=[sample('PayA','charge',700000,431750,300000000,276939770.55),sample('PayA','withdraw',170000,156130,230000000,218627111,'BANK')];
  const previousRows=[{date:'2026-09-16',country:'印度',platform:'DHANIWIN',direction:'代收',channel:'PayA',rawChannel:'PayA',channelType:'UPI',amount:280228755.97,count:430088},
    {date:'2026-09-16',country:'印度',platform:'DHANIWIN',direction:'代付',channel:'PayA',rawChannel:'PayA',channelType:'BANK',amount:243352746,count:149135}];
  let index=0;
  const custom=createApi({useState:initial=>React.useState(index++===0?{result,rows:[issue()]}:initial),useOrderTimeComparison:()=>({status:'ready',basis:'daily',previousRows})});
  const html=plain(renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result,rateRows:[],feeRateMap:new Map()})));
  assert.match(html,/276,939,771较昨日（日汇总）−?\-?3,288,985 \-1.17%/);
  assert.match(html,/218,627,111较昨日（日汇总）−?\-?24,725,635 \-10.16%/);
  assert.match(html,/存款未到账（日）/);assert.match(html,/提款未到账（日）/);
  assert.doesNotMatch(html,/涨跌暂不可比|数据待核实|468.86%/);
});

test('incomplete comparison retains amounts and both workorders, hides false deltas and offers exact gap explanation',()=>{
  const result=indiaFixture(),issues=[{period:'previous',date:'2026-09-18',platform:'91CLUB',direction:'代收',expected:199537,stored:100000,reason:'已入库明细少于完整采集记录。'}];
  let index=0;
  const custom=createApi({useState:initial=>React.useState(index++===0?{result,rows:[issue()]}:initial),useOrderTimeComparison:()=>({status:'unavailable',issues})});
  const html=renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result,rateRows:[],feeRateMap:new Map()}));
  assert.match(html,/涨跌暂不可比 · 查看原因/);assert.match(html,/较昨日 · 数据待核实/);
  assert.doesNotMatch(html,/468\.86|page-stat-delta/);
  assert.match(html,/data-label="代收金额"[\s\S]*?<strong>950<\/strong>/);
  assert.ok(headings(html).includes('存款未到账（日）提交金额'));assert.ok(headings(html).includes('提款未到账（日）提交金额'));
  const dialog=renderToStaticMarkup(React.createElement(custom.ComparisonCoverageDialog,{issues,onClose(){}}));
  assert.match(plain(dialog),/对比期 · 2026-09-18 · 91CLUB 代收/);assert.match(plain(dialog),/199,537 笔；已入库 100,000 笔/);
  assert.match(dialog,/aria-label="涨跌对比核验"/);
});

test('comparison failure or unknown historical fees never become fake zero, percentage or block current totals',()=>{
  const result=fixture(),previous=fixture();
  for(const status of ['loading','error']){
    const custom=createApi({useOrderTimeComparison:()=>({status})});
    const html=renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result,rateRows:[],feeRateMap:new Map()}));
    assert.match(html,/<strong>950<\/strong>/);assert.doesNotMatch(html,/page-stat-compare (up|down|flat)/);
    assert.match(html,status==='loading'?/较昨日 · 对比中…/:/较昨日 · 核验暂未载入/);
  }
  const multi=fixture({start:'2026-09-15T10:00:00'});
  const custom=createApi({useOrderTimeComparison:()=>({status:'ready',previous})});
  const html=renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result:multi,rateRows:[],feeRateMap:new Map()}));
  assert.match(html,/较前期/);assert.doesNotMatch(html,/较昨日/);
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


test('India table shows midnight pending 262 / 812708 while retaining created-day success rates',()=>{
  const result=indiaFixture({platforms:['91CLUB'],start:'2026-09-20T00:00:00',end:'2026-09-20T23:59:59'});
  Object.assign(result.payloads[0].payload,{platform:'91CLUB',team:'AR',rows:[{...sample('Rspay','withdraw',101,29,1000000,114595),created_date:'2026-09-20',pending_count:72,pending_amount:246290}]});
  const snapshot={schema_version:1,source_system:'WITHDRAW_REVIEW',country_code:'IN',platform:'91CLUB',stat_date:'2026-09-20',timezone:'Asia/Kolkata',snapshot_id:'fixture',snapshot_at:'2026-09-20T18:30:28Z',coverage:{complete:true,expected_count:263,fetched_count:263,unique_count:263},totals:{pending_count:263,pending_amount:813708},groups:[{raw_channel:'Rspay',channel_type:'提现',pending_count:262,pending_amount:812708},{raw_channel:'OnlyPending',channel_type:'提现',pending_count:1,pending_amount:1000}]};
  const custom=createApi({useMidnightPending:()=>({snapshots:[snapshot]})});
  const html=renderToStaticMarkup(React.createElement(custom.TimeRangeVolumeResult,{result,rateRows:[],feeRateMap:new Map()}));
  const labels=headings(html),body=rows(html),rspay=cells(body.find(line=>plain(cells(line)[0]||'')==='RsPay'));
  assert.equal(plain(rspay[labels.indexOf('代付中金额')]),'812,708');assert.equal(plain(rspay[labels.indexOf('代付中笔数')]),'262');
  assert.match(plain(rspay[labels.indexOf('代付成功率')]),/29 \/ 101 笔/);
  assert.ok(body.some(line=>plain(cells(line)[0]||'')==='OnlyPending'));
  assert.doesNotMatch(html,/withdraw-pending-context/);assert.doesNotMatch(plain(html),/已采集 1 \/ 1 平台/);assertAligned(html);
  const partial=renderToStaticMarkup(React.createElement(custom.WithdrawPendingCell,{metric:{amount:812708,count:262,state:'partial',captured:1,expected:2},kind:'count'}));
  assert.match(plain(partial),/262部分 · 已采 1\/2/);
});


test('country interval summaries render grouped totals without per-order drilldown',()=>{
  const input=fixture();
  input.payloads[0].payload.rows[0].provider='Win2pay跑分';
  input.payloads[0].payload.rows.push({...input.payloads[0].payload.rows[0],provider:'Win2Pay跑分'});
  const html=render(input);
  assertAligned(html);
  assert.equal((html.match(/>Win2Pay<\/td>/g)||[]).length,1);
  assert.doesNotMatch(html,/>查看<|>详情<|会员 ID|订单号|三方订单号/);
  assert.match(html,/当前页汇总/);
  assert.match(html,/全部汇总/);
});


test('provider dropdown puts real providers first and keeps manual and unresolved filters accessible',()=>{
  const input=['未知三方','普通提现','未识别通道','人工确认','RushPay跑分','AIV3Pay跑分','ATPay','RushPay跑分'];
  const probe=createApi({useState:initial=>[typeof initial==='boolean'?true:initial,()=>{}],useEffect:()=>{},useRef:()=>({current:null})});
  let picked;
  const node=probe.VolumeSingleSelect({label:'统一三方',options:input,value:'',placeholder:'全部三方',onChange:x=>picked=x});
  const buttons=findElements(node,'button').filter(b=>b.props.className==='multi-option volume-single-option');
  assert.deepEqual(buttons.map(b=>b.props.children),['全部三方','AIV3Pay跑分','ATPay','RushPay跑分','人工确认','普通提现','未识别通道','未知三方']);
  buttons.find(b=>b.props.children==='人工确认').props.onClick();assert.equal(picked,'人工确认');
  buttons.find(b=>b.props.children==='未识别通道').props.onClick();assert.equal(picked,'未识别通道');
  assert.equal(input.length,8);
});
