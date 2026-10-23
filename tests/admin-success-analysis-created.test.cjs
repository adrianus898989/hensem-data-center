const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-success-analysis-ui.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {api,props,row,payment}=new Function('require','__dirname',prefix+';return {api,props,row,payment};')(require,__dirname);
const created=(platform,rows,summary=rows)=>({...payment(platform,rows,summary),successBasis:'created',capabilities:{successCohort:'created_at_current_stored_status',successMetricBasis:'created',independentSuccessWindow:false,successTimeAvailable:false,chargeSuccessTimeAvailable:false,withdrawSuccessTimeAvailable:false,latencyAvailable:false,successCoverageAvailable:false}});
const target=source=>({id:'synthetic-'+source,name:'Synthetic '+source,source,country:source==='duoli'?'印尼':source==='panda'?'巴西':'印度',currency:source==='duoli'?'IDR':source==='panda'?'BRL':'INR',capabilities:{successTimeAvailable:false,chargeSuccessTimeAvailable:false,withdrawSuccessTimeAvailable:false,successCoverageAvailable:false}});
for(const source of ['AR','NEW_AR','WG','duoli','kb','panda','lg','game66'])test(source+' created cohort uses stored current successes without claiming a success clock',()=>{
 const a=api(),p=target(source),rows=['charge','withdraw'].map(d=>({...row(d,10,5),currency:p.currency,created_success_count:5,success_amount:null,created_success_amount:null,created_success_missing_amount_count:1})),input=props({successFrom:'',successTo:'',queryPlatforms:[p],results:[created(p,rows)],workorders:null}),before=JSON.stringify(input),model=a.buildModel(input);
 for(const key of ['charge','withdraw']){assert.equal(model.rows[0][key][0].value,50);assert.equal(model.footers[key][0].value,50);assert.equal(model.totals[key].value,50);assert.match(model.rows[0][key][0].note,/创建日期订单/);assert.doesNotMatch(model.rows[0][key][0].note,/含跨日|成功时间内/);}
 assert.equal(JSON.stringify(input),before,'all financial and clock capability facts are immutable');assert.equal(input.L.results[0].capabilities.latencyAvailable,false);assert.equal(input.L.results[0].groups.provider[0].success_amount,null,'known count cannot fabricate missing INR/IDR/BRL amount');
 const html=a.render(input);assert.match(html,/创建日期订单的当前成功笔数/);assert.doesNotMatch(html,/成功日期默认沿查询日期|可能超过 100%|源订单完成时间统计/);if(source==='panda')assert.match(html,/仅含已审核提现/);
});
test('created mode needs exact validated cohort echo, no secondary clock, and no manual input',()=>{
 for(const mutate of[r=>delete r.capabilities.successCohort,r=>r.capabilities.successCohort='success_at_in_selected_range',r=>delete r.capabilities.successMetricBasis,r=>r.capabilities.successMetricBasis='success',r=>r.capabilities.independentSuccessWindow=true,r=>delete r.capabilities.independentSuccessWindow,r=>r.successStartAt=null,r=>r.successEndAt='2026-10-04T00:00:00Z']){
  const a=api(),p=target('NEW_AR'),r=created(p,[row('withdraw',10,5)]);r.capabilities.successTimeAvailable=true;r.capabilities.withdrawSuccessTimeAvailable=true;mutate(r);const input=props({queryPlatforms:[p],results:[r],workorders:null}),model=a.buildModel(input);assert.equal(model.rows[0].withdraw[0].value,null);assert.equal(model.footers.withdraw[0].value,null);
 }
 for(const fields of[{successFrom:'2026-10-03T00:00:00'},{successTo:'2026-10-03T23:59:59'},{successFrom:'2026-10-03T00:00:00',successTo:'2026-10-03T23:59:59'}]){const a=api(),p=target('AR'),input=props({...fields,queryPlatforms:[p],results:[created(p,[row('withdraw',10,5)])],workorders:null});assert.equal(a.buildModel(input).footers.withdraw[0].value,null);}
});
test('manual independent success retains real clock gate and cross-day rates',()=>{
 const a=api(),p=target('NEW_AR'),r={...payment(p,[row('withdraw',10,12)],[row('withdraw',10,12)]),successBasis:'success',successStartAt:'2026-10-03T00:00:00Z',successEndAt:'2026-10-04T00:00:00Z',capabilities:{withdrawSuccessTimeAvailable:false}},input=props({queryPlatforms:[p],results:[r],successFrom:'2026-10-03T00:00:00',successTo:'2026-10-03T23:59:59',workorders:null});
 assert.equal(a.buildModel(input).footers.withdraw[0].value,null);p.capabilities={withdrawSuccessTimeAvailable:true};r.capabilities.withdrawSuccessTimeAvailable=true;assert.equal(a.buildModel(input).footers.withdraw[0].value,120);assert.match(a.buildModel(input).rows[0].withdraw[0].note,/可能超过 100%/);assert.match(a.render(input),/成功时间内成功笔数/);
});
test('created zero remains zero, absent count remains unknown and partial totals weight only paired evidence',()=>{
 const a=api(),p=target('AR'),q={...target('NEW_AR'),id:'other'},input=props({queryPlatforms:[p,q],results:[created(p,[row('withdraw',10,0)]),created(q,[row('withdraw',90,null)])],workorders:null});
 let m=a.buildModel(input);assert.equal(m.rows[0].withdraw[0].value,0);assert.equal(m.rows[0].withdraw[1].value,null);assert.equal(m.rows[0].totals.withdraw.value,0);assert.equal(m.rows[0].totals.withdraw.total,10);assert.equal(m.rows[0].totals.withdraw.partial,true);
 input.L.results[1].groups.provider[0].success_count=45;input.L.results[1]._preparedPublication={sourceComplete:false};m=a.buildModel(input);assert.equal(m.rows[0].totals.withdraw.value,45);assert.equal(m.rows[0].totals.withdraw.partial,true);
});
test('scope rejection, dirty filters and repeated render preserve existing isolation and DTOs',()=>{
 const a=api(),p=target('WG'),input=props({queryPlatforms:[p],results:[created(p,[row('withdraw',10,5)])],workorders:null}),before=JSON.stringify(input);const first=a.render(input);assert.equal(a.render(input),first);assert.equal(JSON.stringify(input),before);assert.equal(a.buildModel({...input,scopeMatches:false}).ready,false);input.L.dirty=true;assert.equal(a.buildModel(input).ready,false);
});
test('created query window copy labels current status without claiming an implicit successful date',()=>{
 const a=api(),p=target('kb'),input=props({queryPlatforms:[p],results:[created(p,[row('withdraw',10,5)])],successWindows:[{from:'2026-10-03T00:00:00',to:'2026-10-03T23:59:59',timezone:'Asia/Kolkata',successBasis:'created'}],workorders:null});const html=a.render(input);assert.match(html,/按创建订单当前成功状态统计/);assert.doesNotMatch(html,/默认沿查询日期/);
});
