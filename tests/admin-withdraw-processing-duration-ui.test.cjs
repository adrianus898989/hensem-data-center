const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(data){
 const root={HensemLiveFilters:{multi:()=>''}},tables=[];root.window=root;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8'),root);
 const p={id:'77777777-7777-4777-8777-777777777777',name:'POPMIU',sourceName:'POPMIU',source:'wg',country:'巴西',team:'M8',timezone:'America/Sao_Paulo'};
 const page=root.HensemLiveWithdrawPages.create({L:{catalogReady:true,catalog:[p],country:'巴西',from:'2026-10-06',to:'2026-10-06'},page:()=> 'auto_withdraw',E:v=>String(v??'').replaceAll('"','&quot;'),C:String,N:String,R:(a,b)=>(a/b*100).toFixed(2)+'%',box:(_title,body)=>body,table:(headers,rows,cls,footers)=>{tables.push({headers,rows,footers});return '';},render:()=>{},request:async()=>({})});
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
