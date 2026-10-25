// Synthetic 9K aggregate DTOs. Raw status/epoch eligibility is validated by the
// database projection tests; this UI never derives a completion from row totals.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const copy=value=>JSON.parse(JSON.stringify(value));
const P={id:'77777777-7777-4777-8777-777777777777',name:'9KCLUB',sourceName:'9KCLUB',source:'NEWAR',country:'印度',identityCountry:'印度',team:'M8',timezone:'Asia/Kolkata',currency:'INR'};
const row=(more={})=>({country:'印度',platform:'9KCLUB',source:'NEWAR',statisticBasis:'created_at_current_status',total:100,processed:100,success:80,rejected:15,autoCount:0,manualCount:100,unclassifiedCount:0,avgSeconds:120,durationSampleCount:95,durationTotalSeconds:11400,durationBasis:'source_submitted_to_handled',comparisonComparable:false,...more});
function fixture(data,view='auto_withdraw',platform=P){
 const root={HensemLiveFilters:{multi:()=>''},AbortController,setTimeout,clearTimeout},tables=[],calls=[];root.window=root;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8'),root);
 const L={catalogReady:true,catalog:[copy(platform)],country:platform.country,team:'M8',multi:{team:['M8']},from:'2026-10-24T00:00:00',to:'2026-10-24T23:59:59',successFrom:'',successTo:''};
 const payload={startDate:'2026-10-24',endDate:'2026-10-24',previousStartDate:'2026-10-23',previousEndDate:'2026-10-23',prepared:{status:'ready',freshness:'fresh',calculationComplete:true,computedAt:'2026-10-25T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',sourceComplete:false},sourceComplete:false,comparison:{complete:false},notes:[],...data};
 const page=root.HensemLiveWithdrawPages.create({L,page:()=>view,E:v=>String(v??'').replaceAll('"','&quot;'),C:String,N:String,R:(a,b)=>(a/b*100).toFixed(2)+'%',box:(_title,body)=>body,table:(headers,rows,cls,footers)=>{tables.push({headers,rows,footers});return '';},render(){},request:async q=>{calls.push(q);return copy(payload)}});
 page.state.data=copy(payload);return {page,root,L,tables,calls,payload,draw(){tables.length=0;const html=page.render();const table=tables.find(t=>t.headers.some(h=>h.includes('平均处理用时'))),i=table.headers.findIndex(h=>h.includes('平均处理用时'));return {html,table,i,cells:table.rows[0]}}};
}
for(const view of ['auto_withdraw','withdraw_operators'])test(view+': 9K confirmed final processing clock explains both periods and retains the existing observed delta',()=>{
 const current=row({previous:row({avgSeconds:180,durationTotalSeconds:17100})}),f=fixture({rows:[current],total:1,totals:current},view),before=copy(f.page.state.data),{cells,i}=f.draw();
 assert.match(cells[i],/2分0秒/);assert.match(cells[i+1],/3分0秒/);for(const cell of [cells[i],cells[i+1]]){assert.match(cell,/源提交至处理完成/);assert.match(cell,/优先取源处理时间/);assert.match(cell,/最终状态的源后台最后更新时间/);assert.match(cell,/处理中订单不据此计算/);assert.match(cell,/不代表银行到账/);assert.doesNotMatch(cell,/创建至提交三方|创建至源订单完成|源日报用时/);}
 assert.match(cells[i],/有效时间样本 95 笔 \/ 100 笔/);assert.match(cells[i],/部分时间样本/);assert.match(cells[i+2],/−60\.00 秒（-33\.33%）/);assert.match(cells[i+2],/已观察用时差.*完整性尚未核验/);assert.deepEqual(copy(f.page.state.data),before);assert.equal(f.calls.length,0);
});

