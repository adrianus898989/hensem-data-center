const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(data,view='auto_withdraw'){
 const root={HensemLiveFilters:{multi:()=>''}},tables=[];root.window=root;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8'),root);
 const p={id:'77777777-7777-4777-8777-777777777777',name:'POPMIU',sourceName:'POPMIU',source:'wg',country:'巴西',team:'M8',timezone:'America/Sao_Paulo'};
 const page=root.HensemLiveWithdrawPages.create({L:{catalogReady:true,catalog:[p],country:'巴西',from:'2026-10-06',to:'2026-10-06'},page:()=>view,E:v=>String(v??'').replaceAll('"','&quot;'),C:String,N:String,R:(a,b)=>(a/b*100).toFixed(2)+'%',box:(_title,body)=>body,table:(headers,rows,cls,footers)=>{tables.push({headers,rows,footers});return '';},render:()=>{},request:async()=>({})});
 page.state.data=data;return {page,tables};
}
const row=(more={})=>({country:'巴西',platform:'POPMIU',total:1026,success:996,rejected:7,autoCount:8,manualCount:1018,avgSeconds:445.702729,durationSampleCount:1026,durationTotalSeconds:457291,durationBasis:'created_to_operated',...more});
test('WG processing average and previous comparison are visible with their actual time basis',()=>{
 const current=row({previous:row({avgSeconds:500})}),f=setup({rows:[current],total:1,totals:current});f.page.render();
 const t=f.tables.find(t=>t.headers.some(h=>h.includes('平均处理用时')));assert(t);
 assert.match(t.rows[0][10],/7分26秒/);assert.match(t.rows[0][10],/创建至操作处理的用时，不是支付到账时长/);assert.match(t.rows[0][10],/1026 笔 \/ 1026 笔/);
 assert.match(t.rows[0][11],/8分20秒/);assert.match(t.rows[0][12],/54.30.*10.86%/);
 assert(t.headers.some(h=>h.includes("withdrawSort('avgSeconds')")));
});
test('page footer weights processing averages by valid time samples rather than all orders',()=>{
 const rows=[row({total:1000,avgSeconds:60,durationSampleCount:1,durationTotalSeconds:60}),row({platform:'26BET',total:3,avgSeconds:120,durationSampleCount:3,durationTotalSeconds:360})],f=setup({rows,total:21,totals:{}});f.page.render();
 const t=f.tables.find(t=>t.footers?.length===2);assert(t);assert.match(t.footers[0][10],/1分45秒/);assert.match(t.footers[0][10],/4 笔 \/ 1003 笔/);assert.match(t.footers[0][10],/部分时间样本/);
});
test('absent time samples remain unknown without a fabricated zero duration or comparison',()=>{
 const current=row({avgSeconds:null,durationSampleCount:0,durationTotalSeconds:null,previous:row()}),f=setup({rows:[current],total:1,totals:current});f.page.render();
 const t=f.tables.find(t=>t.headers.some(h=>h.includes('平均处理用时')));assert.equal(t.rows[0][10],'—');assert.equal(t.rows[0][12],'—');
});
test('AR historical rates compare observed counts while different duration bases stay explicitly incomparable',()=>{
 const previous=row({total:200,autoCount:120,manualCount:80,avgSeconds:1567.860932,durationBasis:'source_reported_processing'});
 const current=row({source:'AR',total:100,autoCount:40,manualCount:50,unclassifiedCount:10,avgSeconds:3351,durationBasis:'applied_to_completed',comparisonComparable:false,previous});
 const f=setup({rows:[current],total:1,totals:current,comparison:{complete:false},arCoverage:{coverageBasis:'unverified_source_continuity',currentComplete:false,previousComplete:false}}),html=f.page.render();
 const t=f.tables.find(t=>t.headers.some(h=>h.includes('昨日处理用时')));
 assert.match(t.rows[0][1],/未分类 10 笔/);assert.match(t.rows[0][11],/26分8秒/);assert.match(t.rows[0][11],/原日报提供的处理用时/);
 assert.match(t.rows[0][8],/昨日 60\.00%/);assert.match(t.rows[0][9],/昨日 40\.00%/);
 assert.match(t.rows[0][8],/-20\.00 pp/);assert.match(t.rows[0][9],/\+10\.00 pp/);
 for(const i of [8,9])assert.match(t.rows[0][i],/title="按已入库数据计算；两期完整性尚未核验"/);
 assert.doesNotMatch(t.rows[0][12],/withdraw-delta| pp/);assert.doesNotMatch(t.rows[0].join(''),/AR 两期完整性/);
 assert.match(t.rows[0][12],/口径不同.*口径不同|不计算涨跌.*口径不同/);assert.equal((html.match(/AR 两期完整性尚未核验，汇总暂不比较/g)||[]).length,1);
 assert.equal(current.previous,previous);assert.equal(current.total,100);
});
test('different duration bases independently suppress misleading time deltas',()=>{
 const current=row({durationBasis:'applied_to_completed',previous:row({avgSeconds:100,durationBasis:'source_reported_processing'})});
 const f=setup({rows:[current],total:1,totals:current});f.page.render();
 const t=f.tables.find(t=>t.headers.some(h=>h.includes('昨日处理用时')));
 assert.match(t.rows[0][11],/1分40秒/);assert.doesNotMatch(t.rows[0][12],/withdraw-delta/);
});
test('summary rows do not mislabel existing platform history as absent',()=>{
 const current=row({previous:row({total:2000})});
 const f=setup({rows:[current],total:21,totals:row(),previousTotals:row({total:2000}),comparison:{complete:false}});f.page.render();
 const t=f.tables.find(t=>t.footers?.length===2);
 assert.match(t.rows[0].join(''),/昨日/);
 for(const footer of t.footers){assert.doesNotMatch(footer.join(''),/对比日期暂无数据|昨日|withdraw-delta/);assert.match(footer[4],/97\.08%/);}
});


