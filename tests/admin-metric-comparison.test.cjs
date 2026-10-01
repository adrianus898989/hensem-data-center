/* Pure renderers with synthetic values only; no account or network access. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root={};vm.createContext(root);for(const file of ['live-comparison.js','live-reference-layout.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview',file),'utf8'),root);
const api=root.HensemLiveLayout,plain=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const current={all_amount:8000,all_count:80,success_amount:1200,success_count:8,pending_amount:null,pending_count:10,failed_amount:0,failed_count:0};
const prior={all_amount:10000,all_count:100,success_amount:900,success_count:12,pending_amount:100,pending_count:12,failed_amount:0,failed_count:0};
const opts={previous:prior,comparisonStatus:'ready',comparisonLabel:'较前一日同一时段',label:'代收'};
const cards=html=>Object.fromEntries(html.split('<div class="kpi" ').slice(1).map(card=>[card.match(/data-metric="([^"]+)"/)[1],plain(card)]));

test('money cards visibly show absolute money and count differences alongside their separate percentages',()=>{
 const html=api.renderMetrics(current,opts),v=cards(html);assert.equal(Object.keys(v).length,6);
 assert.match(v.all,/较昨日 -2,000\.00（-20\.00%）/);assert.match(v.all,/较昨日 -20 笔（-20\.00%）/);
 assert.match(v.success,/较昨日 \+300\.00（\+33\.33%）/);assert.match(v.success,/较昨日 -4 笔（-33\.33%）/);
 assert.match(v.pending,/较昨日 —/);assert.match(v.pending,/较昨日 -2 笔（-16\.67%）/);
 assert.match(v.failed,/较昨日 0\.00（持平）/);assert.match(v.failed,/较昨日 0 笔（持平）/);
 assert.match(v.success_rate,/较昨日 -2\.00 个百分点/);assert.doesNotMatch(v.success_rate,/（|同比/);
 assert.match(v.fee,/对比 —/);assert.doesNotMatch(v.fee,/\+0|0\.00%/);
 assert.equal((html.match(/data-change="amount"/g)||[]).length,4);assert.equal((html.match(/data-change="count"/g)||[]).length,4);
});

test('zero baseline keeps known differences but never fabricates a percent',()=>{
 for(const [value,kind,expected]of [[25.125,'amount','+25.13'],[9,'count','+9 笔'],[-3,'amount','-3.00']]){
  const r=api.comparison(value,0,opts,false,kind);assert(r.text.includes(expected));assert.match(r.text,/无基数/);assert.doesNotMatch(r.text,/%|Infinity|NaN/);
 }
 assert.match(api.comparison(0,0,opts).text,/0\.00（持平）/);
 assert.match(api.comparison(0.3,0.1+0.2,opts).text,/ 0\.00（持平）/);assert.doesNotMatch(api.comparison(0.3,0.1+0.2,opts).text,/-0\.00/);
});

test('missing values and unavailable or loading comparisons do not become zero changes',()=>{
 for(const value of [null,undefined,'',' ',false,{},[],NaN,Infinity])for(const reverse of [false,true]){
  const r=api.comparison(reverse?100:value,reverse?value:100,opts);assert.equal(r.text,'较昨日 —');assert.doesNotMatch(r.text,/0\.00|100|新增/);
 }
 for(const [comparisonStatus,text]of [['loading','对比读取中'],['error','对比暂不可用'],['idle','对比暂不可用']]){const v=cards(api.renderMetrics(current,{...opts,comparisonStatus}));assert(v.all.includes(text));assert.doesNotMatch(v.all,/-2,000|-20 笔/)}
 const noPrevious=cards(api.renderMetrics(current,{comparisonStatus:'ready'}));assert.match(noPrevious.all,/对比暂不可用/);
});

test('rate differences stay percentage points and multi-day comparisons retain their real period',()=>{
 const r=api.comparison([12,10],[10,20],{...opts,comparisonLabel:'较前一周期（3天）'},true);assert.equal(r.text,'较前期 +70.00 个百分点');assert.equal(r.title,'较前一周期（3天）');
 assert.equal(api.comparison([0,0],[1,10],opts,true).text,'较昨日 —');
 const html=api.renderMetrics(current,{...opts,comparisonLabel:'较前一日 <img src=x onerror=bad>'});assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
