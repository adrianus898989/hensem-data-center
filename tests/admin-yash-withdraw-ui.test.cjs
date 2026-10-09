const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yash=(extra={})=>({country:'印度',platform:'YASH.BET',dataDate:'2026-10-08',total:100,success:80,rejected:5,autoCount:null,manualCount:null,unclassifiedCount:100,classificationAvailable:false,reasonAvailable:false,avgSeconds:60,durationSampleCount:80,durationTotalSeconds:4800,durationBasis:'created_to_completed',...extra});
function fixture(data,operators=false){
 const tables=[],requests=[],root={Date,Intl,HensemLiveFilters:{multi:()=>''},document:{getElementById:()=>null,querySelector:()=>null}};root.window=root;
 vm.runInNewContext(source,root);
 const L={catalogReady:true,catalog:[{id:'yash',country:'印度',name:'YASH.BET',source:'kb',timezone:'Asia/Kolkata'}],country:'印度',from:'2026-10-08',to:'2026-10-08'};
 const page=root.HensemLiveWithdrawPages.create({L,page:()=>operators?'withdraw_operators':'auto_withdraw',E,C:v=>v===null?'—':Number(v||0).toLocaleString('en-US'),N:String,R:(n,d)=>d?(100*n/d).toFixed(2)+'%':'—',box:(_title,body)=>body,table:(headers,rows,cls,footers)=>{tables.push({headers,rows:Array.from(rows,row=>Array.from(row)),cls,footers:footers&&Array.from(footers,row=>Array.from(row))});return rows.flat().join('')},render:()=>{},request:async q=>{requests.push(q);return {available:false,rows:[]}}});
 page.state.data={startDate:'2026-10-08',endDate:'2026-10-08',rows:[yash()],total:1,totals:yash(),...data};
 return {root,page,L,tables,requests,render:()=>page.render(),stats:()=>tables.findLast(t=>t.cls?.includes('withdraw-stat-table'))};
}
test('YASH shows real withdrawal counts while missing classification remains unknown in rows and KPI totals',()=>{
 const f=fixture(),html=f.render(),row=f.stats().rows[0];
 assert.deepEqual(row.slice(1,4),['100','80','5']);assert.match(row[4],/^80.00%/);assert.match(row[5],/^5.00%/);
 assert.deepEqual(row.slice(6,8),['—','—']);assert.match(row[8],/^—/);assert.match(row[9],/^—/);
 assert.match(html,/<label>自动出款<\/label><strong>—<\/strong>/);assert.match(html,/<label>人工处理<\/label><strong>—<\/strong>/);
 assert.match(html,/未分处理方式 100 笔 · 100.00%/);assert.match(html,/未分类订单不推定为人工/);
});
test('mixed page and grand totals keep unknown classification rather than zero or a partial-source ratio',()=>{
 const ar=yash({platform:'AR-SYNTHETIC',total:40,success:30,rejected:10,classificationAvailable:true,reasonAvailable:true,autoCount:10,manualCount:30});
 const totals=yash({total:140,success:110,rejected:15}),f=fixture({rows:[yash(),ar],total:21,totals});f.render();const t=f.stats();
 assert.equal(t.rows[1][6],'10');assert.match(t.rows[1][8],/^<span class="red">25.00%/);
 for(const row of t.footers){assert.deepEqual(row.slice(1,4),['140','110','15']);assert.deepEqual(row.slice(6,8),['—','—']);assert.match(row[8],/^—/);assert.doesNotMatch(row[8],/7.14%|0.00%/);}
});
test('classification capability overrides numeric placeholders, including previous-period comparison',()=>{
 const current=yash({autoCount:0,manualCount:100,previous:yash({autoCount:1,manualCount:99})}),f=fixture({rows:[current],totals:current,previousTotals:current.previous});
 const html=f.render(),row=f.stats().rows[0];assert.deepEqual(row.slice(6,8),['—','—']);assert.match(row[8],/^—.*对比值未提供/);assert.doesNotMatch(row[8],/1.00%|pp/);assert.match(html,/<label>自动出款<\/label><strong>—<\/strong>/);
});
test('missing values stay unknown in page sums while a genuinely classified zero stays zero',()=>{
 const unknown=yash({classificationAvailable:undefined,autoCount:undefined,manualCount:null}),known=yash({platform:'KNOWN',classificationAvailable:true,autoCount:0,manualCount:100}),f=fixture({rows:[unknown,known],total:21});f.render();
 const t=f.stats();assert.deepEqual(t.rows[0].slice(6,8),['—','—']);assert.equal(t.rows[1][6],'0');assert.match(t.rows[1][8],/0.00%/);assert.deepEqual(t.footers[0].slice(6,8),['—','—']);
});
test('unavailable YASH reasons are explained beside a working daily entry without issuing a reason request',()=>{
 const f=fixture();f.render();const actions=f.stats().rows[0].at(-1);
 assert.match(actions,/当前采集数据未提供自动／人工标识及原因/);assert.match(actions,/当前采集未提供原因/);assert.match(actions,/withdrawDaily\(0\)/);assert.doesNotMatch(actions,/withdrawReasons/);
 f.root.withdrawReasons(0);f.root.withdrawReasons(0,'rejection');assert.equal(f.requests.length,0);assert.equal(f.page.state.reason,null);
});
test('an unavailable reason response does not inherit AR manual or system classification claims',()=>{
 const f=fixture();f.page.state.reason={country:'印度',platform:'YASH.BET',date:'2026-10-08',kind:'blocking'};f.page.state.reasonData={available:false,reasonAvailable:false,message:'源未提供原因'};
 const html=f.render();assert.match(html,/不能推定为无原因/);assert.doesNotMatch(html,/排除 system|人工操作均计入|当前条件下没有人工拦截订单/);
});
test('YASH coverage reports complete creation days and formats latest collection in India time',()=>{
 const f=fixture({yashCoverage:{days:[{date:'2026-10-08',complete:true,total:100}],currentComplete:true,previousComplete:true,latestCollectedAt:'2026-10-09T00:00:00Z'}}),html=f.render();
 assert.match(html,/data-yash-coverage="complete"/);assert.match(html,/所选创建日已完整采集/);assert.match(html,/5:30:00（印度时间）/);assert.match(html,/按印度当地创建日期统计/);
});
test('partial, missing and duplicate coverage days never claim a complete total',()=>{
 for(const days of [[],[{date:'2026-10-08',complete:false}],[{date:'2026-10-07',complete:true}],[{date:'2026-10-08',complete:true},{date:'2026-10-08',complete:true}]]){
  const f=fixture({yashCoverage:{days,currentComplete:true,previousComplete:false,latestCollectedAt:null}}),html=f.render();assert.match(html,/data-yash-coverage="partial"/);assert.match(html,/不能作为完整总计/);assert.match(html,/前期覆盖不完整/);assert.match(html,/最新采集：尚未取得/);assert.doesNotMatch(html,/所选创建日已完整采集/);
 }
});
test('YASH processing duration uses valid completion samples and does not claim bank arrival',()=>{
 const rows=[yash({durationSampleCount:1,durationTotalSeconds:60}),yash({platform:'YASH-SYNTHETIC',avgSeconds:120,durationSampleCount:3,durationTotalSeconds:360})],f=fixture({rows,total:21});f.render();const t=f.stats();
 assert.match(t.rows[0][10],/创建至源订单完成的处理用时，不代表银行到账时长/);assert.match(t.rows[0][10],/1 笔 \/ 100 笔/);assert.match(t.footers[0][10],/1分45秒/);assert.match(t.footers[0][10],/4 笔 \/ 200 笔/);
});
test('operator rows retain actual supplied outcomes and identify the current operator basis',()=>{
 const r=yash({account:'SYNTHETIC',processed:100,success:80,rejected:5}),f=fixture({rows:[r],totals:r,yashCoverage:{days:[{date:'2026-10-08',complete:true}],currentComplete:true}},true),html=f.render();
 assert.deepEqual(f.stats().rows[0].slice(1,5),['SYNTHETIC','100','80','5']);assert.match(html,/当前操作人汇总，不代表历史操作次数/);assert.doesNotMatch(html,/data-withdraw-classification="unavailable"/);
});
