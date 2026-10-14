const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
const row=(platform,extra={})=>({platform,country:'印度',total:100,success:60,rejected:10,autoCount:50,manualCount:50,avgSeconds:60,durationBasis:'applied_to_completed',durationSampleCount:100,durationTotalSeconds:6000,previous:{avgSeconds:30,durationBasis:'applied_to_completed'},...extra});
function fixture(rows,options={}){
 let view=options.view||'auto_withdraw',handler=options.handler,node={scrollLeft:320,scrollTop:0};const calls=[],scrolls=[],tables=[];
 const context={HensemLiveFilters:{multi:()=>''},Date,Intl,scrollX:8,scrollY:650,scrollTo:(x,y)=>{context.scrollX=x;context.scrollY=y;scrolls.push([x,y]);},document:{querySelector:s=>s==='.withdraw-stat-table'?node:null,getElementById:()=>null,querySelectorAll:()=>[]}};context.window=context;vm.createContext(context);vm.runInContext(source,context);
 const L={catalogReady:true,country:'印度',team:'M8',multi:{team:['M8']},from:'2026-10-11T00:00:00',to:'2026-10-11T23:59:59',catalog:rows.map((r,i)=>({id:'p-'+i,name:r.platform,country:r.country,team:'M8',source:'ar',timezone:'Asia/Kolkata'}))};let page,html='';
 const response=q=>({total:rows.length,offset:q.offset,limit:q.limit,rows:rows.slice(q.offset,q.offset+q.limit),notes:[],canWriteNotes:true,totals:{total:1000,success:600,rejected:100,autoCount:500,manualCount:500,platforms:rows.length},comparison:{complete:true},startDate:'2026-10-11',endDate:'2026-10-11'});
 page=context.HensemLiveWithdrawPages.create({L,E,C:String,N:String,R:(n,d)=>d?String(n/d*100)+'%':'—',box:(_,body)=>body,table:(headers,items,classes,footer)=>{if(classes?.includes('withdraw-stat-table'))tables.push(items);return '<div class="'+classes+'"><table><tbody>'+items.map(cells=>'<tr>'+cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';},render:()=>{html=page.render();if(options.resetScroll){context.scrollX=context.scrollY=0;node={scrollLeft:0,scrollTop:0};}},page:()=>view,request:async q=>{calls.push(copy(q));return handler?handler(q):q.action==='autoWithdraw'?response(q):q.action==='withdrawReasons'?{available:false}:q.action==='withdrawNote'?{...q,version:'saved'}:{}}});
 return {L,page,c:context,calls,tables,scrolls,rows:()=>tables.at(-1),names:()=>copy(tables.at(-1).map(cells=>cells[0].match(/<strong[^>]*>(.*?)<\/strong>/)?.[1])),html:()=>html,setHandler:value=>handler=value,setView:value=>view=value,node:()=>node};
}

test('18-platform sorting and page size reuse one complete snapshot without any extra business request',async()=>{
 const rows=Array.from({length:18},(_,i)=>row('P'+String(i).padStart(2,'0'),{total:i+1,success:18-i})),h=fixture(rows);await h.page.load();assert.equal(h.calls.length,1);assert.equal(h.calls[0].offset,0);assert.equal(h.calls[0].limit,500);assert.equal(h.page.state.localSnapshot,true);
 const original=h.page.state.data.rows;h.c.withdrawSort('success');assert.equal(h.names()[0],'P00');h.c.withdrawSort('success');assert.equal(h.names()[0],'P17');h.c.withdrawSize(50);h.c.withdrawPage(99);assert.equal(h.page.state.page,1);assert.equal(h.calls.length,1);assert.equal(h.page.state.data.rows,original,'snapshot row identity remains intact');
 for(const key of ['country','platform','account','total','processed','success','rejected','autoCount','manualCount','avgSeconds','successRate','rejectRate','autoRate','manualRate','previousAvgSeconds','durationChange'])h.c.withdrawSort(key);
 assert.equal(h.calls.length,1);assert.equal(h.page.state.data.totals.total,1000);
});

test('local page slices are sorted globally, nulls remain last in both directions and equal keys use native country/platform ties',async()=>{
 const rows=Array.from({length:45},(_,i)=>row('P'+String(i).padStart(2,'0'),{success:45-i})),h=fixture(rows);await h.page.load();h.c.withdrawSort('success');h.c.withdrawPage(2);assert.equal(h.names()[0],'P20');assert.equal(h.names().length,20);h.c.withdrawSize(30);assert.equal(h.page.state.page,1);assert.equal(h.names().length,30);h.c.withdrawPage(2);assert.equal(h.names().length,15);assert.equal(h.calls.length,1);
 const n=fixture([row('Z',{avgSeconds:null}),row('B',{avgSeconds:0}),row('A',{avgSeconds:0}),row('C',{avgSeconds:10})]);await n.page.load();n.c.withdrawSort('avgSeconds');assert.deepEqual(n.names(),['C','A','B','Z']);n.c.withdrawSort('avgSeconds');assert.deepEqual(n.names(),['A','B','C','Z']);assert.equal(n.calls.length,1);
});

test('duration-change sorting compares only equal explicit bases and preserves zero, unknown, finite and coverage-limited observations',async()=>{
 const h=fixture([row('increase',{avgSeconds:90,comparisonComparable:false}),row('flat-zero',{avgSeconds:0,previous:{avgSeconds:0,durationBasis:'applied_to_completed'}}),row('decrease',{avgSeconds:15}),row('different',{avgSeconds:999,previous:{avgSeconds:1,durationBasis:'source_reported_processing'}}),row('no-base',{durationBasis:null}),row('zero-den',{previous:{avgSeconds:0,durationBasis:'applied_to_completed'}}),row('not-finite',{avgSeconds:'NaN'})]);await h.page.load();h.c.withdrawSort('durationChange');assert.deepEqual(h.names(),['increase','flat-zero','decrease','different','no-base','not-finite','zero-den']);h.c.withdrawSort('durationChange');assert.deepEqual(h.names(),['decrease','flat-zero','increase','different','no-base','not-finite','zero-den']);assert.equal(h.calls.length,1);
});

test('exact numeric ratios and bigint count text are not rounded before sorting',async()=>{
 const h=fixture([row('small',{total:'9007199254740992',success:'9007199254740991'}),row('large',{total:'9007199254740993',success:'9007199254740992'}),row('unknown',{total:0,success:0})]);await h.page.load();h.c.withdrawSort('total');h.c.withdrawSort('total');assert.deepEqual(h.names(),['large','small','unknown']);h.c.withdrawSort('successRate');assert.deepEqual(h.names(),['large','small','unknown']);h.c.withdrawSort('successRate');assert.deepEqual(h.names(),['small','large','unknown']);assert.equal(h.calls.length,1);
});

test('sorted and paged reason/note/daily buttons keep their original platform snapshot index',async()=>{
 const rows=Array.from({length:25},(_,i)=>row('P'+String(i).padStart(2,'0'),{success:25-i})),h=fixture(rows);await h.page.load();h.c.withdrawSort('success');h.c.withdrawPage(2);const cells=h.rows()[0],action=cells.at(-1),note=cells.at(-2);assert.match(action,/withdrawReasons\(20,/);assert.match(action,/withdrawDaily\(20\)/);assert.match(note,/withdrawNoteOpen\(20\)/);
 h.c.withdrawReasons(20,'blocking');await flush();assert.equal(h.calls.at(-1).platform,'P20');assert.equal(h.calls.at(-1).action,'withdrawReasons');h.c.withdrawNoteOpen(20);assert.equal(h.page.state.note.platform,'P20');h.c.withdrawDaily(20);await flush();assert.equal(h.calls.at(-1).action,'autoWithdraw');assert.deepEqual(h.calls.at(-1).platforms,['P20']);assert.equal(h.calls.at(-1).daily,true);assert.equal(h.page.state.localSnapshot,false);
});

test('daily and operator modes keep server pagination; incomplete large lists are never treated as a full snapshot',async()=>{
 for(const mode of ['daily','operators']){const h=fixture(Array.from({length:60},(_,i)=>row('P'+i)),{view:mode==='operators'?'withdraw_operators':'auto_withdraw'});if(mode==='daily'){h.page.state.view='auto';h.page.state.daily=true;}await h.page.load();assert.equal(h.calls[0].limit,20);assert.equal(h.page.state.localSnapshot,false);h.c.withdrawSort('success');await flush();assert.equal(h.calls.length,2);h.c.withdrawPage(2);await flush();assert.equal(h.calls.at(-1).offset,20);}
 const rows=Array.from({length:501},(_,i)=>row('P'+i)),big=fixture(rows);big.L.team='all';big.L.multi.team=[];await big.page.load();assert.equal(big.page.state.localSnapshot,false);assert.equal(big.page.state.serverPaging,true);assert.equal(big.page.state.sort,'total');assert.equal(big.page.state.asc,false);assert.equal(big.names().length,20);big.c.withdrawPage(2);await flush();assert.equal(big.calls.at(-1).limit,20);assert.equal(big.calls.at(-1).offset,20);
 const partial=fixture([row('one'),row('two')],{handler:q=>({total:2,rows:[row('one')],totals:{total:2},notes:[]})});await partial.page.load();assert.equal(partial.page.state.localSnapshot,false);partial.c.withdrawSort('total');await flush();assert.equal(partial.calls.length,2);
});

test('sorting during an active initial read does not overlap it and late/cancelled or changed-scope results are not reused',async()=>{
 const wait=deferred(),h=fixture([row('A')],{handler:()=>wait.promise}),pending=h.page.load();h.c.withdrawSort('success');h.c.withdrawSize(50);assert.equal(h.calls.length,1);wait.resolve({total:1,rows:[row('A')],totals:{total:1},notes:[]});await pending;assert.equal(h.page.state.localSnapshot,true);assert.equal(h.page.state.size,50);assert.equal(h.calls.length,1);
 h.c.withdrawDate('from','2026-10-10');assert.equal(h.page.state.localSnapshot,true);h.c.withdrawSort('total');assert.equal(h.calls.length,1,'draft sorting reuses only the old applied snapshot');
 const late=deferred();h.setHandler(()=>late.promise);const read=h.page.load();h.page.cancel();late.resolve({total:1,rows:[row('OLD')],totals:{total:1},notes:[]});await read;assert.equal(h.page.state.data,null);
});

test('local sorting preserves the window viewport and table horizontal position through a real render replacement',async()=>{
 const h=fixture([row('A'),row('B')],{resetScroll:true});await h.page.load();h.c.scrollX=8;h.c.scrollY=650;h.node().scrollLeft=320;h.c.withdrawSort('success');assert.equal(h.c.scrollX,8);assert.equal(h.c.scrollY,650);assert.equal(h.node().scrollLeft,320);assert.equal(h.calls.length,1);
});

test('hidden classification values, invalid shares and negative durations stay unknown at the end',async()=>{
 const h=fixture([row('valid',{autoCount:20,avgSeconds:5,previous:{avgSeconds:8,durationBasis:'applied_to_completed'}}),row('partial',{autoCount:30,classificationAvailable:false,classificationPartial:true}),row('placeholder',{autoCount:99,classificationAvailable:false}),row('negative',{autoCount:-1,avgSeconds:-2,previous:{avgSeconds:-3,durationBasis:'applied_to_completed'}}),row('over',{autoCount:101})]);await h.page.load();h.c.withdrawSort('autoRate');assert.deepEqual(h.names(),['partial','valid','negative','over','placeholder']);h.c.withdrawSort('autoRate');assert.deepEqual(h.names(),['valid','partial','negative','over','placeholder']);h.c.withdrawSort('previousAvgSeconds');assert.equal(h.names().at(-1),'negative');h.c.withdrawSort('avgSeconds');assert.equal(h.names().at(-1),'negative');assert.equal(h.calls.length,1);
 for(const value of [null,'',true,undefined]){const empty=fixture([],{handler:()=>({total:value,rows:[],totals:{},notes:[]})});empty.L.catalog=[{name:'P',country:'印度',team:'M8',source:'ar'}];await empty.page.load();assert.equal(empty.page.state.localSnapshot,false);}
 const verified=fixture([],{handler:()=>({total:0,rows:[],totals:{total:0},notes:[]})});verified.L.catalog=[{name:'P',country:'印度',team:'M8',source:'ar'}];await verified.page.load();assert.equal(verified.page.state.localSnapshot,true);verified.c.withdrawSort('platform');assert.equal(verified.calls.length,1);
});

test('a partial large response resets to the actual server order and page after pending local controls',async()=>{
 const wait=deferred(),h=fixture([row('A'),row('B')],{handler:()=>wait.promise});const pending=h.page.load();h.c.withdrawSort('avgSeconds');h.c.withdrawPage(4);assert.equal(h.calls.length,1);wait.resolve({total:501,rows:[row('A'),row('B')],totals:{total:2},notes:[]});await pending;assert.equal(h.page.state.localSnapshot,false);assert.equal(h.page.state.serverPaging,true);assert.equal(h.page.state.sort,'total');assert.equal(h.page.state.asc,false);assert.equal(h.page.state.page,1);assert.equal(h.calls.length,1);
});
