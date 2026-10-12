/* Synthetic RPC rows only. Exercise both real drawer entry points. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const preview=path.join(__dirname,'../admin-preview');
const helpers=(name,names)=>new Function('require','__dirname',fs.readFileSync(path.join(__dirname,name),'utf8').split(/\ntest\(/)[0]+';return {'+names+'};')(require,__dirname);
const {fixture}=helpers('admin-provider-usdt-orders.test.cjs','fixture');
const {setup,segment,links,response,flush}=helpers('analysis-segment-orders-ui.test.cjs','setup,segment,links,response,flush');
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const N=v=>v==null?'—':Number(v).toFixed(2);
async function drawer(kind,record,platform={},business){
 if(kind==='provider'){
  const h=fixture(),p=h.platforms[1];Object.assign(p,platform);Object.assign(h.records.b[0],{currency:'INR'},record);
  if(business)h.root.HensemOrderBusiness=business;
  await h.api.open('USDT','','charge','b');h.root.liveProviderOrder(0);return {html:h.html(),p};
 }
 const h=setup(q=>{const data=response(q);Object.assign(data.rows[0],record);return Promise.resolve(data)}),p=h.L.catalog[1];Object.assign(p,platform);
 if(record.currency){h.L.currency=record.currency;for(const result of h.L.results){result.platform.currency=record.currency;for(const rows of [result.summary,...Object.values(result.groups)])for(const row of rows)row.currency=record.currency;}}
 vm.runInNewContext(fs.readFileSync(path.join(preview,'live-provider-orders.js'),'utf8'),{window:h.root,Intl});
 if(business)h.root.HensemOrderBusiness=business;
 h.instance.open(segment,'08时');h.root.liveAnalysisOrders(links(h.instance.panel(segment)).find(x=>x.value.platformId==='b'&&x.value.basis==='created').key);await flush();h.root.liveAnalysisOrder(0);
 return {html:h.drawers.at(-1).html,p};
}
const cell=(html,label)=>html.match(new RegExp('<td>'+label+'</td><td>(.*?)</td>'))?.[1];
for(const kind of ['provider','analysis']){
 test(kind+' drawer renders the RPC actual amount and recorded fee with its own currency, including zero',async()=>{
  const {html}=await drawer(kind,{actual_amount:'97.50',withdraw_fee:0,currency:'PKR'},{capabilities:{actualAmount:true,recordedFee:true}});
  assert.match(cell(html,'实际金额'),/^97\.5(?:0)? PKR$/);assert.match(cell(html,'已记录手续费'),/^0(?:\.00)? PKR$/);
  assert.equal((html.match(/<td>实际金额<\/td>/g)||[]).length,1);assert.equal((html.match(/<td>已记录手续费<\/td>/g)||[]).length,1);
 });
 test(kind+' drawer keeps missing or malformed money unknown and honors explicit unsupported capabilities',async()=>{
  for(const value of [null,undefined,'','  ',false,'NaN','Infinity',-1]){
   const {html}=await drawer(kind,{actual_amount:value,withdraw_fee:value});assert.equal(cell(html,'实际金额'),'—');assert.equal(cell(html,'已记录手续费'),'—');
  }
  const blocked=await drawer(kind,{actual_amount:200,withdraw_fee:10},{source:'duoli',capabilities:{actualAmount:false,recordedFee:false}});
  assert.equal(cell(blocked.html,'实际金额'),'—');assert.equal(cell(blocked.html,'已记录手续费'),'—');
  const lg=await drawer(kind,{actual_amount:100,withdraw_fee:22},{source:'lg'});assert.match(cell(lg.html,'实际金额'),/^100(?:\.00)? INR$/);assert.equal(cell(lg.html,'已记录手续费'),'—');
 });
 test(kind+' drawer keeps native settlement fees separate without estimating the missing fiat fee',async()=>{
  const {html}=await drawer(kind,{amount:'1000',currency:'INR',member_currency:'INR',actual_amount:null,withdraw_fee:null,settlement_currency:'USDT',settlement_amount:'12.5',settlement_fee:'0.125'});
  assert.equal(cell(html,'实际金额'),'—');assert.equal(cell(html,'已记录手续费'),'—');assert.match(cell(html,'结算金额'),/^12\.5 USDT$/);assert.match(cell(html,'结算手续费'),/^0\.1(?:25|3) USDT$/);
  assert.doesNotMatch(cell(html,'已记录手续费'),/USDT|INR/);
 });
 test(kind+' drawer passes its exact platform and formatting tools to the optional business details module',async()=>{
  const seen=[],business={rows:(r,p,tools)=>{seen.push({r,p,tools});return [['安全操作字段',tools.E('<synthetic>')]];}};
  const {html,p}=await drawer(kind,{actual_amount:0,withdraw_fee:'0'},undefined,business);
  assert.equal(seen.length,1);assert.equal(seen[0].p,p);assert.equal(typeof seen[0].tools.formatTime,'function');assert.equal(cell(html,'安全操作字段'),'&lt;synthetic&gt;');assert.doesNotMatch(html,/<synthetic>/);
 });
}
test('the shared recorded-money helper honors the existing field-availability callback and escapes currency',()=>{
 const h={};vm.runInNewContext(fs.readFileSync(path.join(preview,'live-provider-orders.js'),'utf8'),{window:h,Intl});
 const rows=h.HensemProviderOrders.recordedMoneyRows({currency:'<INR>',actual_amount:0,withdraw_fee:2},{source:'newar'},{E,N},(_p,key,value)=>key==='recordedFee'?null:value);
 assert.equal(rows[0][1],'0.00 &lt;INR&gt;');assert.equal(rows[1][1],'—');
});
