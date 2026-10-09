const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-withdraw-pages.js'),'utf8');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
const response={available:true,source:'SYNTHETIC',total:42,noteCount:42,canViewOrders:true,canViewBlockingOrders:true,rows:[{reason:'规则',reasonKey:'a'.repeat(32),count:42}],summary:{operatorCounts:{total:42,manual:42,manualWithReason:42,manualWithoutReason:0}}};
function fixture(){
 let fullPaints=0,drawerHtml='',drawerBody=null,active=null,resolve,reject;
 const requests=[],focuses=[],table={scrollLeft:670,scrollTop:135},trigger={focus:options=>{focuses.push(options);active='trigger'}};
 const host={querySelector:selector=>selector==='.withdraw-drawer-body'?drawerBody:null};
 Object.defineProperty(host,'innerHTML',{get:()=>drawerHtml,set:html=>{drawerHtml=html;drawerBody=html.includes('withdraw-drawer-body')?{scrollLeft:0,scrollTop:0}:null}});
 const dialog={focus:options=>{focuses.push(options);active='drawer'}},original={querySelector:()=>({focus:options=>{focuses.push(options);active='original'}})};
 const context={Date,Intl,scrollX:12,scrollY:710,document:{getElementById:id=>id==='withdraw-reason-overlay'?host:id==='withdraw-reasons'&&drawerBody?dialog:null,querySelector:selector=>selector.startsWith('[data-withdraw-reason=')?trigger:selector==='.withdraw-original-dialog'?original:null},HensemLiveFilters:{multi:()=>''}};
 context.window=context;context.scrollTo=(x,y)=>{context.scrollX=x;context.scrollY=y};vm.createContext(context);vm.runInContext(source,context);
 const page=context.HensemLiveWithdrawPages.create({L:{catalogReady:true,catalog:[{country:'印度',name:'SYNTHETIC'}],country:'印度',from:'2026-10-08T00:00:00',to:'2026-10-08T23:59:59'},E:String,C:String,N:String,R:(n,d)=>d?n/d+'':'—',box:(_t,html)=>html,table:(head,rows)=>'<table>'+rows.flat().join('')+'</table>',page:()=> 'auto_withdraw',request:q=>{requests.push(q);return new Promise((a,b)=>{resolve=a;reject=b})},render:()=>{fullPaints++;context.scrollY=0;table.scrollLeft=0;table.scrollTop=0}});
 page.state.data={rows:[{country:'印度',platform:'SYNTHETIC'}],totals:{},notes:[]};
 return {context,page,requests,host,table,focuses,body:()=>drawerBody,html:()=>drawerHtml,fullPaints:()=>fullPaints,active:()=>active,resolve:data=>resolve(data||response),reject:error=>reject(error)};
}
function unchanged(h){assert.equal(h.fullPaints(),0,'detail actions must not replace the platform table');assert.equal(h.context.scrollX,12);assert.equal(h.context.scrollY,710);assert.equal(h.table.scrollLeft,670);assert.equal(h.table.scrollTop,135);assert(h.focuses.every(options=>options?.preventScroll===true));}
test('opening, asynchronous loading, switching tabs, cached reopening and closing preserve both background scroll axes',async()=>{
 const h=fixture();assert.match(h.page.render(),/id="withdraw-reason-overlay"/);
 h.context.withdrawReasons(0);unchanged(h);assert.match(h.html(),/正在读取/);h.resolve();await settle();unchanged(h);assert.match(h.html(),/规则/);
 h.context.withdrawReasonKind('categories');unchanged(h);h.resolve();await settle();unchanged(h);
 h.context.withdrawReasonClose();unchanged(h);assert.equal(h.html(),'');assert.equal(h.active(),'trigger');
 const reads=h.requests.length;h.context.withdrawReasons(0);await settle();unchanged(h);assert.equal(h.requests.length,reads,'cached reopening also avoids a background paint');assert.match(h.html(),/规则/);
});
test('source-original dialogs retain the drawer scroll position as well as the platform table',async()=>{
 const h=fixture();h.context.withdrawReasons(0);h.resolve();await settle();h.body().scrollTop=408;h.body().scrollLeft=84;
 h.context.withdrawReasonOriginal('完整原文');unchanged(h);assert.equal(h.body().scrollTop,408);assert.equal(h.body().scrollLeft,84);assert.equal(h.active(),'original');
 h.context.withdrawReasonOriginalClose();unchanged(h);assert.equal(h.body().scrollTop,408);assert.equal(h.body().scrollLeft,84);assert.equal(h.active(),'drawer');
});
test('failure, retry, pagination and rule drilldown update only the reason drawer',async()=>{
 const h=fixture();h.context.withdrawReasons(0);h.reject(new Error('读取失败'));await settle();unchanged(h);assert.match(h.html(),/读取失败/);
 h.context.withdrawReasonRetry();h.resolve();await settle();unchanged(h);
 h.context.withdrawReasonPage(2);assert.equal(h.requests.at(-1).offset,20);h.resolve();await settle();unchanged(h);
 h.context.withdrawBlockingDrill(0,'blockingVariants');h.resolve();await settle();unchanged(h);assert.equal(h.requests.at(-1).reasonKey,'a'.repeat(32));
});
test('closing during an outstanding read keeps the drawer closed when its late response arrives',async()=>{
 const h=fixture();h.context.withdrawReasons(0);h.context.withdrawReasonClose();unchanged(h);assert.equal(h.html(),'');h.resolve();await settle();unchanged(h);assert.equal(h.html(),'');assert.equal(h.page.state.reason,null);
});
