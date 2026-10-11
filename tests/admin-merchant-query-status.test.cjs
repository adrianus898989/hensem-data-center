
// Execute the production merchant renderer with synthetic aggregate facts.
/* Actual production renderer and fee facts, entirely synthetic; no live data or network. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const harnessSource=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {ready,completeAggregate,P,settle}=new Function('require','__dirname',harnessSource+';return {ready,completeAggregate,P,settle};')(require,__dirname);
const plain=s=>String(s).replace(/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g,'').replace(/<[^>]*>/g,'').trim();
function tables(html){return [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map(m=>({html:m[0],headers:[...(m[0].match(/<thead>[\s\S]*?<\/thead>/)?.[0]||'').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(x=>plain(x[1])),rows:tr(m[0].match(/<tbody>[\s\S]*?<\/tbody>/)?.[0]||''),footer:tr(m[0].match(/<tfoot>[\s\S]*?<\/tfoot>/)?.[0]||'')}));}
function tr(html){return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(x=>x[1]));}
const ledger=h=>tables(h.html()).find(t=>t.headers.includes('使用三方'));
const cell=(t,row,label)=>row[t.headers.indexOf(label)];
const amount=html=>plain(html.replace(/<span class="merchant-fee-coverage-inline"[^>]*>[\s\S]*?<\/span>/g,'').replace(/<span class="merchant-fee-status">[\s\S]*?<\/span>/g,'')).match(/^[\d,]+\.\d{2}|^—|^不适用/)?.[0];
function history(row,value,matched=row.success_count){return {...row,fee_version_estimated_amount:String(value),fee_version_matched_count:matched,fee_version_unmatched_count:row.success_count-matched,fee_version_state:matched===row.success_count?'complete':matched?'partial':'unknown'};}
const rate=(extra={})=>({scopeType:'country',country:'印度',provider:'ExamplePay',collectFee:'4%',payoutFee:'3%',...extra});
async function setup(){
 const platforms=[{...P,name:'Alpha',source:'ar'},{...P,id:'22222222-2222-4222-8222-222222222222',name:'Beta',source:'newar'}],h=await ready({platforms});
 const a=completeAggregate(platforms[0],10,5),b=completeAggregate(platforms[1],20,6),w={...completeAggregate(platforms[0],10,3).summary[0],direction:'withdraw'};
 a.summary.push(w);a.groups.provider=[history({...a.summary[0],provider:'ExamplePay',success_count:4,success_amount:'400'},80),{...a.summary[0],provider:'FixedPay',all_count:1,all_amount:'100',success_count:1,success_amount:'100'},history({...w,provider:'ExamplePay'},15)];
 b.groups.provider=[history({...b.summary[0],provider:'ExamplePay'},10)];
 h.c.setPage('merchants');Object.assign(h.L,{results:[a,b],queryPlatforms:platforms,direction:'all',comparisonStatus:'idle',dirty:false,loading:false,pageQueried:true,feeLookupLoading:false,feeLookupError:'',feeLookupRows:[rate(),rate({scopeType:'platform',platform:'Alpha',collectFee:'2%'}),rate({scopeType:'platform',platform:'Beta',collectFee:'5%'}),rate({provider:'FixedPay',collectSingleFee:'6'})],view:'business'});
 h.c.render();return h;
}
function open(h,platform='Alpha'){
 const t=ledger(h),row=platform==='total'?t.footer[0]:t.rows.find(r=>plain(r[0])===platform),usage=cell(t,row,'使用三方'),index=Number(usage.match(/liveMerchantProviderUsage\((\d+)\)/)[1]);
 if(!usage.includes('aria-expanded="true"'))h.c.liveMerchantProviderUsage(index);
 return currentInline(h,platform);
}
function currentInline(h,platform='Alpha'){
 const t=ledger(h),entries=[...t.html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)],index=entries.findIndex(r=>!r[1].includes('merchant-provider-')&&plain(r[2].match(/<td\b[^>]*>([\s\S]*?)<\/td>/)?.[1]||'')===(platform==='total'?'已读汇总 · INR':platform)),note=entries[index+1];assert.match(note?.[1]||'',/merchant-provider-inline-note/);
 const children=[];for(const r of entries.slice(index+2)){if(!r[1].includes('merchant-provider-inline-row'))break;children.push(r[0]);}
 return {html:note[0]+'<table>'+t.html.match(/<thead>[\s\S]*?<\/thead>/)[0]+'<tbody>'+children.join('')+'</tbody></table>'};
}
const reference=(row,d)=>row[0].match(new RegExp(d+'当前参考费率：([\\s\\S]*?)(?=；代(?:收|付)当前参考费率：|"|$)'))?.[1]||'';
function connectedInline(h){
 const query=h.c.document.querySelector;let detached=false;
 h.c.document.querySelector=selector=>{if(selector.startsWith('[data-merchant-provider-inline=')){const marker=selector.match(/"(\d+)"/)?.[1];return !detached&&h.html().includes('data-merchant-provider-inline="'+marker+'"')?{isConnected:true}:null;}return query(selector);};
 return {replace(){detached=true;}};
}
function feeCard(h,direction){const section=h.html().match(new RegExp('<section class="live-reference-direction" data-direction="'+direction+'">[\\s\\S]*?<\\/section>'))?.[0]||'',html=section.slice(section.indexOf('<div class="kpi" data-metric="fee"'));return {html,value:plain(html.match(/<div class="kpi-value">([\s\S]*?)<\/div>/)?.[1]||'')};}


test('merchant success rates below 49.99 percent are red in platform, provider and total rows',async()=>{
 const h=await setup();h.L.results=h.L.results.slice(0,1);h.L.queryPlatforms=h.L.queryPlatforms.slice(0,1);
 for(const [count,denominator,low] of [[4998,10000,true],[4999,10000,false],[5000,10000,false],[0,10,true],[0,0,false],[null,100,false],[120,100,false]]){
  const a=h.L.results[0];a.summary=[{...a.summary[0],all_count:denominator,success_count:count}];a.groups.provider=[{...a.summary[0],provider:'ExamplePay'}];h.c.render();
  const t=ledger(h),value=cell(t,t.rows[0],'代收成功率'),total=cell(t,t.footer[0],'代收成功率');
  assert.equal(value.includes('merchant-success-rate-low'),low,JSON.stringify([count,denominator]));assert.equal(total.includes('merchant-success-rate-low'),low);
  h.L.view='providers';h.c.render();const providers=tables(h.html()).find(t=>t.headers[0]==='三方');assert.equal(cell(providers,providers.rows[0],'代收成功率').includes('merchant-success-rate-low'),low);h.L.view='business';
 }
 const css=fs.readFileSync(path.join(__dirname,'../admin-preview/live-reference-pages.css'),'utf8');assert.match(css,/\.merchant-success-rate-low\{[^}]*color:#d6374a!important/);
});

test('current fee lookup failure has an explicit retry while historical supplied fees stay readable',async()=>{
 const h=await setup();h.L.feeLookupError='Synthetic rate request failed';h.L.feeLookupRows=[];h.c.render();
 let t=ledger(h),row=t.rows.find(r=>plain(r[0])==='Alpha');assert.match(cell(t,row,'代收手续费'),/费率读取失败/);assert.match(h.html(),/onclick="liveRetryFeeLookup\(\)"[^>]*>重试费率/);assert.doesNotMatch(cell(t,row,'代收手续费'),/>0\.00</);
 h.c.liveMerchantFeeMode('historical');t=ledger(h);row=t.rows.find(r=>plain(r[0])==='Alpha');assert.match(cell(t,row,'代收手续费'),/80\.00/);assert.doesNotMatch(cell(t,row,'代收手续费'),/费率读取失败/);assert.doesNotMatch(cell(t,row,'代收匹配占比'),/读取失败/);
 h.L.feeLookupError='';h.L.feeLookupLoading=true;h.c.render();t=ledger(h);row=t.rows.find(r=>plain(r[0])==='Alpha');assert.match(cell(t,row,'代收手续费'),/80\.00/);assert.doesNotMatch(cell(t,row,'代收手续费'),/匹配中/);
});