test('previous compact DTO inherits only its same native parent identity for the explanation',()=>{
 const previous={avgSeconds:180,durationSampleCount:95,durationTotalSeconds:17100,durationBasis:'source_submitted_to_handled'},current=row({previous}),f=fixture({rows:[current],total:1,totals:current}),{cells,i}=f.draw();assert.match(cells[i+1],/最终状态的源后台最后更新时间/);assert.match(cells[i+2],/−60\.00 秒/);assert.deepEqual(copy(f.page.state.data.rows[0].previous),previous);
});
for(const more of [{source:'AR'},{country:'巴基斯坦'},{platform:'MAANWIN'}])test('explicit previous identity conflict '+JSON.stringify(more)+' does not borrow 9K completion explanation or delta',()=>{
 const current=row({previous:row({...more,avgSeconds:180})}),f=fixture({rows:[current],total:1,totals:current}),{cells,i}=f.draw();assert.doesNotMatch(cells[i+1],/最终状态的源后台最后更新时间/);assert.doesNotMatch(cells[i+2],/withdraw-delta/);
});
for(const p of [{...P,sourceName:'DIFFERENT_NATIVE'},{...P,sourceName:undefined},{...P,source:'AR'},{...P,country:'巴基斯坦',identityCountry:'巴基斯坦'}])test('9K display label alone cannot grant completion interpretation '+JSON.stringify([p.source,p.country,p.sourceName]),()=>{
 const current=row({previous:row()}),f=fixture({rows:[current],total:1,totals:current},'auto_withdraw',p),{cells,i}=f.draw();assert.doesNotMatch(cells[i],/最终状态的源后台最后更新时间/);assert.doesNotMatch(cells[i+1],/最终状态的源后台最后更新时间/);
});

test('pending-only and unobserved windows retain unknown duration without deriving a zero or completion from order counts',()=>{
 for(const fields of [{total:5,success:0,rejected:0,manualCount:5},{total:null,success:null,rejected:null,manualCount:null,coveredDays:0,expectedDays:1,complete:false}]){
  const current=row({...fields,avgSeconds:null,durationSampleCount:0,durationTotalSeconds:null,previous:row()}),f=fixture({rows:[current],total:1,totals:current}),{cells,i}=f.draw();assert.match(cells[i],/缺少有效提交或最终状态处理完成时间/);assert.match(cells[i],/处理中订单不据此计算/);assert.match(cells[i],/>—<\/span>/);assert.doesNotMatch(cells[i],/0秒/);assert.equal(cells[i+2],'—');assert.equal(f.page.state.data.rows[0].durationSampleCount,0);
 }
});
for(const basis of ['created_to_submitted','source_reported_processing',null,'unknown'])test('9K existing submitted-to-handled never compares a previous '+basis+' clock',()=>{
 const current=row({previous:row({durationBasis:basis,avgSeconds:180})}),f=fixture({rows:[current],total:1,totals:current}),{cells,i}=f.draw();assert.match(cells[i+2],/口径不同/);assert.doesNotMatch(cells[i+2],/withdraw-delta/);
});

test('confirmed native aliases remain exact and unrelated NEWAR platforms retain their prior clock wording',()=>{
 for(const name of ['MAANWIN','DHANIWIN']){const current=row({platform:name,durationBasis:'created_to_submitted',previous:row({platform:name,durationBasis:'created_to_submitted',avgSeconds:180})}),f=fixture({rows:[current],total:1,totals:current},'auto_withdraw',{...P,name,sourceName:name}),{cells,i}=f.draw();assert.match(cells[i],/创建至提交三方/);assert.doesNotMatch(cells[i],/最终状态的源后台最后更新时间/);assert.match(cells[i+2],/−60\.00 秒/);}
 const p={...P,source:'new_ar',sourceName:'9kclub'},current=row({previous:row()}),f=fixture({rows:[current],total:1,totals:current},'auto_withdraw',p);assert.match(f.draw().cells[f.draw().i],/最终状态的源后台最后更新时间/);
});