test('observed share comparisons preserve real zero and reject absent, nonnumeric or impossible counts and denominators',()=>{
 const prior=row({total:200,autoCount:50,manualCount:150});
 for(const current of [row({total:100,autoCount:null,previous:prior}),row({total:100,autoCount:undefined,previous:prior}),row({total:100,autoCount:-1,previous:prior}),row({total:100,autoCount:101,previous:prior}),row({total:0,autoCount:0,previous:prior}),row({total:null,autoCount:0,previous:prior}),row({total:' ',autoCount:0,previous:prior}),row({total:true,autoCount:0,previous:prior}),row({total:100,autoCount:[],previous:prior}),row({total:100,autoCount:0,previous:row({total:0,autoCount:0})}),row({total:100,autoCount:0,previous:row({total:100,autoCount:null})})]){
  const f=setup({rows:[current],total:1,totals:current});f.page.render();const cell=f.tables[0].rows[0][8];assert.doesNotMatch(cell,/ pp|withdraw-delta|NaN|Infinity/);
 }
 const current=row({total:100,autoCount:0,comparisonComparable:false,previous:row({total:100,autoCount:0})}),f=setup({rows:[current],total:1,totals:current});f.page.render();
 assert.match(f.tables[0].rows[0][8],/昨日 0\.00%.*0\.00 pp/);assert.match(f.tables[0].rows[0][8],/两期完整性尚未核验/);
});

