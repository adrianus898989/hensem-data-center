// Native member dialog behavior; all rows/IDs and server responses are synthetic.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../admin-preview/live-submission-analysis.js');
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p={id:'synthetic-platform',name:'Synthetic Platform',source:'ar',currency:'INR',timezone:'Asia/Kolkata'};
const summary=q=>({platform:p,startAt:q.startAt,endAt:q.endAt,version:3,basis:'platform_local_day_all_providers_zero_success_whole_day_over_threshold',exemptCount:0,thresholdComparison:'gt',coverage:{orderCount:200,missingMemberCount:0,missingLevelCount:0},metrics:[10,15,20,30,50,100].map(threshold=>({provider:null,threshold,qualified_member_count:1,qualified_member_days:1,member_count:1,member_days:1,invalid_count:20,l0_members:1,new_members:1,funded_members:0,unknown_members:0}))});
const row=(id,day='2026-09-28')=>({day,member_id:id,member_level:'L0',member_class:'new',recharge_count:0,submitted_count:20,selected_count:20,invalid_count:20,platform_day_invalid_count:20,platform_day_amount:'0',platform_day_invalid_amount:'0',submitted_amount:'0',invalid_amount:'0',providers:['Pay A']});
const dataset=[row('0009007199254740993'),row('0009007199254740993','2026-09-27'),...Array.from({length:74},(_,i)=>row('ID-'+(i+1)))];
function memberReply(q,all=dataset){const matching=all.filter(x=>(!q.memberId||x.member_id===q.memberId)&&(q.level==='all'||q.level==='l0'||q.level===x.member_class));return {...summary(q),total:matching.length,members:new Set(matching.map(r=>r.member_id)).size,rows:matching.slice(q.offset,q.offset+q.limit)};}
async function fixture(){const calls=[],draws=[],tables=[],L={country:'印度',from:'2026-09-01',to:'2026-09-30',dirty:false};let handle=summary;
 const ui=create({L,E,C:String,N:String,selected:()=>[p],query:()=>({startAt:'2026-09-01T00:00:00Z',endAt:'2026-09-30T00:00:00Z',status:'all',providers:['Pay A','Pay B']}),request:(q,options)=>{calls.push({q,options});return Promise.resolve(handle(q));},render(){},box:(t,b)=>b,table:(heads,rows,classes)=>{tables.push({heads,rows,classes});return '<table>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</table>';},open:(title,body)=>draws.push({title,body})});
 await ui.load();handle=memberReply;await ui.members(0,null,15);
 return {ui,L,calls,draws,tables,set:fn=>handle=fn,latest:()=>calls.at(-1).q,body:()=>draws.at(-1).body};}
