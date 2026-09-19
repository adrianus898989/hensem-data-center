// Exercise the real existing summary form and its compatibility router; no
// credentials, live API calls, order records or database writes are involved.
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {root}=require('./load-typescript.cjs');
const text=fs.readFileSync(path.join(root,'src/components/ThirdPartyVolumeDashboard.tsx'),'utf8');
const source=ts.createSourceFile('summary.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const main=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ThirdPartyVolumeDashboard');
const route=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='summaryQuerySource');
const run=main.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='runQuery');
function compile(code){return ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;}
const summaryQuerySource=new Function(compile(route.getText(source))+'\nreturn summaryQuerySource;')();
const fixture={basis:'created',start:'2026-09-17T00:00:00',end:'2026-09-17T23:59:59',platforms:[],availablePlatforms:['EK7','GEM7','MAX7'],detailPlatforms:['EK7','GEM7','MAX7']};
function elements(value,type){
  if(Array.isArray(value))return value.flatMap(item=>elements(item,type));
  if(!React.isValidElement(value))return [];
  return [...(value.type===type?[value]:[]),...elements(value.props.children,type)];
}
let form;
function visit(node){if(ts.isJsxElement(node)&&node.openingElement.attributes.getText(source).includes('filter-card volume-search-card'))form=node;ts.forEachChild(node,visit);}
visit(main);assert.ok(form);
const Multi=()=>null,Single=()=>null,Extra=()=>null,noop=()=>{};
function summaryForm(mode='created',selected=[],overrides={}){
  const context={exports:{},VolumeMultiSelect:Multi,VolumeSingleSelect:Single,TimeQueryExtra:Extra,
    timeQuery:{mode,startClock:'18:00:00',endClock:'23:59:59',setMode:noop},timePlatformOptions:fixture.detailPlatforms,
    startDate:'2026-09-17',endDate:'2026-09-17',activeCountryPage:'香港',isAllUsdtCountryPage:()=>false,
    platforms:fixture.availablePlatforms,platformSelections:selected,platformSelectionCountry:'香港',canonicalThirdPartyPlatformSelections:(_country,value)=>value,
    channels:[],channel:'',channelTypeOptions:[],channelTypeSelections:[],direction:'',isQuerying:false,hasPendingQuery:false,
    setPlatformSelections:noop,setChannel:noop,setChannelTypeSelections:noop,setDirection:noop,applyDateShortcut:noop,runQuery:noop,...overrides};
  return new Function('require',...Object.keys(context),compile(`const element=${form.getText(source)};`)+'\nreturn element;')(require,...Object.values(context));
}

test('the actual summary form always has only creation/success bases and second-resolution datetime inputs',()=>{
  for(const mode of ['created','success','daily']){
    const element=summaryForm(mode),basis=elements(element,'select').find(item=>item.props['aria-label']==='时间口径');
    assert.deepEqual(elements(basis,'option').map(item=>[item.props.value,item.props.children]),[['created','创建时间'],['success','成功时间']]);
    assert.equal(elements(basis,'option').some(item=>item.props.disabled),false);
    const dates=elements(element,'input');
    assert.equal(dates.length,2);assert.ok(dates.every(input=>input.props.type==='datetime-local'&&input.props.step==='1'));
    assert.deepEqual(dates.map(input=>input.props.value),['2026-09-17T18:00:00','2026-09-17T23:59:59']);
    assert.doesNotMatch(renderToStaticMarkup(element),/日汇总|会员 ID|订单号|平台（必选一个）|type="date"/);
  }
});

test('all/single/multiple summary selections use one multiselect and basis changes preserve the selection',()=>{
  for(const selected of [[],['EK7'],['EK7','GEM7'],fixture.availablePlatforms]){
    let updated,cleared=false,basis;
    const element=summaryForm('created',selected,{setPlatformSelections:value=>updated=value,
      setChannel:()=>cleared=true,timeQuery:{mode:'created',startClock:'00:00:00',endClock:'23:59:59',setMode:value=>basis=value}});
    const platform=elements(element,Multi).find(item=>item.props.label==='平台');
    assert.ok(platform);assert.deepEqual(platform.props.value,selected);assert.deepEqual(platform.props.options,fixture.availablePlatforms);
    assert.equal(platform.props.placeholder,'全部平台');
    elements(element,'select').find(item=>item.props['aria-label']==='时间口径').props.onChange({target:{value:'success'}});
    assert.equal(basis,'success');assert.equal(updated,undefined);assert.equal(cleared,false);
    platform.props.onChange(['EK7','MAX7']);assert.deepEqual(updated,['EK7','MAX7']);
  }
});

test('all detailed platforms route to real order aggregation for full days, partial hours and success time',()=>{
  for(const platforms of [[],['EK7'],['EK7','MAX7']])for(const selection of [{},{start:'2026-09-17T18:00:00'},{basis:'success'}]){
    assert.equal(summaryQuerySource({...fixture,...selection,platforms}),'orders');
  }
});

