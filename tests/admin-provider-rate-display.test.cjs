/* Synthetic presentation checks; no live rates or orders. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const shared=fs.readFileSync(path.join(__dirname,'admin-provider-payout.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {E,N,C,R,plus,combine,table,order}=new Function('require','__dirname',shared+';return {E,N,C,R,plus,combine,table,order};')(require,__dirname);
const longRate='2001以上 2% 2000以下 3% / 单笔 2000以下 3%+6';
function fixture(direction='withdraw',label=longRate,provider='Speed2Pay',facts={}){
 const root={Intl,Date};root.window=root;vm.createContext(root);for(const name of ['live-provider-aliases.js','live-comparison.js','live-provider-summary.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8'),root);
 const orders=[order('platform-a','ar',123456.78,100,{provider,direction,...facts})],L={country:'印度',currency:'INR',from:'2026-09-25T00:00:00',to:'2026-09-25T23:59:59',results:[{platform:{id:'platform-a',country:'印度',currency:'INR',timezone:'Asia/Kolkata'}}],comparisonResults:[],comparisonStatus:'idle',feeLookupRows:[{provider,country:'印度',scopeType:'country',sheetName:'印度线下',sourceRow:30,collectFee:label,payoutFee:label}],localPage:1,localSize:20,workorders:null};
 let html='',drawer=null,requests=0;const ctx={L,E,N,C,R,plus,combine,groupRows:()=>orders,table,box:(title,body)=>'<section><h2>'+E(title)+'</h2>'+body+'</section>',pager:()=>'',providerCell:r=>E(r.provider),feeForRow:()=>label,ensureFeeLookup(){requests++},openDrawer(title,body){drawer={title,body}},render(){html=root.HensemProviderSummary.render(ctx,direction)}};ctx.render();return {root,L,html:()=>html,drawer:()=>drawer,requests:()=>requests};
}
test('long fee stays a short keyboard-accessible button and opens complete original source without requests',()=>{
 const h=fixture();const button=h.html().match(/<button class="link provider-fee-preview"[^>]*>([^<]*)<\/button>/);assert(button);assert.equal(button[1],'分档费率 · 查看');assert.match(button[0],/title="已确认：按每笔成功金额分档估算。≤2,000：3% \+ 6 \/ 笔；≥2,001：2%/);assert.match(button[0],/2,000 &lt; 金额 &lt; 2,001/);assert.match(button[0],/aria-label="费率：已确认/);assert.match(button[0],/onclick="providerSummaryRate\(0\)"/);
 h.root.providerSummaryRate(0);assert.equal(h.drawer().title,'Speed2Pay · 费率依据');assert(h.drawer().body.includes(longRate));assert.match(h.drawer().body,/印度线下 \/ 30/);assert.match(h.drawer().body,/provider-rate-details/);assert.match(h.drawer().body,/当前确认规则/);assert.match(h.drawer().body,/原表费率记录/);assert.match(h.drawer().body,/原表参考/);assert.doesNotMatch(h.drawer().body,/当前匹配/);assert.match(h.drawer().body,/不计入已匹配笔数/);assert.equal(h.requests(),0);
});
test('both directions share exact column widths with expanded platform rows and retain plain short rates',()=>{
 for(const direction of ['charge','withdraw']){
  const h=fixture(direction,'2.5% + 6 / 笔','ExamplePay');h.root.providerSummaryToggle(0);const html=h.html(),cols=[...html.matchAll(/<col style="width:(\d+)px">/g)],headers=[...html.matchAll(/<th>([\s\S]*?)<\/th>/g)];assert.equal(cols.length,headers.length);assert.equal(cols.length,direction==='withdraw'?23:26);
  const feeColumn=headers.findIndex(m=>m[1].includes('当前参考费率'));assert.equal(Number(cols[feeColumn][1]),88);assert.match(html,/>2\.5% \+ 6 \/ 笔<\/button>/);
  const preferredWidth=cols.reduce((sum,col)=>sum+Number(col[1]),0);assert(preferredWidth<=(direction==='withdraw'?2000:2266));
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

// Current rule references remain readable, but only server version facts supply historical money.
test('rate preview changes do not recalculate the historical matched amount and absent versions remain unknown',()=>{
 const facts={fee_version_state:'complete',fee_version_matched_count:100,fee_version_unmatched_count:0,fee_version_estimated_amount:71.25};
 for(const label of [longRate,'9% + 99 / 笔']){const h=fixture('withdraw',label,'Speed2Pay',facts);assert.match(h.html(),/71\.25/);assert.match(h.html(),/手续费已匹配 100 \/ 100/);}
 const absent=fixture();assert.match(absent.html(),/历史费率未匹配|订单创建时的费率版本或币种未确认/);assert.match(absent.html(),/—<small class="provider-partial cell-sub">历史费率未匹配/);
 const partial=fixture('withdraw',longRate,'Speed2Pay',{...facts,fee_version_state:'partial',fee_version_matched_count:40,fee_version_unmatched_count:60,fee_version_estimated_amount:17.25});assert.match(partial.html(),/17\.25/);assert.match(partial.html(),/未匹配 60 笔/);assert.match(partial.html(),/手续费已匹配 40 \/ 100/);
});

test('unmatched historical fees use a separate compact line and do not guess a source-cell cause',()=>{
 const h=fixture('charge','4%','ExamplePay');h.root.providerSummaryToggle(0);const html=h.html();
 assert.match(html,/>4%<\/button>/,'current reference is still readable');
 const badges=[...html.matchAll(/<small class="provider-partial cell-sub">([^<]*)<\/small>/g)];
 assert(badges.length>=2,'parent and platform child both show the same historical coverage label');
 assert(badges.every(m=>m[1]==='历史费率未匹配'));
 assert.doesNotMatch(html,/BC6|缺少生效时间|自动回算/,'generic unmatched facts cannot identify one particular missing cell or offer repricing');
 assert.match(html,/按订单创建时间匹配费率版本；未匹配部分不按零手续费计算/);
 const css=fs.readFileSync(path.join(__dirname,'../admin-preview/live-configuration.css'),'utf8');
 assert.match(css,/\.provider-summary-table \.cell-sub\{display:block/,'the label uses the existing separate-line style within the fixed fee column');
 assert.equal(h.requests(),0);
});

const evidence=(state='missing_effective_time',cell='BC2',extra={})=>({state,effectiveFrom:null,versionId:null,source:{sheetName:'Synthetic fee sheet',effectiveCell:cell},...extra});
function withEvidence(h,direction,e){h.L.feeLookupRows[0].feeEffective={[direction]:e};h.root.providerSummaryToggle(0);return h;}
const feeBadges=html=>[...html.matchAll(/<small class="provider-partial cell-sub">([^<]*)<\/small>/g)].map(m=>m[1]);

test('explicit missing effective time identifies the source cell without calculating a current-rate fee',()=>{
 for(const direction of ['charge','withdraw']){
  const h=withEvidence(fixture(direction,'4%','ExamplePay'),direction,evidence());
  assert(feeBadges(h.html()).length>=2);assert(feeBadges(h.html()).every(label=>label==='缺少生效时间'));
  assert.match(h.html(),/Synthetic fee sheet BC2/);assert.match(h.html(),/已匹配 0；未匹配 100 笔/);
  assert.match(h.html(),/—<small class="provider-partial cell-sub">缺少生效时间/);
  const rows=h.root.HensemProviderSummary.buildRows({orders:[order('platform-a','ar',123456.78,100,{provider:'ExamplePay',direction})],issues:null,rates:h.L.feeLookupRows,country:'印度',direction,plus,combine});
  assert.equal(rows[0].estimated_fee,null);assert.equal(rows[0].fee_matched_count,0);
  h.root.providerSummaryRate(0);const drawer=h.drawer().body;
  assert.match(drawer,/历史生效状态/);assert.match(drawer,/生效时间 \/ 来源/);assert.match(drawer,/缺少生效时间/);assert.match(drawer,/Synthetic fee sheet BC2 · 未提供生效时间/);
  assert.match(drawer,/需在源表填写真实生效时间/);assert.match(drawer,/不能自动使用今天或把当前费率套到所有历史订单/);assert.equal(h.requests(),0);
 }
});

test('only evidence for the selected direction and applicable platform can identify the historical gap',()=>{
 const h=fixture('charge','4%','ExamplePay');h.L.feeLookupRows[0].feeEffective={withdraw:evidence()};h.root.providerSummaryToggle(0);
 assert(feeBadges(h.html()).every(label=>label==='历史费率未匹配'));
 const country=h.L.feeLookupRows[0];country.feeEffective={charge:evidence()};
 h.L.feeLookupRows.push({...country,scopeType:'platform',platform:'Same displayed platform',collectFee:'9%',feeEffective:{charge:evidence('ready','BC9',{effectiveFrom:'2026-09-26T00:00:00+05:30',versionId:'synthetic-version'})}});
 h.root.providerSummaryToggle(0);h.root.providerSummaryToggle(0);
 assert(feeBadges(h.html()).every(label=>label==='历史费率未匹配'),'country-row gaps cannot replace the selected platform rule');
 assert.doesNotMatch(h.html(),/当前费率来源缺项/);
});

test('mixed, missing and contradictory evidence never guesses one cause for an entire provider',()=>{
 for(const extra of [undefined,evidence('invalid_effective_time','BC3'),evidence('ready','BC3',{versionId:'synthetic-version',effectiveFrom:'2026-09-26T00:00:00+05:30'})]){
  const h=fixture('charge','4%','ExamplePay');h.L.feeLookupRows[0].feeEffective={charge:evidence()};
  h.L.feeLookupRows.push({...h.L.feeLookupRows[0],sourceRow:31,feeEffective:extra?{charge:extra}:undefined});h.root.providerSummaryToggle(0);
  assert(feeBadges(h.html()).every(label=>label==='历史费率未匹配'));assert.doesNotMatch(h.html(),/当前费率来源缺项/);
 }
 for(const contradictory of [{versionId:'synthetic-version'},{effectiveFrom:'2026-09-25T00:00:00+05:30'}]){
  const h=withEvidence(fixture('charge','4%','ExamplePay'),'charge',evidence('missing_effective_time','BC2',contradictory));
  assert(feeBadges(h.html()).every(label=>label==='历史费率未匹配'));
 }
});

test('partial or fully matched backend fee amounts remain authoritative when current source evidence changes',()=>{
 for(const [state,matched,amount] of [['partial',40,17.25],['complete',100,71.25]]){
  const h=withEvidence(fixture('charge','9%','ExamplePay',{fee_version_state:state,fee_version_matched_count:matched,fee_version_unmatched_count:100-matched,fee_version_estimated_amount:amount}),'charge',evidence());
  assert.match(h.html(),new RegExp(amount.toFixed(2).replace('.','\\.')));assert.match(h.html(),new RegExp('手续费已匹配 '+matched+' \\/ 100'));
  if(state==='partial')assert(feeBadges(h.html()).every(label=>label==='部分'));
  else {assert.equal(feeBadges(h.html()).length,0);assert.doesNotMatch(h.html(),/当前费率来源缺项/)}
 }
});

test('source-sheet text and effective coordinates are escaped in fee cells and the source drawer',()=>{
 const value=evidence();value.source={sheetName:'<script>alert(1)</script> & "sheet"',effectiveCell:'BC2<img src=x>'};
 const h=withEvidence(fixture('charge','4%','ExamplePay'),'charge',value);h.root.providerSummaryRate(0);
 for(const html of [h.html(),h.drawer().body]){assert.doesNotMatch(html,/<script|<img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/BC2&lt;img/)}
});
