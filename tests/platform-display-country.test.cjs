const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const {loadTs, root} = require('./load-typescript.cjs');
const load = name => loadTs(path.join(root, `src/lib/${name}.ts`));
const {platformDisplayCountry, isPanghuBrazilPlatform} = load('platformDisplayCountry');
const {configDisplayGroup} = load('pandaConfigDisplayGroup');

// These are synthetic rows, not exported business records. The ordinary POP
// fixtures deliberately carry the old wrong country to exercise correction.
const cases = [
  ['巴西', '776F', '胖虎巴西'], ['胖虎巴西', 'POPNOV', '巴西'],
  ['胖虎巴西', 'POPFEZ', '巴西'], ['胖虎巴西', 'POPCRA', '巴西'],
  ['巴西', 'SSS55', '巴西'], ['越南', '776F', '越南'],
  ['菲律宾', 'POPNOV', '菲律宾'], ['巴西', '776F2', '巴西'],
];
function byPlatformAndSource(rows, platform, index) {
  const row = rows.find(r => r.platform === platform && (r.sourceRow === index || r.sourceRow === undefined));
  assert.ok(row, `missing synthetic ${platform} source ${index}`); return row;
}
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
function componentFunctions(filename, names) {
  const source=ts.createSourceFile(filename,fs.readFileSync(path.join(root,'src/components',filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const selected=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));
  assert.equal(selected.length,names.length);
  const dependencies={exports:{},...load('platformDisplayCountry'),...load('thirdPartyPlatform'),...load('thirdPartyNameMap')};
  const compiled=ts.transpileModule(selected.map(n=>n.getText(source)).join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  return Function(...Object.keys(dependencies),compiled+`\nreturn {${names.join(',')}}`)(...Object.values(dependencies));
}
function componentRows(filename, functionName, payload) {
  const api=componentFunctions(filename,[functionName]);
  const source=ts.createSourceFile(filename,fs.readFileSync(path.join(root,'src/components',filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const component=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===filename.replace('.tsx',''));
  const node=component.body.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]).find(n=>ts.isIdentifier(n.name)&&n.name.text==='allRows');
  assert.ok(node?.initializer,'actual component must project payload before filtering');
  const compiled=ts.transpileModule(`const result=${node.initializer.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  return Function('payload','useMemo',functionName,compiled+'\nreturn result;')(payload,cb=>cb(),api[functionName]);
}

test('country helper applies the confirmed roster only inside Brazil and is idempotent', () => {
  for (const country of ['BR', 'br', '巴西', '胖虎巴西']) {
    assert.equal(platformDisplayCountry(country, '776f'), '胖虎巴西');
    for (const platform of ['POPNOV', 'POPFEZ', 'POPCRA']) assert.equal(platformDisplayCountry(country, platform), '巴西');
  }
  for (const country of ['VN', 'PH', '越南', '菲律宾', '印度', '', 'BR-extra', '巴西盘口', '胖虎巴西盘口']) {
    for (const platform of ['776F', 'POPNOV', 'VIP345']) assert.equal(platformDisplayCountry(country, platform), country);
  }
  for (const platform of ['776F2', '776-F', 'POPNOV2', 'POPFEZ-extra']) assert.equal(platformDisplayCountry('巴西', platform), '巴西');
  assert.equal(isPanghuBrazilPlatform('776F'), true);
  for (const platform of ['POPNOV', 'POPFEZ', 'POPCRA']) assert.equal(isPanghuBrazilPlatform(platform), false);
  for (const [country, platform, expected] of cases) {
    assert.equal(platformDisplayCountry(country, platform), expected);
    assert.equal(platformDisplayCountry(platformDisplayCountry(country, platform), platform), expected);
  }
});

test('config grouping changes display only, never source identifiers or other systems', () => {
  for (const [platform, key] of [['776F', 'BR_PANGHU'], ['POPNOV', 'BR'], ['POPFEZ', 'BR'], ['POPCRA', 'BR']]) {
    const target = {country_code:'BR', country_name:'巴西', platform, timezone:'America/Sao_Paulo', display_country:'stale synthetic metadata'};
    const before = structuredClone(target);
    assert.equal(configDisplayGroup(target, 'PANDA').key, key);
    assert.deepEqual(target, before);
    assert.deepEqual(configDisplayGroup(target, 'AR'), {key:'BR', name:'巴西'});
    assert.deepEqual(configDisplayGroup({...target, country_code:'PH', country_name:'菲律宾'}, 'PANDA'), {key:'PH', name:'菲律宾'});
  }
});

test('actual config list, counts, selection and search use one corrected country partition', () => {
  const source = ts.createSourceFile('config.tsx', fs.readFileSync(path.join(root,'src/components/AutoWithdrawConfig.tsx'),'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const browser = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ConfigBrowser');
  assert.ok(browser);
  const initializers = new Map();
  for (const statement of browser.body.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) initializers.set(declaration.name.text, declaration.initializer.getText(source));
  }
  // Only registered platform names from the existing safe roster are reused;
  // every configuration, time and source identifier below is synthetic.
  const targets = require('./fixtures/panda-config-targets.json').targets.map(t => ({country_code:t.country_code, platform:t.platform, country_name:t.country_code === 'PH' ? '菲律宾' : '巴西', timezone:'UTC'}));
  const before = structuredClone(targets);
  const evaluate = (name, context) => {
    const code = ts.transpileModule(`(${initializers.get(name)})`, {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText.trim().replace(/;$/, '');
    return Function(...Object.keys(context), `return ${code}`)(...Object.values(context));
  };
  for (const [country, expectedCount] of [['BR',24], ['BR_PANGHU',29], ['PH',1]]) {
    const context = {targets, system:'PANDA', country, keyword:'', platform:'776F', configDisplayGroup, useMemo:f=>f()};
    for (const name of ['countries','chosenCountry','visible','selected','countryTargets']) context[name] = evaluate(name, context);
    assert.equal(context.visible.length, expectedCount); assert.equal(context.countryTargets.length, expectedCount);
    assert.equal(context.visible.filter(t=>t.platform==='776F').length, country==='BR_PANGHU'?1:0);
    for (const platform of ['POPNOV','POPFEZ','POPCRA']) assert.equal(context.visible.filter(t=>t.platform===platform).length, country==='BR'?1:0);
    context.keyword = country==='BR_PANGHU' ? ' 776f ' : country==='BR' ? ' pop ' : 'ph19';
    const searched = evaluate('visible', context);
    assert.ok(searched.length); assert.ok(searched.every(t=>configDisplayGroup(t,'PANDA').key===country));
  }
  assert.deepEqual(targets, before);
});

test('actual raw automatic-withdraw parser relocates rows without changing totals or statuses', () => {
  const values = [['stat_date','country','platform','total_count','success_count','reject_count','auto_count','manual_count','total_handle_seconds','handle_count'],
    ...cases.map(([country,platform],i)=>['2026-09-10',country,platform,String(10+i),'8',String(2+i),'6',String(4+i),'120',String(10+i)])];
  const before = structuredClone(values);
  const rows = load('parseAutoWithdraw').parseRawDailySheet(values,'synthetic-raw-daily');
  assert.equal(rows.length, cases.length);
  cases.forEach(([,platform,country],i) => {
    const row = rows[i]; assert.equal(row.platform, platform); assert.equal(row.country,country);
    assert.deepEqual([row.total,row.success,row.rejected,row.autoCount,row.manualCount],[10+i,8,2+i,6,4+i]);
  });
  assert.deepEqual(values, before);
});

test('actual third-party volume sheet parsing moves the same records without changing money or counts', () => {
  const values = [['日期','国家','平台','系统','类型','三方','金额','筆數'],
    ...cases.map(([country,platform],i)=>['2026-09-10',country,platform,'PANDA',i%2?'代付':'代收','JYPAY',String((i+1)*100.5),String(i+2)])];
  // Use the parser-supported total_count spelling, independent of status fields.
  values[0][7] = 'total_count';
  const before = structuredClone(values);
  const payload = load('parseThirdPartyVolume').buildThirdPartyVolumePayload({synthetic:values});
  assert.equal(payload.rows.length, cases.length);
  cases.forEach(([,platform,country],i)=>{
    const row=byPlatformAndSource(payload.rows,platform,i+2);
    assert.equal(row.country,country); assert.equal(row.amount,(i+1)*100.5); assert.equal(row.count,i+2);
    assert.equal(row.direction,i%2?'代付':'代收');
  });
  assert.equal(payload.summary.amount, 3618); assert.equal(payload.summary.count,44);
  assert.deepEqual(values,before);
});

test('actual cached-volume display projection preserves identity, numerical fields and country isolation', () => {
  const rows = cases.map(([country,platform],i)=>({id:`synthetic-${i}`,date:'2026-09-10',sheetName:'synthetic',sourceRow:i+2,country,platform,channel:'JYPay',rawChannel:'JYPay',channelType:'PIX',direction:'代收',amount:(i+1)*101.25,count:10+i,successCount:8+i,failedCount:2,successRate:(8+i)/(10+i),status:'synthetic'}));
  const payload = {meta:{year:'2026',month:'9',source:'synthetic',updatedAt:'2026-09-11',sheets:['synthetic']},rows,summary:{},anomalies:[],aliasMap:{}};
  const before = structuredClone(payload);
  const api=componentFunctions('ThirdPartyVolumeDashboard.tsx',['localAliasKey','collapseThirdPartyDisplayName','normalizeVolumeRowForDisplay']);
  const normalized=load('parseThirdPartyVolume').normalizeThirdPartyVolumePayload(payload);
  for(const row of normalized.rows) assert.equal(row.country,cases[row.sourceRow-2][2]);
  const output={...normalized,rows:normalized.rows.map(api.normalizeVolumeRowForDisplay)};
  assert.equal(output.rows.length, rows.length);
  for(const [i, original] of rows.entries()) {
    const row=output.rows.find(r=>r.sourceRow===original.sourceRow); assert.ok(row);
    assert.equal(row.country,cases[i][2]);
    for(const key of ['date','platform','amount','count','successCount','failedCount','successRate','direction','status']) assert.equal(row[key], original[key]);
  }
  for(const key of ['amount','count','successCount','failedCount']) assert.equal(sum(output.rows,key),sum(rows,key));
  assert.deepEqual(payload,before);
});

test('actual fee-sheet and display projection move statuses without rewriting source fee records', () => {
  const platforms = ['776F','POPNOV','POPFEZ','POPCRA','SSS55'];
  const values = [['三方','类型','代收费率','代付费率',...platforms],['JYPAY','PIX','1.25%','0.75%',...platforms.map(()=> '开启')]];
  const before = structuredClone(values);
  for(const sheet of ['巴西费率','胖虎巴西费率','越南费率']) {
    const payload=load('parseThirdPartyRates').buildThirdPartyRatePayload({[sheet]:values});
    assert.equal(payload.platformStatuses.length, platforms.length);
    const beforeProjection=structuredClone(payload);
    const api=componentFunctions('ThirdPartyRatesDashboard.tsx',['thirdPartyStatusDisplayRows']);
    for(const row of api.thirdPartyStatusDisplayRows(payload.platformStatuses)) {
      const expected=sheet==='越南费率'?'越南':row.platform==='776F'?'胖虎巴西':'巴西';
      assert.equal(row.country,expected);
      assert.deepEqual([row.collectFee,row.payoutFee,row.totalFee,row.status],['1.25%','0.75%','2%','开启']);
    }
    // Unscoped fee rows remain country-level facts, not copied for each platform.
    assert.equal(payload.rates.length,1); assert.equal(payload.rates[0].collectFee,'1.25%');
    assert.deepEqual(payload,beforeProjection);
  }
  assert.deepEqual(values,before);
});

test('actual work-order parser and component allRows preserve source keys and all counts', () => {
  const values=[['2026-09-10 工单统计'],['国家','平台','总工单','已处理','已驳回','待处理','自动处理','人工处理'],...cases.map(([country,platform])=>[country,platform,'10','8','1','1','4','6'])];
  const before=structuredClone(values), payload=load('parseWorkOrders').buildWorkOrderPayload({synthetic:values});
  assert.equal(payload.rows.length,cases.length);
  const beforeProjection=structuredClone(payload),displayRows=componentRows('WorkOrderDashboard.tsx','workOrderDisplayRows',payload);
  cases.forEach(([,platform,country],i)=>{
    const row=byPlatformAndSource(displayRows,platform,i+3); assert.equal(row.country,country);
    const original=byPlatformAndSource(payload.rows,platform,i+3); assert.equal(row.id,original.id);
    assert.deepEqual([row.total,row.success,row.failed,row.pending,row.amount],[10,8,1,1,0]); assert.equal(row.status,'自动 4 · 人工 6');
  });
  assert.equal(payload.summary.total,80); assert.equal(payload.summary.success,64);
  assert.deepEqual(payload,beforeProjection);
  assert.deepEqual(values,before);
});

test('actual customer-service allRows changes display country, not metrics or raw source fields', () => {
  const values=[['日期','国家','平台','客服','接待数'],...cases.map(([country,platform],i)=>['2026-09-10',country,platform,'synthetic-staff',String(i+10)])];
  const before=structuredClone(values),payload=load('parseCustomerService').buildCustomerServicePayload({synthetic:values});
  assert.equal(payload.rows.length,cases.length);
  const beforeProjection=structuredClone(payload),displayRows=componentRows('CustomerServiceDashboard.tsx','customerServiceDisplayRows',payload);
  cases.forEach(([originalCountry,platform,country],i)=>{
    const row=byPlatformAndSource(displayRows,platform,i+2); assert.equal(row.country,country);
    assert.equal(row.metricValue,i+10); assert.equal(row.fields['国家'],originalCountry); assert.equal(row.fields['平台'],platform);
  });
  assert.equal(payload.summary.metricTotal,108); assert.deepEqual(values,before);
  assert.deepEqual(payload,beforeProjection);
});

async function withSyntheticDatabase(tables, run) {
  const previousFetch=global.fetch;
  const variables=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const saved=Object.fromEntries(variables.map(key=>[key,process.env[key]]));
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://country-test.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-public-key';
  const calls=[];
  global.fetch=async (input, init={})=>{
    const url=new URL(String(input)); assert.equal(url.origin,'https://country-test.invalid','no real network permitted');
    const method=init.method||'GET';
    if(url.pathname==='/auth/v1/user') { assert.equal(method,'GET'); return Response.json({id:'synthetic-owner'}); }
    if(url.pathname.endsWith('/dashboard_profiles')) { assert.equal(method,'GET'); return Response.json([{auth_user_id:'synthetic-owner',username:'synthetic',role:'owner',active:true}]); }
    if(url.pathname==='/rest/v1/rpc/dashboard_third_party_volume_fast_v2') {
      assert.equal(method,'POST');
      const body=JSON.parse(init.body); calls.push({url,body});
      const rows=(tables.volume||[]).filter(row=>body.p_country==null||row.country===body.p_country);
      return Response.json({rows,rowCount:rows.length,dataDays:2,countryCount:new Set(rows.map(r=>r.country)).size,platformCount:new Set(rows.map(r=>r.platform)).size,channelCount:1,latestWriteAt:'2026-09-11T01:00:00Z'});
    }
    assert.equal(method,'GET','only the explicitly mocked read RPC may be POST');
    const name=url.pathname.split('/').pop(); assert.ok(Object.hasOwn(tables,name),`unexpected table ${name}`);
    calls.push({url});
    return Response.json(tables[name]);
  };
  try {
    const request=new Request('https://dashboard.invalid/api/synthetic',{headers:{Authorization:'Bearer synthetic-test-token'}});
    await run(request,calls);
  } finally {
    global.fetch=previousFetch;
    for(const key of variables) if(saved[key]===undefined) delete process.env[key]; else process.env[key]=saved[key];
  }
}

function dbVolume(country,platform,index,date='2026-09-10') {
  return {id:`synthetic-volume-${index}`,sheet_name:'synthetic',source_row:index+2,data_date:date,country,platform,channel:'JYPay',raw_channel:'JYPay',channel_type:'PIX',direction:index%2?'代付':'代收',amount:100+index*25.5,count:10+index,success_count:8+index,failed_count:2,success_rate:(8+index)/(10+index),status:'synthetic',raw:{country},updated_at:'2026-09-11T01:00:00Z'};
}

for(const country of ['巴西','胖虎巴西']) test(`Supabase ${country} fetches both source buckets before display filtering without double counting`,async()=>{
  const rows=[dbVolume('巴西','776F',0),dbVolume('胖虎巴西','776F',1,'2026-09-09'),dbVolume('胖虎巴西','POPNOV',2),dbVolume('巴西','POPFEZ',3),dbVolume('巴西','POPCRA',4),dbVolume('越南','776F',5)];
  const before=structuredClone(rows);
  await withSyntheticDatabase({volume:rows},async(request,calls)=>{
    const payload=await load('supabaseDashboardServer').readSupabaseThirdPartyVolume(request,'2026-09-10','2026-09-10',country);
    const scopes=calls.filter(c=>c.body).map(c=>c.body.p_country);
    assert.ok(scopes.includes('巴西')&&scopes.includes('胖虎巴西'),'pre-filter must read both historical Brazil source countries');
    assert.equal(new Set(scopes).size,scopes.length,'each source bucket only queried once');
    const expected=rows.filter(row=>row.country!=='越南'&&(country==='胖虎巴西'?row.platform==='776F':row.platform!=='776F'));
    assert.deepEqual(payload.rows.map(r=>r.id).sort(),expected.map(r=>r.id).sort());
    assert.ok(payload.rows.every(r=>r.country===country));
    assert.equal(payload.summary.amount,sum(expected,'amount')); assert.equal(payload.summary.count,sum(expected,'count'));
    for(const row of payload.rows) {
      const original=rows.find(r=>r.id===row.id);
      assert.equal(row.raw.country,original.country);
      assert.equal(row.successCount,original.success_count); assert.equal(row.failedCount,original.failed_count);
    }
    assert.ok(calls.every(c=>!c.body||c.body.p_start==='2026-09-10'&&c.body.p_end==='2026-09-10'));
  });
  assert.deepEqual(rows,before);
});

test('non-Brazil Supabase volume remains a single-country query and does not relabel a namesake',async()=>{
  const rows=[dbVolume('巴西','776F',0),dbVolume('越南','776F',1)];
  await withSyntheticDatabase({volume:rows},async(request,calls)=>{
    const payload=await load('supabaseDashboardServer').readSupabaseThirdPartyVolume(request,'2026-09-10','2026-09-10','越南');
    assert.deepEqual(calls.filter(c=>c.body).map(c=>c.body.p_country),['越南']);
    assert.equal(payload.rows.length,1); assert.equal(payload.rows[0].country,'越南'); assert.equal(payload.rows[0].amount,125.5);
  });
});

test('Supabase daily, operator and comparison mappings retain counts while joining yesterday across old country labels',async()=>{
  const daily=(id,date,country,platform,total)=>({id,data_date:date,country,platform,total,success:total-2,rejected:2,auto_count:6,manual_count:total-6,avg_seconds:60,source_sheet:'synthetic',updated_at:'2026-09-11T01:00:00Z'});
  const raw=[daily('d0','2026-09-09','巴西','776F',20),daily('d1','2026-09-10','胖虎巴西','776F',30),daily('d2','2026-09-10','胖虎巴西','POPNOV',40),daily('d3','2026-09-10','越南','776F',50)];
  const operators=cases.map(([country,platform],i)=>({id:`o${i}`,data_date:'2026-09-10',country,platform,account:`synthetic-${i}`,processed:10+i,rejected:2,avg_seconds:60,source_sheet:'synthetic',updated_at:'2026-09-11T01:00:00Z'}));
  const before=structuredClone({raw,operators});
  await withSyntheticDatabase({auto_withdraw_daily:raw,withdraw_operator_daily:operators},async(request)=>{
    const payload=await load('supabaseDashboardServer').readSupabaseAutoWithdraw(request,'2026-09-10','2026-09-10');
    assert.equal(payload.dailyRows.length,3); assert.equal(sum(payload.dailyRows,'total'),120); assert.equal(sum(payload.monthlyRows,'total'),120);
    const current=payload.dailyRows.find(r=>r.country==='胖虎巴西'&&r.platform==='776F');
    assert.ok(current); assert.equal(current.previousDay.total,20); assert.equal(current.total,30);
    assert.equal(payload.dailyRows.find(r=>r.platform==='POPNOV').country,'巴西');
    assert.equal(payload.dailyRows.filter(r=>r.country==='越南').length,1);
    assert.equal(payload.operatorRows.length,cases.length);
    for(const [i,expected] of cases.entries()) {
      const row=payload.operatorRows.find(r=>r.account===`synthetic-${i}`); assert.ok(row);
      assert.equal(row.country,expected[2]); assert.equal(row.processed,10+i); assert.equal(row.rejected,2);
    }
  });
  assert.deepEqual({raw,operators},before);
});

test('Supabase platform status mapping preserves source fees and does not duplicate country-wide rate rows',async()=>{
  const fees={collect_fee:'1.25%',payout_fee:'0.75%',total_fee:'2%',collect_single_fee:'0.12',payout_single_fee:'0.34',collect_limit:'10-1000',payout_limit:'20-2000'};
  const statuses=cases.map(([country,platform],i)=>({id:`s${i}`,sheet_name:'synthetic',source_row:i+2,source_column:4,country,platform,third_party:'JYPay',status:'开启',raw_status:'开启',category:'PIX',...fees}));
  const rates=[{id:'r0',sheet_name:'synthetic',country:'巴西',third_party:'JYPay',category:'PIX',...fees}];
  const before=structuredClone({statuses,rates});
  await withSyntheticDatabase({third_party_rates:rates,third_party_platform_status:statuses},async(request)=>{
    const payload=await load('supabaseDashboardServer').readSupabaseThirdPartyRates(request);
    assert.equal(payload.rates.length,1); assert.equal(payload.rates[0].country,'巴西');
    assert.equal(payload.platformStatuses.length,cases.length); assert.equal(payload.summary.totalStatusCells,cases.length);
    for(const [i,expected] of cases.entries()) {
      const row=payload.platformStatuses.find(r=>r.id===`s${i}`); assert.ok(row); assert.equal(row.country,expected[2]);
      assert.deepEqual([row.collectFee,row.payoutFee,row.totalFee,row.collectSingleFee,row.payoutSingleFee],['1.25%','0.75%','2%','0.12','0.34']);
    }
  });
  assert.deepEqual({statuses,rates},before);
});

test('actual Dashboard fresh/archive projection covers all three arrays without modifying stored payload',()=>{
  const rows=cases.map(([country,platform],i)=>({country,platform,total:10+i,success:8,rejected:2+i,autoCount:6,manualCount:4+i,date:'2026-09-10',account:`synthetic-${i}`,processed:10+i,previousDay:{date:'2026-09-09',total:20+i}}));
  const payload={meta:{source:'synthetic'},monthlyRows:rows,dailyRows:structuredClone(rows),operatorRows:structuredClone(rows)};
  const before=structuredClone(payload), {autoWithdrawDisplayPayload}=load('autoWithdrawDisplayPayload');
  const source=ts.createSourceFile('Dashboard.tsx',fs.readFileSync(path.join(root,'src/components/Dashboard.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const component=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='Dashboard');
  const node=component.body.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]).find(n=>ts.isIdentifier(n.name)&&n.name.text==='payload');
  const compiled=ts.transpileModule(`const result=${node.initializer.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const output=Function('sourcePayload','useMemo','autoWithdrawDisplayPayload',compiled+'\nreturn result;')(payload,cb=>cb(),autoWithdrawDisplayPayload);
  for(const key of ['monthlyRows','dailyRows','operatorRows']) {
    assert.equal(output[key].length,rows.length);
    output[key].forEach((row,i)=>{assert.equal(row.country,cases[i][2]);assert.deepEqual({...row,country:rows[i].country},rows[i]);});
  }
  assert.deepEqual(payload,before); assert.equal(autoWithdrawDisplayPayload(null),null);
});

function note(country,platform,date,reason,updated='2026-09-11T01:00:00Z') {
  return {country,platform,data_date:date,reason,updated_at:updated,updated_by:'synthetic-author'};
}
const noteApi=()=>componentFunctions('AutoWithdrawNotes.tsx',['sameDisplayPlatform','autoWithdrawDisplayNotes','findAutoWithdrawDisplayNote','autoWithdrawNoteSaveTarget']);
test('old notes stay visible after regrouping but retain their original database identity',()=>{
  const notes=[note('巴西','776F','2026-09-10','synthetic old note'),note('越南','776F','2026-09-10','synthetic different-country note'),note('胖虎巴西','POPNOV','2026-09-10','synthetic old POP note')];
  const before=structuredClone(notes),api=noteApi();
  for(const [country,platform,sourceCountry] of [['胖虎巴西','776F','巴西'],['巴西','POPNOV','胖虎巴西']]) {
    const target={country,platform,date:'2026-09-10'};
    const found=api.findAutoWithdrawDisplayNote(notes,target); assert.ok(found); assert.equal(found.country,sourceCountry);
    assert.deepEqual(api.autoWithdrawNoteSaveTarget(notes,target),{...target,country:sourceCountry});
    assert.equal(api.autoWithdrawDisplayNotes(notes,country,platform).length,1);
  }
  assert.deepEqual(notes,before);
});
test('canonical empty notes do not resurrect an older alias note and dates/countries stay isolated',()=>{
  const notes=[note('巴西','776F','2026-09-10','synthetic older alias','2026-09-12T00:00:00Z'),note('胖虎巴西','776F','2026-09-10','','2026-09-11T00:00:00Z'),note('巴西','776F','2026-09-09','synthetic previous day'),note('越南','776F','2026-09-10','synthetic VN')];
  const api=noteApi(),before=structuredClone(notes);
  const selected=api.findAutoWithdrawDisplayNote(notes,{country:'胖虎巴西',platform:'776F',date:'2026-09-10'});
  assert.equal(selected.reason,''); assert.equal(selected.country,'胖虎巴西');
  assert.equal(api.autoWithdrawDisplayNotes(notes,'胖虎巴西','776F').length,2);
  assert.equal(api.autoWithdrawDisplayNotes(notes,'越南','776F').length,1);
  assert.equal(api.findAutoWithdrawDisplayNote(notes,{country:'胖虎巴西',platform:'776F',date:'2026-09-08'}),undefined);
  assert.deepEqual(notes,before);
});
test('actual note save handler submits the existing source key once and preserves unrelated alias records',async()=>{
  const original=[note('巴西','776F','2026-09-10','synthetic source'),note('越南','776F','2026-09-10','synthetic other'),note('巴西','776F','2026-09-09','synthetic prior')];
  const before=structuredClone(original), target={country:'胖虎巴西',platform:'776F',date:'2026-09-10'};
  let notes=original, calls=0, closed=0;
  const source=ts.createSourceFile('AutoWithdrawNotes.tsx',fs.readFileSync(path.join(root,'src/components/AutoWithdrawNotes.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const provider=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='AutoWithdrawNotesProvider');
  const save=provider.body.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='save');
  const dependencies={...noteApi(),notes,target,session:{access_token:'synthetic-not-used'},canWrite:true,saving:false,draft:'  synthetic updated  ',availableDates:()=>['2026-09-10'],requestVersion:{current:0},
    setNotes:update=>{notes=update(notes);},closeEditor:()=>{closed++;},
    saveAutoWithdrawNote:async(_session,input)=>{calls++;assert.deepEqual(input,{country:'巴西',platform:'776F',date:'2026-09-10',reason:'synthetic updated'});return note(input.country,input.platform,input.date,input.reason);},
    setSaving:()=>{},setSaveError:error=>assert.equal(error,''),setLoading:()=>{},setError:()=>{},setSavedMessage:()=>{},setOriginal:()=>{},setDraft:()=>{},setReload:()=>{}};
  const compiled=ts.transpileModule(save.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const run=Function(...Object.keys(dependencies),compiled+'\nreturn save;')(...Object.values(dependencies));
  await run(); assert.equal(calls,1); assert.equal(closed,1); assert.equal(notes.length,3);
  assert.equal(notes.find(n=>n.country==='巴西'&&n.data_date==='2026-09-10').reason,'synthetic updated');
  assert.deepEqual(notes.find(n=>n.country==='越南'),original[1]);
  assert.deepEqual(notes.find(n=>n.data_date==='2026-09-09'),original[2]);
  assert.deepEqual(original,before);
});
