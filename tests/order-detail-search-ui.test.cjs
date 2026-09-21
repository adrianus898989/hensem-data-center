const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const {loadTs,root}=require('./load-typescript.cjs');
const detail=loadTs(path.join(root,'src/lib/orderDetailSearch.ts'));
const id='00000000-0000-0000-0000-000000000001';
const draft=()=>({...detail.initialOrderDetailSearch('2026-09-17'),platform:id});

test('new order search has no implicit platform and rejects all/array/missing selections',()=>{
  const initial=detail.initialOrderDetailSearch('2026-09-17');
  assert.equal(initial.platform,'');assert.equal(initial.start,'2026-09-17T00:00:00');
  assert.equal(initial.end,'2026-09-17T23:59:59');
  for(const platform of ['',null,'all',[id],`${id},${id}`]) {
    assert.throws(()=>detail.orderDetailSearchRequest({...draft(),platform}),/选择一个平台/);
  }
});

test('member/order IDs are exact text, pagination stays 50 and time includes last second',()=>{
  const request=detail.orderDetailSearchRequest({...draft(),memberId:' 000012345678901234567890 ',orderNumber:' TRADE-007 '});
  assert.equal(request.p_member_id,'000012345678901234567890');assert.equal(request.p_order_number,'TRADE-007');
  assert.equal(request.p_limit,50);assert.equal(request.p_cursor,null);
  assert.equal(request.p_start_at,'2026-09-16T18:30:00.000Z');assert.equal(request.p_end_at,'2026-09-17T18:30:00.000Z');
  assert.equal(request.p_amount_min,null);assert.equal(request.p_amount_max,null);
});

test('amount bounds preserve exact decimals without coercion or client-side order filtering',()=>{
  const request=detail.orderDetailSearchRequest({...draft(),amountMin:'000.01000000',amountMax:'123456789012345678.12345678'});
  assert.equal(request.p_amount_min,'0.01');assert.equal(request.p_amount_max,'123456789012345678.12345678');
  assert.equal(detail.orderDetailSearchRequest({...draft(),amountMin:'0',amountMax:'0'}).p_amount_min,'0');
  assert.equal(detail.orderDetailSearchRequest({...draft(),amountMin:'1.010',amountMax:'1.01'}).p_amount_max,'1.01');
  for(const value of ['-1','NaN','Infinity','1e6','1,000','.5','1.123456789']) {
    assert.throws(()=>detail.orderDetailSearchRequest({...draft(),amountMin:value}),/非负金额/);
  }
  for(const [amountMin,amountMax] of [['10','2'],['1.1','1.01'],['9007199254740993.01','9007199254740993']]) {
    assert.throws(()=>detail.orderDetailSearchRequest({...draft(),amountMin,amountMax}),/不能高于/);
  }
});

test('advanced bounds/provider/status/direction are sent to the detail RPC before pagination',()=>{
  const cursor={at:'2026-09-17T12:00:00.000Z',direction:'withdraw',id};
  const request=detail.orderDetailSearchRequest({...draft(),basis:'success',direction:'withdraw',status:'success',crossDayOnly:true,
    createdStart:'2026-09-01T00:00:00',createdEnd:'2026-09-16T23:59:59',provider:' PayA唤醒 '},cursor);
  assert.deepEqual(request.p_providers,['PayA唤醒']);assert.deepEqual(request.p_cursor,cursor);
  assert.equal(request.p_created_start,'2026-08-31T18:30:00.000Z');assert.equal(request.p_created_end,'2026-09-16T18:30:00.000Z');
  assert.equal(request.p_status,'success');assert.equal(request.p_cross_day_only,true);assert.equal(request.p_direction,'withdraw');
  assert.throws(()=>detail.orderDetailSearchRequest({...draft(),start:'2026-08-01T00:00:00'}),/最多31天/);
  assert.throws(()=>detail.orderDetailSearchRequest(draft(),{at:'invalid',id,direction:'all'}),/分页位置无效/);
});

test('page envelope refuses oversized or broken keyset responses',()=>{
  assert.deepEqual(detail.validateOrderDetailPage({rows:[],hasMore:false,nextCursor:'ignored'}),{rows:[],hasMore:false,nextCursor:null});
  assert.throws(()=>detail.validateOrderDetailPage({rows:Array(51).fill({}),hasMore:false}),/返回不完整/);
  assert.throws(()=>detail.validateOrderDetailPage({rows:[],hasMore:true,nextCursor:null}),/返回不完整/);
  assert.throws(()=>detail.validateOrderDetailPage({rows:[],hasMore:0}),/返回不完整/);
});

test('detail money retains sub-unit amounts and zero, never uses rounded totals formatting',()=>{
  assert.equal(detail.formatOrderDetailAmount(12.34),'12.34');
  assert.equal(detail.formatOrderDetailAmount(0.01),'0.01');
  assert.equal(detail.formatOrderDetailAmount(0),'0');
  assert.equal(detail.formatOrderDetailAmount(0.00000001),'0.00000001');
  assert.equal(detail.formatOrderDetailAmount('123456789012345678.12345678'),'123,456,789,012,345,678.12345678');
  assert.equal(detail.formatOrderDetailAmount(null),'—');assert.equal(detail.formatOrderDetailAmount(undefined),'—');
  assert.equal(detail.formatOrderDetailAmount(NaN),'—');
});

