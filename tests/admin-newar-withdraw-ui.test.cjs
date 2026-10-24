const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=(platform='MAANWIN',date='2026-10-09',complete=true)=>({country:'印度',platform,date,complete});
const row={country:'印度',platform:'MAANWIN',total:10,success:5,rejected:2,autoCount:3,manualCount:4,unclassifiedCount:3,avgSeconds:15,durationSampleCount:4,durationTotalSeconds:60,durationBasis:'created_to_operated'};
function fixture(extra={},operators=false){
 const tables=[],root={Date,Intl,HensemLiveFilters:{multi:()=>''},document:{getElementById:()=>null,querySelector:()=>null}};root.window=root;vm.runInNewContext(source,root);
 const L={catalogReady:true,catalog:[{id:'newar',country:'印度',name:'MAANWIN',source:'new_ar',timezone:'Asia/Kolkata'}],country:'印度',from:'2026-10-09',to:'2026-10-09'};
 const page=root.HensemLiveWithdrawPages.create({L,page:()=>operators?'withdraw_operators':'auto_withdraw',E,C:v=>v===null?'—':Number(v||0).toLocaleString('en-US'),N:String,R:(n,d)=>d?(100*n/d).toFixed(2)+'%':'—',box:(_title,body)=>body,table:(headers,rows,cls,footers)=>{tables.push({headers,rows:Array.from(rows,row=>Array.from(row)),cls,footers:footers&&Array.from(footers,row=>Array.from(row))});return rows.flat().join('')},render:()=>{},request:async()=>({})});
 page.state.data={startDate:'2026-10-09',endDate:'2026-10-09',rows:[row],total:1,totals:row,...extra};
 return {page,render:()=>page.render(),table:()=>tables.findLast(t=>t.cls?.includes('withdraw-stat-table'))};
}
test('automatic NewAR report centralizes source status without changing current order statistics',()=>{
 const f=fixture({newarCoverage:{currentComplete:true,previousComplete:true,days:[day()]}}),html=f.render();
 assert.match(html,/data-withdraw-publication="subtotal"/);assert.doesNotMatch(html,/data-newar-coverage|<summary>数据说明/);const op=fixture({newarCoverage:{currentComplete:true,previousComplete:true,days:[day()]}},true).render();assert.match(op,/data-newar-coverage="complete"/);assert.match(op,/复用每 10 分钟入库明细/);assert.match(op,/按各平台当地创建日期统计/);assert.match(op,/不与旧日报重复累加/);
 assert.deepEqual(f.table().rows[0].slice(1,4).map(value=>value.split('<')[0]),['10','5','2']);assert.match(f.table().rows[0][1],/未分类 3 笔/);assert.deepEqual(f.table().rows[0].slice(6,8),['3','4']);assert.match(html,/未分处理方式 3 笔/);
});
test('partial, absent, duplicate and previous-only day lists cannot claim completion',()=>{
 for(const days of [[],[day('MAANWIN','2026-10-09',false)],[day(),day()],[day('MAANWIN','2026-10-08')]]){
  const f=fixture({newarCoverage:{currentComplete:true,previousComplete:false,days}},true),html=f.render();
  assert.match(html,/data-newar-coverage="partial"/);assert.match(html,/显示已入库部分，不能作为完整总计/);assert.match(html,/前期完整性未核验，对比仅代表已入库记录/);assert.doesNotMatch(html,/所选创建日已完整采集。/);assert.equal(f.page.state.data.newarCoverage.previousComplete,false);
 }
});
test('incomplete NewAR source coverage preserves observed same-platform deltas and explicit proof flags',()=>{
 const previous={...row,total:8,success:2,rejected:1,autoCount:2,manualCount:3,unclassifiedCount:3,complete:false},current={...row,complete:false,previous};
 const f=fixture({rows:[current],totals:current,previousTotals:previous,previousStartDate:'2026-10-08',previousEndDate:'2026-10-08',sourceComplete:false,comparison:{complete:false},newarCoverage:{currentComplete:false,previousComplete:false,days:[day('MAANWIN','2026-10-09',false)]}}),before=JSON.stringify(f.page.state.data),html=f.render();
 assert.match(f.table().rows[0][4],/50\.00%.*昨日 25\.00%.*\+25\.00 pp/);assert.match(f.table().rows[0][8],/30\.00%.*昨日 25\.00%.*\+5\.00 pp/);
 assert.match(html,/data-withdraw-publication="subtotal"/);assert.match(html,/数值与涨跌按同平台、同口径的已入库记录计算，不代表全天完整数据/);assert.doesNotMatch(html,/data-newar-coverage|<summary>数据说明/);assert.doesNotMatch(html,/所选创建日已完整采集/);assert.equal(JSON.stringify(f.page.state.data),before);
});
test('every platform must cover all selected creation dates',()=>{
 const days=[day('MAANWIN','2026-10-08'),day(),day('DhaniWin')];
 const partial=fixture({startDate:'2026-10-08',newarCoverage:{currentComplete:true,previousComplete:true,days}},true).render();assert.match(partial,/data-newar-coverage="partial"/);
 const complete=fixture({startDate:'2026-10-08',newarCoverage:{currentComplete:true,previousComplete:true,days:[...days,day('DhaniWin','2026-10-08')]}},true).render();assert.match(complete,/data-newar-coverage="complete"/);
});
test('operator counts remain independent outcomes and state current operator attribution',()=>{
 const r={...row,account:'SYNTHETIC',processed:10,success:5,rejected:2},f=fixture({rows:[r],totals:r,newarCoverage:{currentComplete:false,previousComplete:false,days:[day('MAANWIN','2026-10-09',false)]}},true),html=f.render();
 assert.deepEqual(f.table().rows[0].slice(1,5),['SYNTHETIC','10','5','2']);assert.match(html,/当前操作人汇总，不代表历史操作次数/);assert.match(html,/4 笔 \/ 10 笔/);
});
test('no metadata leaves unrelated source rendering unchanged',()=>{
 assert.doesNotMatch(fixture().render(),/data-newar-coverage/);
});
test('coverage values are not interpolated into HTML',()=>{
 const html=fixture({newarCoverage:{currentComplete:true,days:[day('<img src=x onerror=alert(1)>')]}}).render();assert.doesNotMatch(html,/<img|onerror/);
});
