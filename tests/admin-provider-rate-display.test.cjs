/* Synthetic presentation checks; no live rates or orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {E,N,C,R,plus,combine,table,order}=new Function('require','__dirname',shared+';return {E,N,C,R,plus,combine,table,order};')(require,__dirname);
const longRate='2001以上 2% 2000以下 3% / 单笔 2000以下 3%+6';
function fixture(direction='withdraw',label=longRate,provider='Speed2Pay'){
 const root={Intl,Date};root.window=root;vm.createContext(root);for(const name of ['live-provider-aliases.js','live-comparison.js','live-provider-summary.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8'),root);
 const orders=[order('platform-a','ar',123456.78,100,{provider,direction})],L={country:'印度',currency:'INR',from:'2026-09-25T00:00:00',to:'2026-09-25T23:59:59',results:[{platform:{id:'platform-a',country:'印度',currency:'INR',timezone:'Asia/Kolkata'}}],comparisonResults:[],comparisonStatus:'idle',feeLookupRows:[{provider,country:'印度',scopeType:'country',sheetName:'印度线下',sourceRow:30,collectFee:label,payoutFee:label}],localPage:1,localSize:20,workorders:null};
 let html='',drawer=null,requests=0;const ctx={L,E,N,C,R,plus,combine,groupRows:()=>orders,table,box:(title,body)=>'<section><h2>'+E(title)+'</h2>'+body+'</section>',pager:()=>'',providerCell:r=>E(r.provider),feeForRow:()=>label,ensureFeeLookup(){requests++},openDrawer(title,body){drawer={title,body}},render(){html=root.HensemProviderSummary.render(ctx,direction)}};ctx.render();return {root,L,html:()=>html,drawer:()=>drawer,requests:()=>requests};
}
test('long fee stays a short keyboard-accessible button and opens complete original source without requests',()=>{
 const h=fixture();const button=h.html().match(/<button class="link provider-fee-preview"[^>]*>([^<]*)<\/button>/);assert(button);assert.equal(button[1],'分档费率 · 查看');assert.match(button[0],/title="已确认：按每笔成功金额分档估算。≤2,000：3% \+ 6 \/ 笔；≥2,001：2%/);assert.match(button[0],/2,000 &lt; 金额 &lt; 2,001/);assert.match(button[0],/aria-label="费率：已确认/);assert.match(button[0],/onclick="providerSummaryRate\(0\)"/);
 h.root.providerSummaryRate(0);assert.equal(h.drawer().title,'Speed2Pay · 费率依据');assert(h.drawer().body.includes(longRate));assert.match(h.drawer().body,/印度线下 \/ 30/);assert.match(h.drawer().body,/provider-rate-details/);assert.match(h.drawer().body,/当前确认规则/);assert.match(h.drawer().body,/原表费率记录/);assert.match(h.drawer().body,/原表参考/);assert.doesNotMatch(h.drawer().body,/当前匹配/);assert.match(h.drawer().body,/不计入已匹配笔数/);assert.equal(h.requests(),0);
});
test('both directions share exact column widths with expanded platform rows and retain plain short rates',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture(direction,'2.5% + 6 / 笔','ExamplePay');h.root.providerSummaryToggle(0);const html=h.html(),cols=[...html.matchAll(/<col style="width:(\d+)px">/g)],headers=[...html.matchAll(/<th>([\s\S]*?)<\/th>/g)];assert.equal(cols.length,headers.length);assert.equal(cols.length,direction==='withdraw'?27:25);
  const feeColumn=headers.findIndex(m=>m[1].includes('匹配费率'));assert.equal(Number(cols[feeColumn][1]),86);assert.match(html,/>2\.5% \+ 6 \/ 笔<\/button>/);
  const preferredWidth=cols.reduce((sum,col)=>sum+Number(col[1]),0);assert(preferredWidth<=(direction==='withdraw'?1850:1700));
  assert.match(html,/123,456\.78/,'the full decimal amount survives the compact presentation');
  const children=[...html.matchAll(/<tr class="provider-platform-row">([\s\S]*?)<\/tr>/g)];assert.equal(children.length,1);assert.equal([...children[0][1].matchAll(/<td>/g)].length,cols.length);assert.equal(h.requests(),0);
 }
});
test('untrusted source text is escaped in rate summary, title, label and drawer',()=>{
 const label='<img src=x onerror=alert(1)> " & 2001以上 2%';const h=fixture('withdraw',label,'ExamplePay');assert.doesNotMatch(h.html(),/<img/);assert.match(h.html(),/&lt;img/);assert.match(h.html(),/&quot;/);h.root.providerSummaryRate(0);assert.doesNotMatch(h.drawer().body,/<img/);assert.match(h.drawer().body,/&lt;img/);
});

test('expanded Speed2Pay fee tooltip uses the confirmed rule while collection keeps its original rule',()=>{
 const h=fixture();h.root.providerSummaryToggle(0);const buttons=[...h.html().matchAll(/<button class="link provider-fee-preview"[^>]*>/g)];assert.equal(buttons.length,2);
 for(const [button] of buttons){assert.match(button,/按每笔成功金额/);assert.match(button,/≤2,000：3% \+ 6 \/ 笔；≥2,001：2%/);assert.match(button,/2,000 &lt; 金额 &lt; 2,001/)}
 const charge=fixture('charge','4%');assert.match(charge.html(),/>4%<\/button>/);charge.root.providerSummaryRate(0);assert.doesNotMatch(charge.drawer().body,/当前确认规则/);
});