test('numeric status labels use normalized status groups without changing source status codes',()=>{
  const row={status:'2',status_code:'2',status_group:'success'},before={...row};
  assert.equal(detail.orderDetailStatusLabel(row.status,row.status_group),'成功');
  assert.deepEqual(row,before);
  for(const [group,label] of [['pending','处理中 / 已提交'],['failed','失败'],['rejected','已拒绝'],['unknown','其他状态']])
    assert.equal(detail.orderDetailStatusLabel('-1',group),label);
  assert.equal(detail.orderDetailStatusLabel('代付成功','success'),'代付成功');
  assert.equal(detail.orderDetailStatusLabel('',null),'其他状态');
});

test('explicit permission failures are distinguishable from transient network failures',()=>{
  for(const error of [{status:401},{status:403},{code:'42501'},{code:'28000'},{code:'28P01'}])assert.equal(detail.orderDetailAccessDenied(error),true);
  for(const error of [null,new Error('Network error'),{status:500},{code:'57014'},{code:'22023'}])assert.equal(detail.orderDetailAccessDenied(error),false);
});

test('SSR renders a platform-required empty search page with accessible labels and no order prefetch',()=>{
  const ts=require('typescript'),React=require('react'),server=require('react-dom/server');
  const filename=path.join(root,'src/components/OrderDetailSearch.tsx');
  const source=fs.readFileSync(filename,'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  let calls=0;
  const module={exports:{}};const nativeRequire=createRequire(filename);
  const requireLocal=specifier=>{
    if(specifier.endsWith('.css'))return {};
    if(specifier==='./DashboardAuthGate')return {useDashboardAuth:()=>({session:null,profile:null})};
    if(specifier==='./OrderTimeControls')return {orderTimeRpc:()=>{calls++;throw new Error('Unexpected order read');}};
    if(specifier==='./useFilterCandidateDirectory')return {useFilterCandidateDirectory:()=>({rows:[],loading:false,error:''})};
    if(specifier.startsWith('@/'))return loadTs(path.join(root,'src',specifier.slice(2)+'.ts'));
    return nativeRequire(specifier);
  };
  new Function('require','module','exports',js)(requireLocal,module,module.exports);
  const html=server.renderToStaticMarkup(React.createElement(module.exports.default));
  assert.equal(calls,0);
  assert.match(html,/先选择平台，再点击/);assert.match(html,/请选择一个平台/);
  assert.match(html,/<select[^>]*required=""[^>]*><option value="" selected="">/);
  assert.match(html,/<label[^>]*><span>会员 ID<\/span><input/);
  assert.match(html,/最低订单金额/);assert.match(html,/最高订单金额/);
  assert.match(html,/今天/);assert.match(html,/昨日/);assert.match(html,/前日/);
  assert.match(html,/未接入订单明细的平台暂不可查/);
  assert.doesNotMatch(source,/queryOrderTimeBatches|formatNumber\(/);
  assert.equal((source.match(/"dashboard_order_time_query"/g)||[]).length,1);
  assert.equal((source.match(/"dashboard_order_detail_search"/g)||[]).length,1);
});

test('standalone detail results display the response timezone, source currency, exact amounts and null as dash',()=>{
  const ts=require('typescript'),React=require('react'),server=require('react-dom/server');
  const filename=path.join(root,'src/components/OrderDetailSearch.tsx');
  const source=fs.readFileSync(filename,'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const savedDraft={...draft(),timezone:'Asia/Kolkata'};
  const page={timezone:'Asia/Karachi',hasMore:false,nextCursor:null,rows:[{id:'record',direction:'withdraw',member_id:'000001',order_number:'ORDER-PK',
    provider:'Pay',status:'2',status_code:'2',status_group:'success',amount:'1.25',actual_amount:null,withdraw_fee:null,currency:'PKR',
    created_at:'2026-09-18T19:00:00Z',success_at:null,synced_at:'2026-09-18T19:00:00Z'}]};
  const states={0:{owner:'viewer:scope',draft:savedDraft},1:{owner:'viewer:scope',rows:[{id,name:'POPZAR',team:'NEWAR',country:'巴基斯坦',timezone:'Asia/Karachi'}]},
    5:{owner:'viewer:scope',applied:{draft:savedDraft,platformName:'POPZAR'},page:0,cursors:[null],data:page}};
  let index=0;const module={exports:{}},nativeRequire=createRequire(filename);
  const requireLocal=specifier=>{
    if(specifier==='react')return {...React,useState:initial=>{const i=index++;return[i in states?states[i]:typeof initial==='function'?initial():initial,()=>{}];},useEffect:()=>{},useMemo:fn=>fn(),useRef:value=>({current:value})};
    if(specifier.endsWith('.css'))return {};
    if(specifier==='./DashboardAuthGate')return {useDashboardAuth:()=>({session:{user:{id:'viewer'}},profile:{}})};
    if(specifier==='./OrderTimeControls')return {orderTimeRpc:()=>{throw new Error('Unexpected external request');}};
    if(specifier==='./useFilterCandidateDirectory')return {useFilterCandidateDirectory:()=>({rows:[],loading:false,error:''})};
    if(specifier==='@/lib/dashboardDataScope')return {dashboardScopeIdentity:()=> 'scope'};
    if(specifier.startsWith('@/'))return loadTs(path.join(root,'src',specifier.slice(2)+'.ts'));
    return nativeRequire(specifier);
  };
  new Function('require','module','exports',js)(requireLocal,module,module.exports);
  const html=server.renderToStaticMarkup(React.createElement(module.exports.default));
  assert.match(html,/2026-09-19 00:00:00/);assert.doesNotMatch(html,/2026-09-19 00:30:00/);
  assert.match(html,/1\.25<small>PKR<\/small>/);assert.match(html,/ods-number">—<\/td>/);
  assert.match(html,/<optgroup label="巴基斯坦"/);
  assert.match(html,/ods-status-success">成功<\/span>/);
});