test('9K export carries applied processing explanation without relabelling success time or adding table columns',async()=>{
 const current=row({previous:row()}),f=fixture({rows:[current],total:1,totals:current});await f.page.load();assert.equal(f.page.state.error,'');assert.equal(f.page.canExport(),true);const meta=copy(f.page.exportMeta()),line=meta.find(r=>r[0]==='9KCLUB处理用时');assert(line);assert.match(line[1],/最终状态的源后台最后更新时间/);assert(meta.some(r=>r[0]==='说明'&&r[1].includes('源更新时间不代表成功发生时间')));assert.deepEqual(meta.find(r=>r[0]==='成功时间筛选'),['成功时间筛选','未填写；按创建订单当前状态统计']);const first=f.draw().table.headers.slice();f.L.successFrom='2026-10-23T00:00:00';f.L.successTo='2026-10-23T23:59:59';assert.equal(f.page.canExport(),false);assert.equal(f.page.exportMeta(),null);assert.deepEqual(f.draw().table.headers,first);assert.equal(f.calls.length,1);
});

test('unrelated source or merely edited 9K label adds no export processing note',async()=>{
 const current=row({platform:'MAANWIN',durationBasis:'created_to_submitted',previous:row({platform:'MAANWIN',durationBasis:'created_to_submitted'})}),f=fixture({rows:[current],total:1,totals:current},'auto_withdraw',{...P,name:'MAANWIN',sourceName:'MAANWIN'});await f.page.load();assert.equal(f.page.canExport(),true);assert(!f.page.exportMeta().some(r=>r[0]==='9KCLUB处理用时'));f.L.catalog[0].name='9KCLUB';assert.equal(f.page.exportMeta(),null);
});

test('daily rows retain the same completion explanation without introducing another displayed column',()=>{
 const current=row({dataDate:'2026-10-24',previous:row({dataDate:'2026-10-23',avgSeconds:180})}),f=fixture({rows:[current],total:1,totals:current});f.page.state.daily=true;const{cells,i,table}=f.draw();assert.equal(table.headers[0],'日期');assert.match(cells[i],/最终状态的源后台最后更新时间/);assert.match(cells[i+1],/最终状态的源后台最后更新时间/);assert.match(cells[i+2],/−60\.00 秒/);assert.equal(table.headers.filter(h=>h.includes('平均处理用时')).length,1);
});

test('duration change sorting uses the unchanged numeric ratios, keeps missing clocks last and makes no extra reads',async()=>{
 const nine=row({previous:row({avgSeconds:180})}),maan=row({platform:'MAANWIN',avgSeconds:120,durationBasis:'created_to_submitted',previous:row({platform:'MAANWIN',durationBasis:'created_to_submitted',avgSeconds:60})}),unknown=row({platform:'OTHER',avgSeconds:null,durationSampleCount:0,previous:row({platform:'OTHER',avgSeconds:null,durationSampleCount:0})}),f=fixture({rows:[nine,maan,unknown],total:3,totals:row()});f.L.catalog.push({...P,id:'88888888-8888-4888-8888-888888888888',name:'MAANWIN',sourceName:'MAANWIN'},{...P,id:'99999999-9999-4999-8999-999999999999',name:'OTHER',sourceName:'OTHER'});f.root.document={querySelector:()=>null};await f.page.load();assert.equal(f.page.state.error,'');assert.equal(f.page.state.localSnapshot,true);f.root.withdrawSort('durationChange');let rows=f.draw().table.rows;assert.match(rows[0][0],/MAANWIN/);assert.match(rows[1][0],/9KCLUB/);assert.match(rows[2][0],/OTHER/);f.root.withdrawSort('durationChange');rows=f.draw().table.rows;assert.match(rows[0][0],/9KCLUB/);assert.match(rows[1][0],/MAANWIN/);assert.match(rows[2][0],/OTHER/);assert.equal(f.calls.length,1);
});
