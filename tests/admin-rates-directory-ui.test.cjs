// Production rates UI, synthetic RPC replies; no browser, credentials or data.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const fixture=path.join(__dirname,'admin-rates-refresh-ui.test.cjs');
const {setup,metadata,grid,deferred}=new Function('require','__dirname',fs.readFileSync(fixture,'utf8').split(/\ntest\(/)[0]+';return {setup,metadata,grid,deferred};')(createRequire(fixture),__dirname);
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
const vm=require('node:vm');
function renderedFilterHandlers(h){
 const html=h.api.render(),form=html.match(/<form class="original-rates-filters"[^>]*>/)?.[0],button=html.match(/<button\b[^>]*>查询<\/button>/)?.[0];
 assert(form&&button,'the actual production filter form and query button are rendered');
 assert.match(button,/type="button"/);assert.doesNotMatch(button,/type="submit"/);
 const execute=(markup,name,event)=>{const code=markup.match(new RegExp(name+'="([^"]+)"'))?.[1];assert(code,'rendered '+name+' exists');return vm.runInNewContext(code,{HensemLiveRatesRestored:h.api,event});};
 return {click:()=>execute(button,'onclick'),key:event=>execute(form,'onkeydown',event),submit:event=>execute(form,'onsubmit',event)};
}
const queryKey=extra=>({key:'Enter',repeat:false,isComposing:false,target:{tagName:'INPUT',getAttribute:name=>name==='data-rates-filter'?'query':null},preventDefault(){this.prevented=true},...extra});

test('mounted original rates initialize only the sheet directory; selecting a country still requires explicit grid query',async()=>{
 const h=setup();await settle();assert.deepEqual(h.calls,[{action:'ratesSheet'}]);assert.match(h.api.render(),/>Synthetic Sheet 1<\/button>/);assert.match(h.api.render(),/>Synthetic Sheet 2<\/button>/);assert.equal(h.api.snapshot().hasGrid,false);assert.equal(h.api.snapshot().autoRefresh,false);assert.equal(h.timers.size,0);
 h.api.selectSheet(2);await settle();assert.equal(h.calls.length,1);assert.match(h.api.render(),/选择国家页签后点击查询/);await h.api.load();assert.deepEqual(h.calls.slice(-2),[{action:'ratesSheet'},{action:'ratesSheet',sheetId:2}]);assert.equal(h.api.snapshot().sheetId,2);assert.equal(h.api.snapshot().hasGrid,true);
});

test('directory failure is visible, escaped and explicitly retryable without cached failure or automatic retry storm',async()=>{
 const h=setup();h.setHandler(async()=>{throw Error('Synthetic <unavailable>')});await settle();assert.equal(h.calls.length,1);assert.match(h.api.render(),/国家页签目录读取失败/);assert.match(h.api.render(),/Synthetic &lt;unavailable&gt;/);assert.match(h.api.render(),/aria-label="重试读取国家页签"/);for(let i=0;i<3;i++)h.api.render();await settle();assert.equal(h.calls.length,1);assert.equal(h.api.snapshot().hasGrid,false);assert.equal(h.timers.size,0);
 const pending=deferred();h.setHandler(()=>pending.promise);const retry=h.api.retryDirectory();await h.api.retryDirectory();await settle();assert.equal(h.calls.length,2);pending.resolve(metadata());await retry;assert.match(h.api.render(),/Synthetic Sheet 2/);assert.equal(h.api.snapshot().error,'');assert.equal(h.api.snapshot().hasGrid,false);assert.doesNotMatch(h.api.render(),/重试读取国家页签/);
});

test('explicit query during initialization shares the metadata request and reads only the selected grid',async()=>{
 const h=setup(),pending=deferred();h.setHandler(q=>q.sheetId===undefined?pending.promise:Promise.resolve(grid(q.sheetId)));await settle();assert.equal(h.calls.length,1);const query=h.api.load(2);await settle();assert.equal(h.calls.length,1);pending.resolve(metadata());await query;assert.deepEqual(h.calls,[{action:'ratesSheet'},{action:'ratesSheet',sheetId:2}]);assert.equal(h.api.snapshot().sheetId,2);assert.equal(h.api.snapshot().hasGrid,true);
});

test('a failed manual directory read recovers without retaining its old error or reading a grid',async()=>{
 const h=setup();h.setHandler(async()=>{throw Error('Synthetic metadata timeout')});await h.api.load();assert.match(h.api.render(),/重试读取国家页签/);h.setHandler(async()=>metadata());await h.api.retryDirectory();assert.equal(h.api.snapshot().error,'');assert.match(h.api.render(),/Synthetic Sheet 2/);assert.equal(h.api.snapshot().hasGrid,false);assert(h.calls.every(q=>q.sheetId===undefined));
});

test('paused or detached pages do not initialize; closing rejects old directory response and reentry can retry',async()=>{
 const inactive=setup();inactive.flags.active=false;await settle();assert.equal(inactive.calls.length,0);inactive.flags.active=true;inactive.setMounted(false);inactive.api.render();await settle();assert.equal(inactive.calls.length,0);
 const h=setup(),pending=deferred();h.setHandler(()=>pending.promise);await settle();h.api.pause();pending.resolve(metadata());await settle();assert.doesNotMatch(h.api.render(),/Synthetic Sheet/);assert.equal(h.api.snapshot().loading,false);h.api.clear();await settle();assert.equal(h.calls.length,1);h.setHandler(async()=>metadata());h.api.resume();await settle();assert.equal(h.calls.length,2);assert.match(h.api.render(),/Synthetic Sheet 1/);assert.equal(h.api.snapshot().hasGrid,false);
});

test('restricted accounts never initialize original metadata; identity change rejects the old directory',async()=>{
 const restricted=setup({restricted:true});await settle();assert.equal(restricted.calls.length,0);await restricted.api.retryDirectory();assert.equal(restricted.calls.length,0);
 const h=setup(),pending=deferred();h.setHandler(()=>pending.promise);await settle();h.flags.restricted=true;h.flags.identity='Another restricted actor';h.api.render();pending.resolve(metadata());await settle();assert.deepEqual(h.calls,[{action:'ratesSheet'}]);assert.doesNotMatch(h.api.render(),/Synthetic Sheet/);assert.equal(h.api.snapshot().sourceMode,'scoped');assert.equal(h.api.snapshot().hasGrid,false);
});

test('permission failures clear old metadata and grids; retry cannot recover wider scope after restriction',async()=>{
 const h=setup();await h.api.load();h.setHandler(async()=>{throw Object.assign(Error('permission_denied'),{status:403})});await h.api.load();await settle();assert.equal(h.api.snapshot().hasGrid,false);assert.doesNotMatch(h.api.render(),/Synthetic Sheet|Synthetic-0/);assert.match(h.api.render(),/重试读取国家页签/);const n=h.calls.length;h.flags.restricted=true;h.flags.identity='Restricted actor';await h.api.retryDirectory();assert.equal(h.calls.length,n);assert.equal(h.api.snapshot().sourceMode,'scoped');
});

test('valid empty or malformed directories do not pretend that countries or fee rows are present',async()=>{
 const empty=setup();empty.setHandler(async()=>({...metadata(),sheets:[]}));await settle();assert.match(empty.api.render(),/暂无国家页签/);assert.equal(empty.api.snapshot().hasGrid,false);assert.equal(empty.calls.length,1);
 const invalid=setup();invalid.setHandler(async()=>({...metadata(),sheets:[{sheetId:1,title:'Synthetic',index:0},{sheetId:1,title:'Duplicate',index:1}]}));await settle();assert.match(invalid.api.render(),/原表目录格式无效/);assert.match(invalid.api.render(),/重试读取国家页签/);assert.equal(invalid.api.snapshot().hasGrid,false);
});

test('rendered query click reads original and restricted rates without native form submission',async()=>{
 for(const restricted of [false,true]){
  const h=setup({restricted});
  if(restricted)h.setHandler(async q=>({version:1,basis:'current_rate_table',asOf:'2026-10-11T00:00:00Z',rows:[],total:0,offset:q.offset,limit:q.limit,hasMore:false,options:{countries:[],platforms:[]}}));
  else await settle();
  const handlers=renderedFilterHandlers(h),before=h.calls.length,submit={preventDefault(){this.prevented=true}};
  // A sandbox without allow-forms blocks native submission. No submit event is
  // necessary: execute the real rendered click handler, then a separate submit
  // handler to prove it only suppresses navigation and cannot read twice.
  await handlers.click();assert.equal(h.api.snapshot().hasGrid,true);
  assert.deepEqual(h.calls.slice(before),restricted?[{action:'rates',scopeType:'all',offset:0,limit:20}]:[{action:'ratesSheet'},{action:'ratesSheet',sheetId:1}]);
  const after=h.calls.length;handlers.submit(submit);assert.equal(submit.prevented,true);assert.equal(h.calls.length,after);
 }
});

test('rendered search Enter reads once and suppresses implicit submission; IME, other controls and pending reads cannot duplicate it',async()=>{
 const h=setup();await settle();h.api.set('query','Synthetic');const handlers=renderedFilterHandlers(h),pending=deferred();h.setHandler(q=>q.sheetId===undefined?Promise.resolve(metadata()):pending.promise);
 const enter=queryKey(),loading=handlers.key(enter);assert.equal(enter.prevented,true);await settle();assert.deepEqual(h.calls.slice(-2),[{action:'ratesSheet'},{action:'ratesSheet',sheetId:1}]);
 const during=h.calls.length;const second=queryKey();await handlers.key(second);assert.equal(second.prevented,true);assert.equal(h.calls.length,during);
 pending.resolve(grid(1));await loading;assert.equal(h.api.snapshot().query,'Synthetic');assert.equal(h.api.snapshot().hasGrid,true);
 const count=h.calls.length;
 for(const extra of [{key:'a'},{isComposing:true},{keyCode:229},{repeat:true},{target:{tagName:'SELECT'}},{target:{tagName:'BUTTON'}},{target:{tagName:'TEXTAREA'}},{target:{tagName:'INPUT',getAttribute:()=>null}}])await handlers.key(queryKey(extra));
 h.api.pause();await handlers.key(queryKey());assert.equal(h.calls.length,count);
});