test('server pagination has exact global ID/day totals, page range, page sizes and valid jumps',async()=>{
 const h=await fixture();assert.match(h.body(),/共 75 个 ID · 76 个会员日 · 显示 1–50/);assert.match(h.body(),/第 1 \/ 2 页/);
 for(const size of [20,50,100])assert.match(h.body(),new RegExp('<option value="'+size+'"'));
 await global.liveSubmissionMemberSize('20');assert.equal(h.latest().limit,20);assert.equal(h.latest().offset,0);
 await global.liveSubmissionMemberJump('4');assert.equal(h.latest().offset,60);assert.match(h.body(),/显示 61–76/);assert.match(h.body(),/第 4 \/ 4 页/);assert.equal(h.tables.at(-1).rows.length,16);
 const count=h.calls.length;for(const value of ['0','5','1e2','2.5','-1','99999999','',null])await global.liveSubmissionMemberJump(value);await global.liveSubmissionMemberPage(1);assert.equal(h.calls.length,count);
 await global.liveSubmissionMemberSize('100');assert.equal(h.latest().offset,0);assert.equal(h.latest().limit,100);assert.equal(h.tables.at(-1).rows.length,76);assert.match(h.body(),/第 1 \/ 1 页/);
});
test('exact ID search is server-side over the entire scope and preserves large/leading-zero ID text',async()=>{
 const h=await fixture();await global.liveSubmissionMemberJump('2');const before=h.calls.length;
 const form={elements:{namedItem:name=>({value:name==='memberId'?' 0009007199254740993 ':''})}};
 await global.liveSubmissionMemberSearch(form);assert.equal(h.calls.length,before+1);assert.equal(h.latest().memberId,'0009007199254740993');assert.equal(h.latest().offset,0);
 assert.match(h.body(),/当前匹配 1 个 ID · 2 个会员日/);assert.match(h.body(),/完整匹配/);assert.equal(h.tables.at(-1).rows.length,2);
 for(const key of ['platformId','startAt','endAt','direction','currency','threshold','providers'])assert.deepEqual(h.latest()[key],h.calls[1].q[key]);
 await global.liveSubmissionMemberLevel('new');assert.equal(h.latest().memberId,'0009007199254740993');assert.equal(h.latest().level,'new');assert.equal(h.latest().offset,0);
 await global.liveSubmissionMemberSize('20');assert.equal(h.latest().memberId,'0009007199254740993');assert.equal(h.latest().level,'new');assert.equal(h.latest().limit,20);
 await global.liveSubmissionMemberClear();assert(!('memberId' in h.latest()));assert.equal(h.latest().level,'new');assert.equal(h.latest().limit,20);assert.equal(h.latest().offset,0);
});
test('query-only roles and invalid search/jump/page-size values cannot request detail or leak previous rows',async()=>{
 const h=await fixture(),count=h.calls.length;for(const id of ['x'.repeat(201),'bad\nID',{},null])await global.liveSubmissionMemberSearch(id);
 for(const size of ['30','500','50.0',null,{}])await global.liveSubmissionMemberSize(size);assert.equal(h.calls.length,count);
 global.hensemRoleAllowed=(_page,action)=>action!=='detail';try{await global.liveSubmissionMemberSearch('ID-1');await global.liveSubmissionMemberSize('20');await global.liveSubmissionMemberJump('2');await h.ui.members(0);assert.equal(h.calls.length,count);}finally{delete global.hensemRoleAllowed;}
});
test('missing matches and escaped IDs remain clear without inventing zero-valued source fields',async()=>{
 const h=await fixture();await global.liveSubmissionMemberSearch('NO-MATCH');assert.match(h.body(),/当前匹配 0 个 ID · 0 个会员日/);assert.match(h.body(),/当前条件没有匹配会员/);assert.match(h.body(),/第 1 \/ 1 页/);
 await global.liveSubmissionMemberClear();h.set(q=>memberReply(q,[row('<img src=x>')]));await global.liveSubmissionMemberSearch('<img src=x>');assert.match(h.body(),/&lt;img src=x&gt;/);assert.doesNotMatch(h.body(),/<img src=x>/);
 h.set(q=>({...summary(q),total:1,members:1,rows:[row('OTHER')]}));await global.liveSubmissionMemberSearch('EXPECTED');assert.match(h.body(),/响应范围无效/);
});
test('identical in-flight queries are deduplicated, replacing filters aborts old reads, and stale failures never repaint',async()=>{
 const h=await fixture();let resolve,reject;h.set(()=>new Promise((r,j)=>{resolve=r;reject=j}));
 const old=global.liveSubmissionMemberSearch('ID-1'),count=h.calls.length,signal=h.calls.at(-1).options.signal,duplicate=global.liveSubmissionMemberSearch('ID-1');assert.equal(h.calls.length,count);
 h.set(memberReply);await global.liveSubmissionMemberSearch('ID-2');assert.equal(signal.aborted,true);const paints=h.draws.length;
 reject(Error('stale failure'));await old;await duplicate;assert.equal(h.draws.length,paints);assert.equal(h.latest().memberId,'ID-2');
 for(const action of ['close','scope','dirty','permission'])for(const outcome of ['success','error']){let finish;h.set(q=>new Promise((r,j)=>finish=()=>outcome==='success'?r(memberReply(q)):j(Error('late error'))));const pending=global.liveSubmissionMemberSearch('ID-3'),current=h.calls.at(-1).options.signal;
  if(action==='close')global.liveSubmissionMembersClose();else if(action==='scope')h.ui.cancel();else if(action==='dirty')h.L.dirty=true;else global.hensemRoleAllowed=()=>false;
  const drawn=h.draws.length;finish();await pending;assert.equal(h.draws.length,drawn);if(['close','scope'].includes(action))assert.equal(current.aborted,true);
  delete global.hensemRoleAllowed;h.L.dirty=false;h.set(memberReply);await h.ui.members(0);
 }
});
test('a shrinking server total adjusts to its last page once, without an unbounded retry loop',async()=>{
 const h=await fixture();await global.liveSubmissionMemberSize('20');let n=0;h.set(q=>{n++;return memberReply(q,dataset.slice(0,25));});await global.liveSubmissionMemberJump('4');assert.equal(n,2);assert.equal(h.latest().offset,20);assert.match(h.body(),/第 2 \/ 2 页/);assert.match(h.body(),/显示 21–25/);
});
test('a searched member order drilldown returns to the exact cached list, filters and page size without reloading',async()=>{
 const h=await fixture();await global.liveSubmissionMemberSearch('0009007199254740993');await global.liveSubmissionMemberLevel('new');await global.liveSubmissionMemberSize('20');const list=h.draws.at(-1),parent=h.latest();
 h.set(q=>({...summary(q),operation:'memberOrders',memberId:q.memberId,day:q.day,offset:q.offset,limit:q.limit,total:20,hasMore:false,
  rows:Array.from({length:20},(_,i)=>({order_id:'Synthetic-'+i,created_at:q.day+'T04:40:'+String(i).padStart(2,'0')+'Z',provider:'Pay A',raw_provider:'Pay A',amount:'0',currency:'INR',status:'0',status_group:'pending'})),
  amountGroups:[{amount:'0',currency:'INR',count:20,total_amount:'0'}]}));
 await global.liveSubmissionMemberOrders(0);const query=h.latest();for(const key of ['platformId','startAt','endAt','direction','currency','threshold','providers','level','memberId'])assert.deepEqual(query[key],parent[key]);assert.equal(query.limit,100);assert.equal(query.day,'2026-09-28');
 const count=h.calls.length;global.liveSubmissionMemberList();assert.equal(h.calls.length,count);assert.deepEqual(h.draws.at(-1),list);assert.match(h.body(),/value="20" selected/);assert.match(h.body(),/value="0009007199254740993"/);
 h.set(memberReply);await global.liveSubmissionMemberClear();assert.equal(h.latest().limit,20);assert.equal(h.latest().level,'new');assert(!('memberId' in h.latest()));
});
test('partial server pages cannot silently skip unseen rows, and repeat total drift has one bounded correction',async()=>{
 const h=await fixture();h.set(q=>({...memberReply(q),rows:[]}));await global.liveSubmissionMemberRetry();assert.match(h.body(),/明细不完整/);assert.doesNotMatch(h.body(),/当前匹配 0/);
 h.set(memberReply);await global.liveSubmissionMemberRetry();await global.liveSubmissionMemberSize('20');let n=0;
 h.set(q=>{n++;return memberReply(q,dataset.slice(0,n===1?25:10));});await global.liveSubmissionMemberJump('4');assert.equal(n,2);assert.match(h.body(),/匹配总数已变化，请重新查询/);
});