test('previous unverified flag labels observed shares without changing counts or suppressing valid arithmetic',()=>{
 const previous=row({total:200,autoCount:80,manualCount:100,unclassifiedCount:20,comparisonComparable:false}),current=row({total:100,autoCount:50,manualCount:40,unclassifiedCount:10,previous}),f=setup({rows:[current],total:1,totals:current});
 f.page.render();const cells=f.tables[0].rows[0];assert.match(cells[8],/\+10\.00 pp/);assert.match(cells[9],/-10\.00 pp/);assert.match(cells[8],/两期完整性尚未核验/);assert.match(cells[12],/0\.00 秒（持平|0\.00%）/);assert.match(cells[12],/已观察用时差/);assert.equal(current.previous,previous);assert.equal(current.unclassifiedCount,10);
});
test('same explicit AR processing basis restores an observed duration change despite unrelated coverage gates',()=>{
 const previous=row({avgSeconds:1568,durationBasis:'applied_to_completed'}),current=row({source:'AR',avgSeconds:3539,durationBasis:'applied_to_completed',comparisonComparable:false,previous}),before=structuredClone(current),f=setup({rows:[current],total:1,totals:current,comparison:{complete:false},arCoverage:{coverageBasis:'unverified_source_continuity',currentComplete:false,previousComplete:false}});f.page.render();const cells=f.tables[0].rows[0];assert.match(cells[10],/58分59秒/);assert.match(cells[11],/26分8秒/);assert.match(cells[12],/\+1971\.00 秒（\+125\.70%）/);assert.match(cells[12],/已观察用时差.*两期完整性尚未核验/);assert.deepEqual(current,before);
});
test('observed processing changes preserve zero, reject malformed values and never calculate across different bases',()=>{
 for(const current of [row({avgSeconds:null}),row({avgSeconds:''}),row({avgSeconds:' '}),row({avgSeconds:true}),row({avgSeconds:[]}),row({avgSeconds:-1}),row({avgSeconds:'Infinity'})]){current.previous=row();const f=setup({rows:[current],total:1,totals:current});f.page.render();assert.equal(f.tables[0].rows[0][12],'—');}
 const current=row({avgSeconds:0,comparisonComparable:false,previous:row({avgSeconds:0})}),f=setup({rows:[current],total:1,totals:current});f.page.render();assert.match(f.tables[0].rows[0][12],/0\.00 秒（持平）/);assert.doesNotMatch(f.tables[0].rows[0][12],/NaN|Infinity/);
 const unknown=row({durationBasis:null,previous:row()}),u=setup({rows:[unknown],total:1,totals:unknown});u.page.render();assert.match(u.tables[0].rows[0][12],/口径不同/);assert.doesNotMatch(u.tables[0].rows[0][12],/withdraw-delta/);
});
test('NEWAR retains a real historical report mean with its source while missing current completion time stays unknown',()=>{
 const previous=row({source:'NEWAR',total:20000,avgSeconds:'972.0450335533248295',durationBasis:'source_reported_processing',durationSource:'historical_source_report',durationSampleCount:18031,durationTotalSeconds:17526944}),current=row({source:'NEWAR',avgSeconds:null,durationBasis:'source_submitted_to_handled',durationSampleCount:0,durationTotalSeconds:null,previous}),before=structuredClone(current),f=setup({rows:[current],total:1,totals:current});f.page.render();const cells=f.tables[0].rows[0];
 assert.match(cells[10],/缺少有效处理完成时间，暂不能计算/);assert.match(cells[11],/16分12秒/);assert.match(cells[11],/源日报用时/);assert.match(cells[11],/日报有效时间样本 18031 笔/);assert.match(cells[11],/不与订单笔数换算覆盖率/);assert.doesNotMatch(cells[11],/18031 笔 \/ 20000|部分时间样本/);assert.equal(cells[12],'—');assert.deepEqual(current,before);
});
test('NEWAR creation-to-third-party submission times compare only explicit matching bases without claiming payment completion',()=>{
 for(const view of ['auto_withdraw','withdraw_operators']){
  const previous=row({source:'NEWAR',avgSeconds:90,durationBasis:'created_to_submitted',durationSource:'native_created_to_submitted',durationSampleCount:2,durationTotalSeconds:180}),current=row({source:'NEWAR',total:100,processed:100,avgSeconds:60,durationBasis:'created_to_submitted',durationSource:'native_created_to_submitted',durationSampleCount:2,durationTotalSeconds:120,comparisonComparable:false,previous}),before=structuredClone(current),f=setup({rows:[current],total:1,totals:current},view);f.page.render();
  const t=f.tables[0],i=t.headers.findIndex(h=>h.includes('平均处理用时'));
  assert.match(t.rows[0][i],/1分0秒/);assert.match(t.rows[0][i],/创建至提交三方的用时，不代表支付到账/);assert.match(t.rows[0][i],/有效时间样本 2 笔 \/ 100 笔/);assert.match(t.rows[0][i],/部分时间样本/);
  assert.match(t.rows[0][i+1],/1分30秒/);assert.match(t.rows[0][i+1],/创建至提交三方/);assert.match(t.rows[0][i+2],/−30\.00 秒（-33\.33%）/);assert.match(t.rows[0][i+2],/已观察用时差.*完整性尚未核验/);
  assert.doesNotMatch(t.rows[0][i],/创建至源订单完成|源提交至处理完成|源日报用时/);assert.deepEqual(current,before);
 }
});
test('creation-to-submission duration preserves absent samples and cannot compare with another or unspecified time basis',()=>{
 const native={source:'NEWAR',durationBasis:'created_to_submitted',durationSource:'native_created_to_submitted'};
 for(const priorBasis of ['source_reported_processing','source_submitted_to_handled',null,'unknown']){
  const current=row({...native,avgSeconds:60,previous:row({avgSeconds:90,durationBasis:priorBasis})}),f=setup({rows:[current],total:1,totals:current});f.page.render();const cells=f.tables[0].rows[0];assert.match(cells[12],/口径不同/);assert.doesNotMatch(cells[12],/withdraw-delta|%/);
 }
 for(const avgSeconds of [null,'',-1,'Infinity']){
  const current=row({...native,avgSeconds,durationSampleCount:0,durationTotalSeconds:null,previous:row({...native,avgSeconds:90})}),f=setup({rows:[current],total:1,totals:current});f.page.render();const cells=f.tables[0].rows[0];assert.match(cells[10],/缺少有效创建或提交三方时间，暂不能计算/);assert.doesNotMatch(cells[10],/0秒|处理完成时间/);assert.equal(cells[12],'—');
 }
 const current=row({...native,avgSeconds:0,previous:row({...native,avgSeconds:0})}),f=setup({rows:[current],total:1,totals:current});f.page.render();assert.match(f.tables[0].rows[0][12],/0\.00 秒（持平）/);assert.doesNotMatch(f.tables[0].rows[0][12],/NaN|Infinity/);
});