test('legacy or mixed full-day creation selections keep the entire original daily backend',()=>{
  const mixed={...fixture,availablePlatforms:['EK7','91CLUB'],detailPlatforms:['EK7']};
  assert.equal(summaryQuerySource(mixed),'daily');
  assert.equal(summaryQuerySource({...mixed,platforms:['EK7','91CLUB']}),'daily');
  assert.equal(summaryQuerySource({...mixed,platforms:['91CLUB']}),'daily');
  assert.equal(summaryQuerySource({...mixed,platforms:['EK7']}),'orders');
  assert.equal(summaryQuerySource({...fixture,availablePlatforms:['91CLUB'],detailPlatforms:[]}),'daily');
});

test('legacy platforms cannot silently contaminate partial-hour or success results',()=>{
  const mixed={...fixture,availablePlatforms:['EK7','91CLUB'],detailPlatforms:['EK7']};
  for(const selection of [{basis:'success'},{start:'2026-09-17T18:00:00'},{end:'2026-09-17T23:59:00'}]){
    assert.throws(()=>summaryQuerySource({...mixed,...selection}),/91CLUB.*不能按部分时段或成功时间/);
    assert.throws(()=>summaryQuerySource({...mixed,...selection,platforms:['91CLUB']}),/91CLUB/);
  }
});

test('time validation rejects reversed, invalid and over-31-day ranges before choosing a backend',()=>{
  for(const selection of [{start:'2026-09-18T00:00:00'},{start:'2026-02-30T00:00:00'},{start:'2026-09-17T24:00:00'},{start:'2026-08-01T00:00:00'}]){
    assert.throws(()=>summaryQuerySource({...fixture,...selection}),/有效|31 天/);
  }
  assert.equal(summaryQuerySource({...fixture,start:'2026-09-01T00:00:00',end:'2026-09-30T23:59:59'}),'orders');
});

test('production query dispatch never reads or publishes partial mixed-source results',async()=>{
  for(const selection of [[],['EK7'],['EK7','91CLUB']])for(const basis of ['created','success']){
    const calls={daily:0,orders:0,showDaily:0},errors=[],notices=[];
    const context={queryInFlightRef:{current:false},startDate:'2026-09-17',endDate:'2026-09-17',appliedStartDate:'',appliedEndDate:'',
      timePlatformOptions:['EK7'],platforms:['EK7','91CLUB'],platformSelections:selection,platformSelectionCountry:'香港',
      mainTab:'country',activeCountryPage:'香港',channel:'',channelTypeSelections:[],direction:'',countrySelections:[],
      setIsQuerying:noop,setSummaryQueryError:value=>errors.push(value),summaryQuerySource,
      timeQuery:{mode:basis,startClock:'00:00:00',endClock:'23:59:59',optionsLoading:false,optionsError:'',
        run:async input=>{calls.orders++;assert.deepEqual(input.platforms,selection);return true;},showDaily:()=>calls.showDaily++},
      loadData:async(_silent,start,end,_version,country)=>{calls.daily++;assert.equal(start,'2026-09-17');assert.equal(end,'2026-09-17');assert.equal(country,'香港');return true;},
      setLegacySummaryNotice:value=>notices.push(value),setAppliedStartDate:noop,setAppliedEndDate:noop,setAppliedCountrySelections:noop,
      setAppliedPlatformSelections:noop,canonicalThirdPartyPlatformSelections:(_country,value)=>value,setAppliedChannel:noop,setAppliedDirection:noop,
      setAppliedChannelTypeSelections:noop,setAppliedCountryPage:noop,setLastQueryAt:noop,setHasQueried:noop};
    const execute=new Function(...Object.keys(context),compile(run.getText(source))+'\nreturn runQuery;')(...Object.values(context));
    await execute();
    if(selection.length===1){assert.deepEqual(calls,{daily:0,orders:1,showDaily:0});assert.deepEqual(notices,['']);}
    else if(basis==='created'){assert.deepEqual(calls,{daily:1,orders:0,showDaily:1});assert.match(notices[0],/整组使用原有日汇总口径/);}
    else{assert.deepEqual(calls,{daily:0,orders:0,showDaily:0});assert.match(errors.at(-1),/91CLUB/);assert.deepEqual(notices,[]);}
    assert.equal(context.queryInFlightRef.current,false);
  }
});

test('the separate order detail page retains required single-platform lookup protection',()=>{
  const detail=fs.readFileSync(path.join(root,'src/components/OrderDetailSearch.tsx'),'utf8');
  assert.match(detail,/<select required value=\{draft\.platform\}/);assert.match(detail,/请选择一个平台/);
  assert.match(detail,/会员 ID/);assert.match(detail,/订单号/);
  assert.doesNotMatch(detail,/VolumeMultiSelect/);
});
