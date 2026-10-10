/* Production channel browser, real module with session-local catalog, clock and IO. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-channel-status.js'),'utf8');
const NOW='2026-10-09T05:00:00.000Z';
const AR_WITHDRAW_HEADERS=['状态','通道余额 (UTC+5:30)','通道 ID','通道名称','成功率统计','三方商户昵称 / 商户号','自动出款权重','提现金额区间','自动关闭阈值','三方通道编码','通道币种','提现大类','网关信息','内置提现大类','备注','最后修改人 / 时间 (UTC+5:30)','操作'];
const AR_WITHDRAW_WIDTHS=[168,198,246,260,240,224,110,104,122,168,100,160,300,140,160,260,160];
const AR_RATE_HEADERS=['近10分钟成功率','近30分钟成功率','近1小时成功率','近24小时成功率'];
const platform=(n,extra={})=>({id:String(n).padStart(8,'0')+'-1111-4111-8111-111111111111',source:'ar',name:'AR '+n,country:'印度',timezone:'Asia/Kolkata',capabilities:{channelStatusAvailable:true,channelStatusSource:'ar_middle'},...extra});
const AR=platform(1),YASH=platform(2,{source:'kb',name:'YASH.BET',capabilities:{channelStatusAvailable:true}});
const channel=(id='one',extra={})=>({channel_id:id,sys_channel_id:'sys-'+id,channel_name:'Display '+id,source_channel_name:null,provider:'Provider '+id,category_id:'upi',category_name:'UPI',channel_categories:[{category_id:'upi',category_name:'UPI',sort:2},{category_id:'qr',category_name:'QR 大类',sort:1}],channel_type:'native',payment_method:'pay-method',source_state:'1',source_channel_state:'0',source_merchant_state:'1',source_position:0,enabled:true,is_present:true,status_text:'开启',min_amount:'0',max_amount:'50000',limit_currency:'INR',balance:'-2.5',balance_currency:null,required_deposit_count:0,priority:0,weight:0,fee_rate:'0.025',fee_rate_basis:'source_raw',fee_amount:'2',third_pay_merchant_id:'merchant-22',source_updated_at:NOW,success_rate_10m:'99',success_rate_15m:'0',success_rate_30m:'68.4',success_rate_1h:null,success_rate_24h:'60.2',notes:'',observed_at:NOW,...extra});
function response(p,rows=[channel()],extra={}){return {version:1,queriedAt:NOW,platforms:[p],snapshots:['charge','withdraw'].map(direction=>({platformId:p.id,direction,...(p.source==='ar'?{source:'ar_middle',sourceTenantId:'1064'}:{}),observedAt:NOW,receivedAt:NOW,complete:true,sourceCount:rows.length,channels:rows.map(r=>({...r,channel_id:r.channel_id+'-'+direction}))})),...extra};}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(options={}){
 let page='channel_status',clock=Date.parse(NOW),catalog=options.catalog||[AR],permissions=new Set(options.permissions||['view','query','export','detail']),handler=options.handler||((q)=>response(catalog.find(p=>p.id===q.platformIds[0])));
 const timers=[],calls=[],paints=[],events={},rootEvents={};
 const context={console,Intl,Promise,Date:class extends Date{constructor(...a){super(...(a.length?a:[clock]))}static now(){return clock}},document:{visibilityState:'visible',addEventListener:(name,fn)=>events[name]=fn},addEventListener:(name,fn)=>rootEvents[name]=fn,setTimeout:(fn,ms)=>{const item={fn,ms,due:clock+ms,active:true};timers.push(item);return item;},clearTimeout:item=>{item.active=false;}};
 context.window=context;vm.createContext(context);vm.runInContext(source,context);
 const L={catalogReady:true,dirty:true,pageQueried:false,country:'印度'},mod=context.HensemLiveChannelStatus.create({L,getPage:()=>page,catalog:()=>catalog,roleAllowed:action=>permissions.has(action),request:q=>{calls.push(JSON.parse(JSON.stringify(q)));return handler(q)},render:()=>paints.push(mod.render())});
 return {context,L,mod,calls,paints,timers,start:async()=>{mod.render();await flush();},setHandler:fn=>handler=fn,setPage:value=>page=value,setCatalog:value=>catalog=value,setPermissions:value=>permissions=new Set(value),hide:()=>{context.document.visibilityState='hidden';events.visibilitychange();},show:async()=>{context.document.visibilityState='visible';events.visibilitychange();await flush();},unload:()=>rootEvents.pagehide(),advance:async(ms)=>{clock+=ms;for(const timer of [...timers])if(timer.active&&timer.due<=clock){timer.active=false;timer.fn();}await flush();},setNow:value=>clock=Date.parse(value)};
}
const headers=html=>[...html.matchAll(/<th[^>]*scope="col"[^>]*>([^<]*)<\/th>/g)].map(m=>m[1]);
const firstTableRow=html=>{const names=headers(html),body=html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'',row=body.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/)?.[1]||'',values=[...row.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/g)].map(m=>m[1].replace(/<[^>]+>/g,''));assert.equal(values.length,names.length);return Object.fromEntries(names.map((name,i)=>[name,values[i]]));};
const exported=h=>{const rows=h.mod.exportRows(),header=rows[3];return rows.slice(4).map(row=>Object.fromEntries(header.map((name,i)=>[name,row[i]])));};

function categoryRowsResponse(rows,p=AR){
 const data=response(p,[]),s=data.snapshots.find(x=>x.direction==='charge');
 Object.assign(s,{sourceRowIdentity:'category_channel',sourceCount:rows.filter(r=>r.is_present!==false).length,channels:rows});
 return data;
}

test('AR recharge preserves native category-channel rows, category-specific values and filtering',async()=>{
 const rows=[channel('same',{category_id:'upi',category_name:'UPI',weight:'10',source_position:0}),channel('same',{category_id:'qr',category_name:'QR 大类',weight:'25',source_position:1})];
 const h=fixture({handler:()=>categoryRowsResponse(rows)});await h.start();
 assert.equal(h.mod.canExport(),true);assert.equal(exported(h).length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(exported(h).map(r=>[r['通道 ID'],r['通道大类 ID'],r['权重']]))),[['same','upi','10'],['same','qr','25']]);
 assert.equal(firstTableRow(h.mod.render())['充值大类'],'UPI');
 assert.match(h.mod.render(),/QR 大类 \(1\)/);assert.match(h.mod.render(),/UPI \(1\)/);
 h.context.liveChannelCategory('qr');assert.equal(exported(h).length,1);
 assert.equal(firstTableRow(h.mod.render())['充值大类'],'QR 大类');assert.equal(exported(h)[0]['权重'],'25');
 assert.equal(exported(h)[0]['全部大类 ID'],'upi / qr');
 const saved=h.mod.capture();h.mod.clear();h.mod.restore(saved);h.mod.render();
 assert.equal(exported(h).length,1);assert.equal(exported(h)[0]['通道大类 ID'],'qr');
});

test('AR recharge distinguishes unknown and zero category while rejecting true duplicate rows',async()=>{
 const rows=[channel('same',{category_id:null,category_name:null,channel_categories:[],source_position:0}),channel('same',{category_id:'0',category_name:'Zero',channel_categories:[],source_position:1})];
 const h=fixture({handler:()=>categoryRowsResponse(rows)});await h.start();assert.equal(exported(h).length,2);
 h.context.liveChannelCategory('0');assert.equal(exported(h).length,1);assert.equal(exported(h)[0]['通道大类 ID'],'0');
 for(const duplicate of [channel('same',{category_id:null}),channel('same',{category_id:undefined})]){
  const bad=fixture({handler:()=>categoryRowsResponse([rows[0],duplicate])});await bad.start();
  assert.equal(bad.mod.canExport(),false);assert.match(bad.mod.render(),/通道身份缺失或重复/);
 }
});

test('category-channel identity never relaxes withdrawal or YASH channel uniqueness',async()=>{
 const rows=[channel('same',{category_id:'upi'}),channel('same',{category_id:'qr',source_position:1})];
 for(const direction of ['charge','withdraw']){
  const p=direction==='charge'?YASH:AR;
  const data=response(p,[]);Object.assign(data.snapshots.find(s=>s.direction===direction),{sourceCount:2,channels:rows});
  const h=fixture({catalog:[p],handler:()=>data});await h.start();
  assert.equal(h.mod.canExport(),false);assert.match(h.mod.render(),/通道身份缺失或重复/);
 }
});

test('AR withdrawal follows the requested seventeen columns, exact decimals, two counts and disabled source actions',async()=>{
 const details={source_tenant_name:'6club',balance_updated_at:NOW,today_submit_count:0,recent_1h_success_count:42,merchant_name:'Native merchant',merchant_code:'MCH-0',third_channel_code:'WD-X',is_use_channel_code:true,is_fixed_channel_code:true,system_category_id:'0',system_category_name:'BANK',third_pay_api_url:'https://gateway.example/withdraw',notify_white_ips:['192.0.2.1','2001:db8::/32'],last_update_by:'<admin>',last_updated_at:NOW};
 const row=channel('native',{sys_channel_id:'22',source_channel_name:'Native Bank',channel_name:'Bank outgoing',provider:'QPAY',balance:'-2.51234567',weight:'100.12345678',min_amount:'0.00000001',max_amount:'50000.5000',balance_threshold:'0.00000002',notes:'<img src=x onerror=alert(1)>',withdrawal_details:details}),h=fixture({handler:()=>response(AR,[row])});await h.start();h.context.liveChannelTab('withdraw');const html=h.mod.render(),cells=firstTableRow(html);
 assert.deepEqual(headers(html),AR_WITHDRAW_HEADERS);assert.match(html,/channel-ar-source-table channel-ar-withdraw-table/);assert.deepEqual([...html.matchAll(/<col style="width:(\d+)px"/g)].map(m=>Number(m[1])),AR_WITHDRAW_WIDTHS);assert.equal(cells['商户'],undefined);assert.doesNotMatch(html,/channel-tenant/);assert.equal(cells['通道余额 (UTC+5:30)'],'通道余额：-2.51234567更新时间：2026-10-09 10:30');assert.equal(cells['通道 ID'],'通道 ID：native-withdrawQPAY');assert.equal(cells['通道名称'],'通道名称：[22] Native Bank出款显示名称：Bank outgoing');assert.equal(cells['成功率统计'],'今日已提交笔数：0近1小时成功笔数：42');assert.equal(cells['三方商户昵称 / 商户号'],'昵称：Native merchant商户号：MCH-0');assert.equal(cells['自动出款权重'],'100.12345678');assert.equal(cells['提现金额区间'],'0.00000001~50000.5000');assert.equal(cells['自动关闭阈值'],'0.00000002');assert.equal(cells['三方通道编码'],'类型：固定编码：WD-X');assert.equal(cells['通道币种'],'INR');assert.equal(cells['提现大类'],'UPI');assert.equal(cells['网关信息'],'网关地址：https://gateway.example/withdraw回调白名单 IP：192.0.2.1|2001:db8::/32');assert.equal(cells['内置提现大类'],'BANK');assert.equal(cells['备注'],'&lt;img src=x onerror=alert(1)&gt;');assert.equal(cells['最后修改人 / 时间 (UTC+5:30)'],'&lt;admin&gt;2026-10-09 10:30');assert.match(cells['操作'],/代付测试编辑删除源站操作未接入/);
 const body=html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1],buttons=[...body.matchAll(/<button\b[^>]*class="channel-readonly-action"[^>]*>/g)].map(m=>m[0]);assert.equal(buttons.length,3);for(const button of buttons){assert.match(button,/disabled/);assert.doesNotMatch(button,/onclick|onchange/);}assert.doesNotMatch(html,/近10分钟成功率|近30分钟成功率|近1小时成功率|近24小时成功率|channel-rate-cell|channel-source-details|liveChannelSourceDetail|<img\b|<a[^>]+gateway/);assert.deepEqual(h.calls.map(q=>q.action),['channelStatus']);
 const csv=exported(h)[0];assert.equal(csv['今日已提交笔数'],'0');assert.equal(csv['近1小时成功笔数'],'42');assert.equal(csv['近10分钟成功率'],undefined);assert.equal(csv['余额'],'-2.51234567');assert.equal(csv['最小交易金额'],'0.00000001');assert.equal(csv['最大交易金额'],'50000.5000');assert.equal(csv['余额阈值'],'0.00000002');assert.equal(csv['源租户名称'],'6club');assert.equal(csv['三方商户号'],'MCH-0');assert.equal(csv['内置提现大类 ID'],'0');assert.equal(csv['回调白名单 IP'],'192.0.2.1|2001:db8::/32');assert.equal(csv['使用通道编码'],'是');assert.equal(csv['固定通道编码'],'是');assert.match(h.mod.exportRows()[0][1],/笔数.*不是百分率/);assert.equal(h.mod.exportRows()[3].length,h.mod.exportRows()[4].length);
 const css=fs.readFileSync(path.join(__dirname,'../admin-preview/live-channel-status.css'),'utf8');assert.doesNotMatch(html,/channel-ar-charge-table/);assert.match(css,/\.channel-ar-withdraw-table :is\(\.channel-category,\.channel-compact-state,\.channel-id\)\{position:static;left:auto/);assert.match(css,/channel-readonly-action:disabled[^}]*opacity:1/);
});

test('AR withdrawal legacy payloads and dictionary gaps stay unknown instead of inventing names, counts or code modes',async()=>{
 for(const details of [undefined,null,{}]){const h=fixture({handler:()=>response(AR,[channel('legacy',{source_channel_name:null,category_name:null,weight:'0',balance:'0',min_amount:null,max_amount:'0',source_updated_at:null,withdrawal_details:details})])});await h.start();h.context.liveChannelTab('withdraw');const cells=firstTableRow(h.mod.render());assert.equal(cells['商户'],undefined);assert.equal(cells['成功率统计'],'今日已提交笔数：—近1小时成功笔数：—');assert.equal(cells['通道余额 (UTC+5:30)'],'通道余额：0更新时间：—');assert.equal(cells['自动出款权重'],'0');assert.equal(cells['提现金额区间'],'—~0');assert.equal(cells['提现大类'],'—');assert.match(cells['通道名称'],/源通道名称字典待采集/);assert.match(cells['三方商户昵称 / 商户号'],/三方商户昵称字典待采集商户号：—/);assert.equal(cells['三方通道编码'],'类型：—');assert.match(cells['内置提现大类'],/字典待采集/);assert.equal(cells['网关信息'],'网关地址：—回调白名单 IP：—');assert.doesNotMatch(h.mod.render(),/undefined|null|NaN/);}
 for(const [details,label]of [[{is_use_channel_code:false,is_fixed_channel_code:false},'类型：不使用'],[{is_use_channel_code:true,is_fixed_channel_code:false},'类型：动态编码：—'],[{is_use_channel_code:true,is_fixed_channel_code:true,third_channel_code:'0'},'类型：固定编码：0'],[{is_use_channel_code:null,is_fixed_channel_code:false},'类型：—']]){const h=fixture({handler:()=>response(AR,[channel('codes',{withdrawal_details:{today_submit_count:0,recent_1h_success_count:0,system_category_id:'0',notify_white_ips:[],...details}})])});await h.start();h.context.liveChannelTab('withdraw');const cells=firstTableRow(h.mod.render());assert.equal(cells['三方通道编码'],label);assert.equal(cells['成功率统计'],'今日已提交笔数：0近1小时成功笔数：0');assert.match(cells['内置提现大类'],/^\[0\] .*字典待采集$/);assert.equal(exported(h)[0]['回调白名单 IP'],'—');}
});

test('AR withdrawal detail permission masks new fields and rejects malformed refreshes without losing a complete snapshot',async()=>{
 const row=channel('private',{source_channel_name:'Private native',withdrawal_details:{source_tenant_name:'Private tenant',today_submit_count:15,recent_1h_success_count:4,merchant_name:'Private nickname',merchant_code:'PRIVATE-001',third_channel_code:'Private code',is_use_channel_code:true,is_fixed_channel_code:true,third_pay_api_url:'https://private.example/',notify_white_ips:['192.0.2.1'],system_category_name:'Private builtin',last_update_by:'Private editor',last_updated_at:NOW}}),h=fixture({permissions:['view','query','export'],handler:()=>response(AR,[row])});await h.start();h.context.liveChannelTab('withdraw');const html=h.mod.render(),cells=firstTableRow(html);assert.deepEqual(headers(html),AR_WITHDRAW_HEADERS);assert.doesNotMatch(html,/Private native|Private tenant|Private nickname|PRIVATE-001|Private code|private\.example|192\.0\.2\.1|Private builtin|Private editor/);assert.equal(cells['商户'],undefined);assert.match(cells['通道名称'],/未获明细权限.*出款显示名称：Display private/);for(const key of ['成功率统计','三方商户昵称 / 商户号','三方通道编码','自动关闭阈值','网关信息','内置提现大类','备注','最后修改人 / 时间 (UTC+5:30)'])assert.equal(cells[key],'未获明细权限',key);const csv=exported(h)[0];for(const key of ['今日已提交笔数','近1小时成功笔数','源租户名称','三方商户昵称','三方商户号','三方通道编码','网关地址','回调白名单 IP','内置提现大类','最后修改人'])assert.equal(csv[key],'—',key);
 h.setPermissions(['view','query','export','detail']);h.mod.render();assert.match(h.mod.render(),/Private nickname/);const before=h.mod.capture().response;h.setHandler(()=>response(AR,[channel('bad',{withdrawal_details:[]})]));await h.mod.load();assert.equal(h.mod.capture().status,'ready');assert.match(h.mod.render(),/更新失败.*提现通道配置返回不完整/);assert.deepEqual(h.mod.capture().response,before);assert.equal(h.calls.length,2);
 const invalid=fixture({handler:()=>response(AR,[channel('bad',{withdrawal_details:'invalid'})])});await invalid.start();assert.equal(invalid.mod.capture().status,'error');assert.equal(invalid.mod.canExport(),false);
});

test('AR charge polling weight keeps preset and real-time source values independent including missing and zero',async()=>{
 for(const [real,expected]of [[undefined,'—'],[null,'—'],['0','0'],['82.81','82.81']]){const h=fixture({handler:()=>response(AR,[channel('weights',{weight:'100',real_time_weight:real})])});await h.start();assert.equal(firstTableRow(h.mod.render())['轮询权重'],'预设权重：100实时权重：'+expected);const csv=exported(h)[0];assert.equal(csv['权重'],'100');assert.equal(csv['实时权重'],expected);assert.equal(h.mod.exportRows()[3].length,h.mod.exportRows()[4].length);const labels=headers(h.mod.render()),widths=[...h.mod.render().matchAll(/<col style="width:(\d+)px"/g)].map(m=>Number(m[1]));assert.equal(widths[labels.indexOf('轮询权重')],160);h.context.liveChannelTab('withdraw');assert.equal(firstTableRow(h.mod.render())['自动出款权重'],'100');assert.equal(exported(h)[0]['实时权重'],undefined);}
 const yash=fixture({catalog:[YASH],handler:()=>response(YASH,[channel('yash',{weight:'100',real_time_weight:'82.81'})])});await yash.start();assert(!headers(yash.mod.render()).includes('轮询权重'));assert.equal(exported(yash)[0]['实时权重'],undefined);assert.equal(firstTableRow(yash.mod.render())['权重'],'100');
});

test('AR withdrawal time headers follow the selected platform timezone and native ellipsis retains full escaped hover values',async()=>{
 const p=platform(9,{timezone:'America/Sao_Paulo',country:'巴西'}),row=channel('tz',{source_channel_name:'Bank <Native> "name"',withdrawal_details:{source_tenant_name:'Merchant "full"',balance_updated_at:NOW,last_updated_at:NOW,last_update_by:'Admin',merchant_code:'LONG-12345678901234567890',third_pay_api_url:'https://gateway.example/withdraw',notify_white_ips:['192.0.2.1','2001:db8::/32']}}),h=fixture({catalog:[p],handler:()=>response(p,[row])});await h.start();h.context.liveChannelTab('withdraw');const html=h.mod.render(),cells=firstTableRow(html);assert(headers(html).includes('通道余额 (UTC-3)'));assert(headers(html).includes('最后修改人 / 时间 (UTC-3)'));assert(!headers(html).some(label=>label.includes('UTC+5:30')));assert.equal(cells['通道余额 (UTC-3)'],'通道余额：-2.5更新时间：2026-10-09 02:00');assert.equal(cells['最后修改人 / 时间 (UTC-3)'],'Admin2026-10-09 02:00');assert.match(html,/class="channel-native-value" title="\[sys-tz\] Bank &lt;Native&gt; &quot;name&quot;"/);assert.match(html,/class="channel-native-value" title="LONG-12345678901234567890"/);assert.match(html,/class="channel-native-value" title="192\.0\.2\.1\|2001:db8::\/32"/);assert.doesNotMatch(html,/channel-tenant-label|Merchant &quot;full&quot;/);assert.equal(exported(h)[0]['源租户名称'],'Merchant "full"');assert.doesNotMatch(html,/&amp;lt;Native|<Native>/);const css=fs.readFileSync(path.join(__dirname,'../admin-preview/live-channel-status.css'),'utf8');assert.match(css,/\.channel-native-value\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
});

test('AR withdrawal merchant search matches real nickname, merchant code and ID locally without widening detail access',async()=>{
 const rows=[channel('first',{third_pay_merchant_id:'555',provider:'PayOne',withdrawal_details:{merchant_name:'Native Alias',merchant_code:'MCH-ABC'}}),channel('zero',{third_pay_merchant_id:'777',provider:'PayTwo',limit_currency:'USDT',source_position:1,withdrawal_details:{merchant_name:'Other Alias',merchant_code:'0'}})],h=fixture({handler:()=>response(AR,rows)});await h.start();h.context.liveChannelTab('withdraw');const ids=()=>Array.from(exported(h),row=>row['通道 ID']);assert.match(h.mod.render(),/<label>三方商户昵称 \/ 商户号 \/ ID<input[^>]+name="merchant"[^>]+placeholder="昵称 \/ 商户号 \/ 第三方商户 ID"/);for(const query of ['  NATIVE ALIAS  ','mch-abc','555']){h.context.liveChannelQuery('',query);assert.deepEqual(ids(),['first-withdraw']);}h.context.liveChannelQuery('','0');assert.deepEqual(ids(),['zero-withdraw']);h.context.liveChannelProvider('PayTwo');h.context.liveChannelCurrency('USDT');assert.deepEqual(ids(),['zero-withdraw']);h.context.liveChannelClearFilters();h.context.liveChannelQuery('','PayOne');assert.deepEqual(ids(),[]);h.context.liveChannelQuery('','AR 1');assert.deepEqual(ids(),[]);h.context.liveChannelQueryDraft('merchant','Native Alias');assert.deepEqual(ids(),[]);h.context.liveChannelQuery('','Native Alias');assert.deepEqual(ids(),['first-withdraw']);const saved=h.mod.capture();h.mod.clear();h.mod.restore(saved);h.mod.render();await flush();assert.deepEqual(ids(),['first-withdraw']);assert.equal(h.calls.length,1);
 h.setPermissions(['view','query','export']);h.context.liveChannelQuery('','Native Alias');assert.deepEqual(ids(),['first-withdraw','zero-withdraw']);assert.equal(h.mod.capture().merchantQuery,'');assert.doesNotMatch(h.mod.render(),/name="merchant"|Native Alias|Other Alias|MCH-ABC/);h.setPermissions(['view','query','export','detail']);h.context.liveChannelTab('charge');assert.match(h.mod.render(),/<label>第三方商户 ID<input/);h.context.liveChannelQuery('','Native Alias');assert.deepEqual(ids(),[]);h.context.liveChannelQuery('','555');assert.deepEqual(ids(),['first-charge']);assert.equal(h.calls.length,1);
});

test('full authorized directory paginates independently and first automatic request reads exactly one platform',async()=>{
 const catalog=Array.from({length:44},(_,i)=>platform(i+1)),h=fixture({catalog});await h.start();assert.deepEqual(h.calls,[{action:'channelStatus',platformIds:[catalog[0].id],direction:'all'}]);
 const html=h.mod.render();assert.match(html,/共 44 个 · 1–20/);assert.equal((html.match(/onclick="liveChannelSelect/g)||[]).length,20);assert.match(html,/每 5 分钟自动刷新/);assert.match(html,/channel-platform-directory/);assert.match(html,/<div class="channel-scope-tabs">[\s\S]*channel-source-tabs[\s\S]*channel-country-tabs[\s\S]*channel-refresh-note/);assert.doesNotMatch(html,/<aside\b|channel-browser-top/);
 h.context.liveChannelPage(3);assert.match(h.mod.render(),/共 44 个 · 41–44/);h.context.liveChannelPageSize('500');assert.equal((h.mod.render().match(/onclick="liveChannelSelect/g)||[]).length,44);assert.equal(h.calls.length,1);
 h.context.liveChannelSearch('AR 43');assert.match(h.mod.render(),/共 1 个 · 1–1/);assert.equal(h.calls.length,1);assert.equal(h.mod.capture().platformId,catalog[0].id);
});


test('directory distinguishes an unread platform, a read without a snapshot, and a received zero-channel snapshot',async()=>{
 const second=platform(2),h=fixture({catalog:[AR,second]});await h.start();
 const sidebar=()=>h.mod.render().split('<article>')[0],label=name=>new RegExp('<strong>'+name+'</strong><small>([^<]*)</small>').exec(sidebar())?.[1];
 assert.equal(label(second.name),'待读取');assert.equal(h.calls.length,1);assert.doesNotMatch(sidebar(),/未采集/);
 h.setHandler(()=>response(second,[],{snapshots:['charge','withdraw'].map(direction=>({platformId:second.id,source:'ar_middle',direction,observedAt:null,complete:false,sourceCount:null,channels:[]}))}));
 h.context.liveChannelSelect(1);await flush();assert.equal(label(second.name),'尚未收到快照');assert.match(h.mod.render(),/尚未收到完整通道快照/);assert.equal(h.calls.length,2);
 h.setHandler(()=>response(second,[]));await h.mod.load();assert.match(label(second.name),/10\/09 10:30/);assert.match(h.mod.render(),/0 个当前通道/);assert.match(h.mod.render(),/已采集，暂无通道/);assert.equal(h.calls.length,3);assert.doesNotMatch(sidebar(),/未采集|待读取|尚未收到快照/);
});

test('source and country tabs come only from directory and keep different source caches and exports isolated',async()=>{
 const BR=platform(3,{country:'巴西'}),h=fixture({catalog:[AR,BR,YASH]});await h.start();assert.match(h.mod.render(),/AR 系统/);assert.match(h.mod.render(),/YASH 系统/);assert.match(h.mod.render(),/巴西/);
 h.context.liveChannelCountry(1);await flush();assert.equal(h.calls[1].platformIds[0],BR.id);h.context.liveChannelCountry(0);await flush();assert.equal(h.calls.length,3);assert.equal(h.calls[2].platformIds[0],AR.id);
 h.context.liveChannelSource(1);await flush();assert.equal(h.calls[3].platformIds[0],YASH.id);assert.equal(exported(h)[0]['平台'],YASH.name);h.context.liveChannelSource(0);await flush();assert.equal(h.calls.length,5);assert.equal(h.calls[4].platformIds[0],AR.id);assert.equal(exported(h)[0]['平台'],AR.name);
});

test('AR wide source table keeps the requested display fields visible without source-name or expandable details',async()=>{
 const h=fixture();await h.start();const html=h.mod.render(),cols=['充值大类','状态','通道 ID','支付供应商','前台显示名称','系统通道 ID',...AR_RATE_HEADERS,'限额','轮询权重','第三方商户 ID','费率（源值）','费率口径','固定手续费','优先级','代收次数要求','余额阈值','阈值币种','主大类 ID','主大类名称','全部大类 / ID / 排序','通道类型','支付方式','源启用状态原码','通道可用状态原码','商户可用状态原码','源站状态原文','源更新时间','源页顺序','备注'];assert.deepEqual(headers(html),cols);
 assert.match(html,/channel-ar-source-table/);assert.equal((html.match(/<td class="channel-rate-cell num"/g)||[]).length,4);assert.match(html,/<div class="channel-table-toolbar"><div class="channel-tabs"[\s\S]*channel-local-filters[\s\S]*<section class="channel-panel"/);assert.doesNotMatch(html,/channel-rate-grid|成功率统计|近15分钟|近4小时|近8小时|今日成功率|总成功率|onclick="liveChannelSourceDetail|onclick="liveChannelToggle|channel-source-details|aria-expanded|collapsed/);assert.equal(h.context.liveChannelSourceDetail,undefined);
 const cells=firstTableRow(html);for(const [key,value] of Object.entries({'通道 ID':'one-charge','支付供应商':'Provider one','前台显示名称':'Display one','系统通道 ID':'sys-one','轮询权重':'预设权重：0实时权重：—','第三方商户 ID':'merchant-22','费率（源值）':'0.025','费率口径':'source_raw','固定手续费':'2.00','优先级':'0','代收次数要求':'0','余额阈值':'—','阈值币种':'—','主大类 ID':'upi','主大类名称':'UPI','通道类型':'native','支付方式':'pay-method','源启用状态原码':'1','通道可用状态原码':'0','商户可用状态原码':'1','源站状态原文':'开启','源更新时间':NOW,'源页顺序':'0','备注':'—',...Object.fromEntries(AR_RATE_HEADERS.map((name,i)=>[name,['0.00%','68.40%','—','60.20%'][i]]))}))assert.equal(cells[key],value,key);
 assert.match(cells['充值大类'],/UPI.*QR 大类/);assert.match(cells['全部大类 / ID / 排序'],/UPI · upi · 排序 2.*QR 大类 · qr · 排序 1/);assert.match(cells['状态'],/通道状态开启.*可用状态总控通道关闭/);assert.match(cells['限额'],/0\.00 – 50,000\.00INR/);assert.equal(cells['余额'],undefined);assert.doesNotMatch(html,/99\.00%|2\.50%/);assert.match(html,/role="switch"[^>]*aria-checked="true"/);assert.match(html,/aria-readonly="true"/);assert.doesNotMatch(html,/onclick="liveQuery|onclick="liveReset|liveExport\(|<aside\b/);
 const row=exported(h)[0];assert.equal(row['源通道名称'],'—');assert.equal(row['全部大类 ID'],'upi / qr');assert.equal(row['通道可用状态'],'0');assert.equal(row['商户可用状态'],'1');assert.equal(row['余额'],-2.5);assert.equal(row['代收次数要求'],0);assert.equal(row['近1小时成功率'],'—');assert.equal(row['近10分钟成功率'],'0.00%');assert.equal(row['近15分钟成功率'],undefined);assert.equal(h.mod.exportRows()[3].length,h.mod.exportRows()[4].length);assert(!cols.includes('快照采集时间'));assert(!cols.includes('服务器接收时间'));assert.match(html,/最新采集/);
 h.context.liveChannelCategory('qr');assert.equal(exported(h).length,1);assert.equal(h.calls.length,1);h.context.liveChannelTab('withdraw');const withdrawHtml=h.mod.render();assert.deepEqual(headers(withdrawHtml),AR_WITHDRAW_HEADERS);const withdrawal=firstTableRow(withdrawHtml);assert.equal(withdrawal['商户'],undefined);assert.equal(withdrawal['通道余额 (UTC+5:30)'],'通道余额：-2.5更新时间：—');assert.equal(withdrawal['成功率统计'],'今日已提交笔数：—近1小时成功笔数：—');for(const name of AR_RATE_HEADERS)assert.equal(withdrawal[name],undefined,name);assert.doesNotMatch(withdrawHtml,/channel-rate-cell|近10分钟成功率|近30分钟成功率|代收次数要求/);
});

test('AR deposit freezes five matching header/body columns through the display name with offsets derived from their widths',async()=>{
 const h=fixture({handler:()=>response(AR,[channel('odd',{source_channel_name:'Hidden source name'}),channel('even',{source_position:1})])});await h.start();const html=h.mod.render(),css=fs.readFileSync(path.join(__dirname,'../admin-preview/live-channel-status.css'),'utf8');
 assert.match(html,/channel-ar-source-table channel-ar-charge-table/);assert.deepEqual(headers(html).slice(0,5),['充值大类','状态','通道 ID','支付供应商','前台显示名称']);assert(!headers(html).includes('源通道名称'));assert.doesNotMatch(html,/channel-source-name|Hidden source name/);assert.equal(exported(h)[0]['源通道名称'],'Hidden source name');
 const widths=[...html.matchAll(/<col style="width:(\d+)px"/g)].map(m=>Number(m[1]));assert.deepEqual(widths.slice(0,5),[115,140,100,130,180]);
 const classes=['channel-category','channel-compact-state','channel-id','channel-provider','channel-display-name'],heading=html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)[1],body=html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
 assert.deepEqual([...heading.matchAll(/<th class="([^"]+)"/g)].slice(0,5).map(m=>m[1]),classes);for(const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))assert.deepEqual([...row[1].matchAll(/<(?:th|td)\b[^>]*class="([^"]+)"/g)].slice(0,5).map(m=>m[1]),classes);
 const rules=new Map([...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(m=>[m[1].trim(),m[2]]));let offset=0;
 for(let i=0;i<classes.length;i++){const rule=rules.get('.channel-ar-charge-table .'+classes[i]);assert.match(rule,new RegExp('(?:^|;)left:'+offset+'(?:px)?(?:;|$)'));offset+=widths[i];}assert.equal(offset,665);
 const sticky=rules.get('.channel-ar-charge-table :is(.'+classes.join(',.')+')'),top=rules.get('.channel-ar-charge-table thead :is(.'+classes.join(',.')+')');assert.match(sticky,/position:sticky/);assert.match(sticky,/z-index:2/);assert.match(sticky,/background:#fff/);assert.match(top,/z-index:5/);assert.match(top,/background:#f3f6fc/);assert.match(rules.get('.channel-ar-charge-table .channel-display-name'),/box-shadow:2px/);assert.match(rules.get('.channel-ar-charge-table .channel-provider'),/box-shadow:none/);for(const className of classes.slice(0,3))assert.doesNotMatch(rules.get('.channel-ar-charge-table .'+className),/box-shadow/);
 assert.match(rules.get('.channel-scroll'),/overflow:auto/);assert.match(rules.get('.channel-ar-source-table tbody tr:nth-child(even)>:is(th,td)'),/background:#f8faff/);assert.match(rules.get('.channel-table .channel-provider'),/left:180px/);
 h.context.liveChannelTab('withdraw');const withdrawal=h.mod.render();assert.match(withdrawal,/channel-ar-source-table channel-ar-withdraw-table/);assert.doesNotMatch(withdrawal,/channel-ar-charge-table/);assert.deepEqual(headers(withdrawal),AR_WITHDRAW_HEADERS);
});

test('YASH retains its eight rate windows and payment method while source fifteen-minute value is excluded',async()=>{
 const h=fixture({catalog:[YASH]});await h.start();const list=headers(h.mod.render());assert.equal(list.filter(x=>x.includes('成功率')).length,8);assert(list.includes('支付方式'));assert(list.includes('余额'));assert(list.includes('权重'));assert(!list.includes('轮询权重'));assert(!list.includes('近15分钟成功率'));assert.equal(exported(h)[0]['近10分钟成功率'],'99.00%');assert.doesNotMatch(h.mod.render(),/channel-original-name|源接口未提供|channel-rate-cell/);
});

test('provider, state, category, history and direction controls stay local with complete internal readonly rows',async()=>{
 const rows=[channel('a'),channel('b',{provider:'Other',source_state:'0',enabled:false,source_position:1}),channel('old',{is_present:false,source_position:2})],h=fixture({handler:()=>response(AR,rows)});await h.start();
 h.context.liveChannelProvider('Other');assert.equal(exported(h).length,1);assert.equal(exported(h)[0]['支付供应商'],'Other');h.context.liveChannelStatus('on');assert.equal(exported(h).length,0);h.context.liveChannelProvider('');h.context.liveChannelStatus('all');h.context.liveChannelAbsent(true);assert.equal(exported(h).length,3);h.context.liveChannelTab('withdraw');assert.equal(exported(h)[0]['方向'],'提现');assert(headers(h.mod.render()).includes('通道余额 (UTC+5:30)'));assert(!headers(h.mod.render()).includes('代收次数要求'));assert.equal(h.calls.length,1);
});

test('channel and merchant searches combine with local source filters, preserve zero IDs and never read the backend',async()=>{
 const rows=[
  channel('alpha',{sys_channel_id:'SYS-ZEBRA',channel_name:'Front QR',source_channel_name:'Native System QR',provider:'PayOne',third_pay_merchant_id:'150',source_state:'1',source_channel_state:'1',enabled:false}),
  channel('beta',{sys_channel_id:'0',channel_name:'Other Display',source_channel_name:null,provider:'PayTwo',third_pay_merchant_id:'0',category_id:'0',category_name:'Zero category',channel_categories:[{category_id:'0',category_name:'Zero category',sort:0}],limit_currency:'USDT',source_state:null,source_channel_state:null,source_merchant_state:null,enabled:true,source_position:1}),
  channel('gamma',{sys_channel_id:'SYS-GAMMA',channel_name:'Closed Display',provider:'PayOne',third_pay_merchant_id:'22',source_state:'0',source_channel_state:'1',enabled:true,source_position:2}),
 ],h=fixture({handler:()=>response(AR,rows)});await h.start();
 const ids=()=>Array.from(exported(h),r=>r['通道 ID']);assert.deepEqual(ids(),['alpha-charge','beta-charge','gamma-charge']);h.context.liveChannelQueryDraft('channel','SYS-ZEBRA');assert.deepEqual(ids(),['alpha-charge','beta-charge','gamma-charge']);assert.equal(h.mod.capture().channelDraft,'SYS-ZEBRA');assert.equal(h.calls.length,1);
 for(const term of ['  ALPHA-CHARGE  ','sys-zebra','front qr','native system qr']){h.context.liveChannelQuery(term,'');assert.deepEqual(ids(),['alpha-charge'],term);}
 h.context.liveChannelQuery('','0');assert.deepEqual(ids(),['alpha-charge','beta-charge']);h.context.liveChannelCurrency('USDT');assert.deepEqual(ids(),['beta-charge']);
 h.context.liveChannelQuery('0','0');assert.deepEqual(ids(),['beta-charge']);h.context.liveChannelCategory('0');assert.deepEqual(ids(),['beta-charge']);h.context.liveChannelProvider('PayTwo');assert.deepEqual(ids(),['beta-charge']);h.context.liveChannelStatus('unknown');assert.deepEqual(ids(),['beta-charge']);
 h.context.liveChannelClearFilters();assert.deepEqual(ids(),['alpha-charge','beta-charge','gamma-charge']);h.context.liveChannelStatus('on');assert.deepEqual(ids(),['alpha-charge']);h.context.liveChannelStatus('off');assert.deepEqual(ids(),['gamma-charge']);h.context.liveChannelStatus('unknown');assert.deepEqual(ids(),['beta-charge']);
 h.context.liveChannelClearFilters();h.context.liveChannelCategory('qr');assert.deepEqual(ids(),['alpha-charge','gamma-charge']);h.context.liveChannelProvider('PayOne');h.context.liveChannelCurrency('INR');h.context.liveChannelQuery('SYSTEM QR','150');assert.deepEqual(ids(),['alpha-charge']);
 const saved=h.mod.capture();h.mod.clear();h.mod.restore(saved);h.mod.render();await flush();assert.deepEqual(ids(),['alpha-charge']);assert.equal(h.calls.length,1);assert.equal(h.mod.capture().platformId,AR.id);
 h.context.liveChannelQuery('does not exist','');assert.deepEqual(ids(),[]);assert.match(h.mod.render(),/当前筛选没有匹配通道/);h.context.liveChannelClearFilters();assert.deepEqual(ids(),['alpha-charge','beta-charge','gamma-charge']);
 h.context.liveChannelSearch('AR 1');assert.deepEqual(ids(),['alpha-charge','beta-charge','gamma-charge']);assert.equal(h.calls.length,1);assert.match(h.mod.render(),/liveChannelQuery/);assert.doesNotMatch(h.mod.render(),/onclick="liveChannelSourceDetail|channel-source-details/);
});

test('source zero sentinels remain zero while absent names, rates and currencies remain unknown in direct columns',async()=>{
 const row=channel('zero',{sys_channel_id:'0',source_channel_name:null,third_pay_merchant_id:'0',category_id:'0',category_name:null,channel_categories:[{category_id:'0',category_name:null,sort:0}],source_state:'0',source_channel_state:'0',source_merchant_state:'0',min_amount:'0',max_amount:'0',limit_currency:null,balance:'0',balance_currency:null,balance_threshold:'0',balance_threshold_currency:null,fee_rate:'0',fee_amount:'0',success_rate_15m:'0',success_rate_30m:null,success_rate_1h:undefined,success_rate_24h:'',source_updated_at:null,notes:null}),h=fixture({handler:()=>response(AR,[row])});await h.start();const html=h.mod.render(),cells=firstTableRow(html);
 for(const key of ['系统通道 ID','第三方商户 ID','主大类 ID','优先级','代收次数要求','源启用状态原码','通道可用状态原码','商户可用状态原码','源页顺序','费率（源值）'])assert.equal(cells[key],'0',key);
 for(const key of ['主大类名称','阈值币种','源更新时间','备注'])assert.equal(cells[key],'—',key);assert.equal(cells['源通道名称'],undefined);assert.equal(cells['充值大类'],'0');assert.match(cells['全部大类 / ID / 排序'],/— · 0 · 排序 0/);assert.equal(cells['轮询权重'],'预设权重：0实时权重：—');assert.equal(cells['固定手续费'],'0.00');assert.equal(cells['余额阈值'],'0.00');assert.equal(cells['余额'],undefined);assert.equal(cells['限额'],'0.00 – 0.00币种未提供');for(const [i,name]of AR_RATE_HEADERS.entries())assert.equal(cells[name],i===0?'0.00%':'—',name);assert.match(html,/role="switch"[^>]*aria-checked="false"/);assert.doesNotMatch(html,/source_channel_name|undefined|null|NaN|liveChannelSourceDetail/);h.context.liveChannelTab('withdraw');assert.equal(firstTableRow(h.mod.render())['通道余额 (UTC+5:30)'],'通道余额：0更新时间：—');assert.equal(h.calls.length,1);
});

test('direct source columns and private source-name or merchant searches retain the existing detail permission',async()=>{
 const rows=[channel('public-one',{channel_name:'Public display',sys_channel_id:'Public-SYS',source_channel_name:'Private native name',third_pay_merchant_id:'77991'}),channel('public-two',{channel_name:'Other public',source_channel_name:'Other private',third_pay_merchant_id:'88221',source_position:1})],h=fixture({permissions:['view','query','export'],handler:()=>response(AR,rows)});await h.start();const html=h.mod.render();
 assert.deepEqual(headers(html),['充值大类','状态','通道 ID','支付供应商','前台显示名称','系统通道 ID',...AR_RATE_HEADERS,'限额','轮询权重']);assert.doesNotMatch(html,/Private native name|77991|源通道名称|费率（源值）|源启用状态原码|name="merchant"/);
 h.context.liveChannelQuery('Private native name','');assert.equal(exported(h).length,0);h.context.liveChannelQuery('PUBLIC-SYS','');assert.equal(exported(h).length,1);h.context.liveChannelQuery('public display','');assert.equal(exported(h).length,1);h.context.liveChannelQuery('public-one-charge','');assert.equal(exported(h).length,1);h.context.liveChannelQuery('','77991');assert.equal(exported(h).length,2);assert.equal(h.mod.capture().merchantQuery,'');assert.equal(h.calls.length,1);
 h.setPermissions(['view','query','export','detail']);h.mod.render();assert(!headers(h.mod.render()).includes('源通道名称'));assert.equal(exported(h)[0]['源通道名称'],'Private native name');h.context.liveChannelQuery('Private native name','77991');assert.equal(exported(h).length,1);h.setPermissions(['view','query','export']);h.mod.render();assert.equal(exported(h).length,0);assert.doesNotMatch(h.mod.render(),/channel-source-name|name="merchant"/);h.context.liveChannelClearFilters();assert.equal(exported(h).length,2);assert.equal(h.calls.length,1);
});

test('every platform click requests once even with a fresh cache, while an identical inflight click never overlaps',async()=>{
 const second=platform(2),h=fixture({catalog:[AR,second]});await h.start();
 h.context.liveChannelSelect(1);await flush();h.context.liveChannelSelect(0);await flush();h.context.liveChannelSelect(0);await flush();assert.deepEqual(h.calls.map(q=>q.platformIds[0]),[AR.id,second.id,AR.id,AR.id]);
 let finish;h.setHandler(()=>new Promise(resolve=>finish=resolve));h.context.liveChannelSelect(0);await flush();assert.equal(h.calls.length,5);h.context.liveChannelSelect(0);await flush();assert.equal(h.calls.length,5);finish(response(AR));await flush();assert.equal(h.mod.capture().status,'ready');assert.equal(h.calls.length,5);
 assert(h.calls.every(q=>q.action==='channelStatus'&&q.direction==='all'&&q.platformIds.length===1));
});

test('AR native switch and availability stay independent; unknown codes never manufacture disabled states',async()=>{
 const cases=[
  ['on-total-closed',{source_state:'1',source_channel_state:'0',source_merchant_state:'0',enabled:true},'true','总控通道关闭'],
  ['off-available',{source_state:'0',source_channel_state:'1',source_merchant_state:'1',enabled:true},'false','可用'],
  ['on-merchant-closed',{source_state:'1',source_channel_state:'1',source_merchant_state:'0',enabled:false},'true','三方商户关闭'],
  ['unknown',{source_state:null,source_channel_state:null,source_merchant_state:null,enabled:false},null,'状态未提供'],
  ['empty',{source_state:'',source_channel_state:'',source_merchant_state:'',enabled:false},null,'状态未提供'],
 ];
 const h=fixture({handler:()=>response(AR,cases.map(([id,extra],i)=>channel(id,{...extra,source_position:i})))});await h.start();const html=h.mod.render();
 const rows=[...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(m=>m[0]);
 for(const [id,,checked,label] of cases){const row=rows.find(x=>x.includes(id+'-charge'));assert(row,id);assert.match(row,new RegExp(label));if(checked===null){assert.match(row,/<span class="channel-status-unknown" aria-label="启用状态未提供">—<\/span>/);assert.doesNotMatch(row,/role="switch"|aria-checked|总控通道关闭|三方商户关闭/);}else{assert.match(row,new RegExp('role="switch"[^>]*aria-checked="'+checked+'"'));assert.match(row,/aria-readonly="true"/);const control=row.match(/<button\b[^>]*role="switch"[^>]*>/)?.[0];assert(control);assert.match(control,/disabled/);assert.match(row,/<button\b[^>]*role="switch"[^>]*><i[^>]*><\/i><\/button>/);assert.doesNotMatch(control,/onclick|onchange|<input/);}}
 assert.doesNotMatch(html,/aria-checked="mixed"/);
 assert.deepEqual(h.calls.map(q=>q.action),['channelStatus']);assert.doesNotMatch(html,/ar_middle_channel_ingest|yash_channel_ingest|method="POST"|<input[^>]*type="checkbox"/);
});

test('five-minute timer refreshes the current platform without overlapping pending requests',async()=>{
 const h=fixture();await h.start();let finish;h.setHandler(()=>new Promise(resolve=>finish=resolve));await h.advance(300000);assert.equal(h.calls.length,2);assert.equal(h.mod.capture().status,'loading');const overlap=h.mod.load();assert.equal(h.calls.length,2);await h.advance(300000);assert.equal(h.calls.length,2);h.setHandler(()=>response(AR));finish(response(AR));await overlap;await flush();assert.equal(h.calls.length,3);assert.equal(h.mod.capture().status,'ready');
});

test('ordinary refresh failure preserves known snapshot, collection deadline and last success time',async()=>{
 const h=fixture();await h.start();h.setHandler(()=>{throw Error('network unavailable')});await h.advance(300000);assert.match(h.mod.render(),/更新失败：network unavailable/);assert.match(h.mod.render(),/保留上次成功读取的快照/);assert.match(h.mod.render(),/最后成功读取 2026\/10\/09 10:30:00/);assert.equal(exported(h)[0]['快照采集时间'],NOW);assert.equal(h.mod.capture().status,'ready');
 await h.advance(600001);assert.match(h.mod.render(),/超过 15 分钟未更新/);assert.equal(exported(h)[0]['更新状态'],'超过 15 分钟未更新');
 h.setHandler(()=>response(AR));await h.mod.load();assert.equal(h.mod.capture().error,'');assert.equal(h.mod.capture().status,'ready');
});

test('synchronously thrown request can be retried and cannot leave an inflight lock',async()=>{
 const h=fixture({handler:()=>{throw Error('network failure')}});await h.start();assert.equal(h.mod.capture().status,'error');assert.match(h.mod.render(),/点击上方平台重试/);assert.doesNotMatch(h.mod.render(),/点击查询/);h.setHandler(()=>response(AR));await h.mod.load();assert.equal(h.calls.length,2);assert.equal(h.mod.capture().status,'ready');
});

test('authorization failure clears cached facts across all platforms and disables automatic retries',async()=>{
 const p=platform(2),h=fixture({catalog:[AR,p]});await h.start();h.context.liveChannelSelect(1);await flush();assert.equal(Object.keys(h.mod.capture().cache).length,2);h.setHandler(()=>{throw Object.assign(Error('正式数据读取未获授权，或会话已失效'),{status:403})});await h.mod.load();assert.deepEqual(Object.keys(h.mod.capture().cache),[]);assert.equal(h.mod.canExport(),false);assert.doesNotMatch(h.mod.render(),/Display one/);await h.advance(600000);assert.equal(h.calls.length,3);assert.match(h.mod.render(),/点击上方平台重新验证授权/);assert.doesNotMatch(h.mod.render(),/点击查询/);
});

test('query permission revocation purges cached facts and all direct actions remain permission checked',async()=>{
 const h=fixture();await h.start();h.setPermissions(['view','export']);h.mod.render();assert.equal(h.mod.canExport(),false);assert.equal(Object.keys(h.mod.capture().cache).length,0);assert.match(h.mod.render(),/未获查询权限/);await h.mod.load();assert.equal(h.calls.length,1);
});

test('hidden document pauses automatic refresh and rejects a pending response; showing resumes safely',async()=>{
 const h=fixture();await h.start();let finish;h.setHandler(()=>new Promise(resolve=>finish=resolve));await h.advance(300000);h.hide();finish(response(AR,[channel('late')]));await flush();assert.doesNotMatch(h.mod.render(),/Display late/);await h.advance(300000);assert.equal(h.calls.length,2);h.setHandler(()=>response(AR));await h.show();assert.equal(h.calls.length,3);
});

test('platform selection cancels late response and navigation never repaints destination',async()=>{
 let finish;const second=platform(2),h=fixture({catalog:[AR,second],handler:q=>q.platformIds[0]===AR.id?new Promise(resolve=>finish=resolve):response(second,[channel('second')])});await h.start();h.context.liveChannelSelect(1);await flush();finish(response(AR,[channel('late')]));await flush();assert.equal(exported(h)[0]['平台'],second.name);assert.doesNotMatch(h.mod.render(),/Display late/);
 let done;h.setHandler(()=>new Promise(resolve=>done=resolve));const reading=h.mod.load();await flush();h.setPage('overview');h.mod.cancel();const count=h.paints.length;done(response(second,[channel('navigation-late')]));await reading;assert.equal(h.paints.length,count);assert.equal(h.mod.canExport(),false);assert.equal(h.mod.render(),'');
});

test('catalog revocation and changed source identity discard cache and prevent old-scope exports',async()=>{
 const h=fixture();await h.start();h.setCatalog([]);h.mod.render();assert.equal(Object.keys(h.mod.capture().cache).length,0);assert.equal(h.mod.canExport(),false);h.setCatalog([{...AR,source:'kb',capabilities:{channelStatusAvailable:true}}]);h.setHandler(()=>response({...AR,source:'kb',capabilities:{channelStatusAvailable:true}}));await h.start();assert.equal(h.calls.length,2);assert.equal(h.mod.capture().source,'YASH');assert(headers(h.mod.render()).includes('近10分钟成功率'));
});

test('capture/restore keeps per-platform cache, local controls and original freshness without refetch',async()=>{
 const h=fixture();await h.start();h.context.liveChannelTab('withdraw');h.context.liveChannelCategory('qr');h.context.liveChannelPageSize('50');const saved=h.mod.capture();h.mod.clear();h.setNow('2026-10-09T05:01:00Z');h.mod.restore(saved);h.mod.render();await flush();assert.equal(h.calls.length,1);assert.equal(h.mod.capture().tab,'withdraw');assert.equal(h.mod.capture().category,'qr');assert.equal(h.mod.capture().size,50);assert.equal(exported(h)[0]['快照采集时间'],NOW);h.unload();assert.equal(Object.keys(h.mod.capture().cache).length,0);assert(h.timers.every(t=>!t.active));
});

test('source sorting, legacy category fallback and complete escaped metadata are directly readable',async()=>{
 const note='<script>unsafe</script>'+ 'detail'.repeat(30),rows=[channel('second',{source_position:2,enabled:true,channel_categories:null}),channel('first',{source_position:1,enabled:false,channel_categories:undefined,category_name:'Legacy category',channel_name:'Display first <img src=x>',source_channel_name:'Hidden native',notes:note})],h=fixture({handler:()=>response(AR,rows)});await h.start();const html=h.mod.render();assert(html.indexOf('Display first')<html.indexOf('Display second'));assert.match(html,/Legacy category/);assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert(firstTableRow(html)['备注'].endsWith('detail'.repeat(30)));assert.doesNotMatch(html,/<script>|<img src=x>|collapsed|liveChannelSourceDetail|channel-source-details|onclick="liveChannelToggle/);
});

test('missing snapshot, incomplete snapshot and complete empty snapshot keep separate indicators',async()=>{
 const h=fixture({handler:()=>response(AR,[],{snapshots:[{platformId:AR.id,source:'ar_middle',direction:'charge',observedAt:null,complete:false,sourceCount:null,channels:[]}]})});await h.start();assert.match(h.mod.render(),/尚未收到快照/);assert.match(h.mod.render(),/尚未收到完整通道快照/);h.setHandler(()=>response(AR,[]));await h.mod.load();assert.match(h.mod.render(),/0 个当前通道/);assert.match(h.mod.render(),/已采集，暂无通道/);
});

const navigationPrefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0].replace('vm.runInContext(source,context',"vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin-preview/live-channel-status.js'),'utf8'),context);vm.runInContext(source,context");
const {harness,settle}=new Function('require','__dirname',navigationPrefix+';return {harness,settle};')(require,__dirname);
function integrated(options={}){const catalog=options.catalog||[AR],access=options.access||{mode:'owner',canView:true,permissions:[]};return harness({page:'channel_status',roleAccess:access,roleAllowed:()=>true,...options,handler:q=>q.action==='catalog'?{platforms:catalog}:q.action==='channelStatus'?response(catalog.find(p=>p.id===q.platformIds[0])):{}});}

test('live host uses full visible catalog, hides shared filters, automatically loads only one platform and restores the tab without IO',async()=>{
 const catalog=Array.from({length:42},(_,i)=>platform(i+1)),h=integrated({catalog});await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog','channelStatus']);assert.equal(h.calls[1].platformIds.length,1);assert.equal(h.nodes.get('liveFilters').style.display,'none');assert.match(h.html(),/共 42 个/);assert.equal(h.L.pageQueried,true);assert.equal(h.L.dirty,false);h.c.liveExport();assert.equal(h.blobs.length,1);h.c.setPage('overview');h.c.setPage('channel_status');await settle();assert.match(h.html(),/Display one/);assert.equal(h.calls.filter(q=>q.action==='channelStatus').length,1);h.c.liveReset();await settle();assert.equal(h.calls.filter(q=>q.action==='channelStatus').length,2);h.c.liveClosePage('channel_status');h.c.setPage('channel_status');await settle();assert.equal(h.calls.filter(q=>q.action==='channelStatus').length,3);
});

test('live host view-only role receives authorized directory but no automatic channel facts or export',async()=>{
 const h=integrated({access:{mode:'assigned',canView:true,permissions:['channel_status.view','channel_status.export']}});await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog']);assert.match(h.html(),/未获查询权限/);assert.doesNotMatch(h.html(),/Display one/);h.c.liveExport();assert.equal(h.blobs.length,0);
});
