const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prefix=fs.readFileSync(path.join(__dirname,'admin-navigation-performance.test.cjs'),'utf8').split(/\ntest\(/)[0];
const {harness,settle}=new Function('require','__dirname',prefix+';return {harness,settle};')(require,__dirname);
function options(permissions,page='overview'){
 return {page,roleAccess:{mode:'assigned',canView:true,permissions},roleAllowed:(page,action='view')=>permissions.includes(page+'.view')&&permissions.includes(page+'.'+action)};
}
test('assigned account sees only granted pages and deep links cannot switch to hidden pages',async()=>{
 const h=harness(options(['providers.view','providers.query','amount.view']));await settle();
 assert.deepEqual(Array.from(h.c.pages,p=>p[0]).sort(),['amount','providers']);
 assert.equal(h.c.state.page,'providers');assert(!h.c.navGroupsV3.some(g=>g[3].some(id=>!['providers','amount'].includes(id))));
 h.c.setPage('access');assert.equal(h.c.state.page,'providers');
 h.c.setPage('amount');assert.equal(h.c.state.page,'amount');
 assert.deepEqual(h.calls.filter(q=>q.action!=='catalog'),[]);
});
test('closing all or the last page returns to a permitted page when overview is not granted',async()=>{
 const h=harness(options(['providers.view','amount.view']));await settle();
 h.c.setPage('amount');h.c.liveCloseAllPages();assert.equal(h.c.state.page,'providers');
 assert.match(h.nodes.get('livePageTabs').innerHTML,/providers/);
 h.c.liveClosePage('providers');assert.equal(h.c.state.page,'providers');
 assert.match(h.nodes.get('livePageTabs').innerHTML,/providers/);
});
test('export is absent and its callable handler cannot create a download without permission',async()=>{
 const h=harness(options(['providers.view','providers.query']));await settle();h.c.render();
 assert.doesNotMatch(h.nodes.get('.title-actions').innerHTML,/导出/);h.c.liveExport();assert.equal(h.blobs.length,0);
});
test('a role with no granted directory renders an explicit denial without loading selection or order data',async()=>{
 const h=harness(options([]));await settle();assert.equal(h.calls.length,0);assert.match(h.nodes.get('page').textContent,/没有.*目录|无.*目录/);
});

test('account-only role does not request business catalog and later granted business page initializes normally',async()=>{
 const h=harness(options(['access.view','providers.view'],'access'));await settle();
 assert.equal(h.calls.length,0);assert.equal(h.L.catalogError,'');
 h.c.setPage('providers');await settle();assert.deepEqual(h.calls.map(q=>q.action),['catalog']);
});
