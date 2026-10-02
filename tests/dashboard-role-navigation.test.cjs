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

test('retired channelquality never appears or gains permission through a bookmark or programmatic navigation',async()=>{
 const h=harness(options(['channelquality.view','channelquality.query','amount.view'],'channelquality'));await settle();assert.deepEqual(Array.from(h.c.pages,p=>p[0]),['amount']);assert.equal(h.c.state.page,'amount');h.c.setPage('channelquality');assert.equal(h.c.state.page,'amount');assert(!h.c.navGroupsV3.some(g=>g[3].includes('channelquality')));assert.equal(h.calls.filter(q=>q.action!=='catalog').length,0);
 const allowed=harness(options(['providers.view','providers.query'],'channelquality'));await settle();assert.equal(allowed.c.state.page,'providers');assert(!allowed.c.pages.some(p=>p[0]==='channelquality'));
 const denied=harness(options(['channelquality.view'],'channelquality'));await settle();assert.equal(denied.calls.length,0);assert.match(denied.nodes.get('page').textContent,/没有.*目录|无.*目录/);
});

test('account and standalone system shells render immediately without a business catalog',async()=>{
 for(const page of ['access','rules','ip','login_logs','operation_logs']){const h=harness(options([page+'.view'],page));await settle();assert.equal(h.calls.length,0,page);assert.equal(h.L.catalogReady,false);assert.match(h.html(),new RegExp('hle-'+page));assert.doesNotMatch(h.html(),/正在读取账号可见的平台目录|平台目录未读取成功/);}
});

test('the stable stuck permission and deep link live under data analysis without an automatic query',async()=>{
 const riskFixture=prefix.replace("['analysis','','数据分析',keys.filter(k=>!merchantKeys.includes(k))]","['risk','','智能风控', ['stuck']],['analysis','','数据分析',keys.filter(k=>k!=='stuck'&&!merchantKeys.includes(k))]").replace("navGroup:'analysis'","navGroup:'risk'");assert.notEqual(riskFixture,prefix);
 const migrated=new Function('require','__dirname',riskFixture+';return {harness};')(require,__dirname);
 const h=migrated.harness(options(['stuck.view','stuck.query','stuck.detail'],'stuck'));await settle();
 assert.deepEqual(Array.from(h.c.pages,p=>p[0]),['stuck']);assert.equal(h.c.state.page,'stuck');
 assert.equal(h.c.state.navGroup,'analysis');assert(h.c.navGroupsV3.find(g=>g[0]==='analysis').at(3).includes('stuck'));
 assert(!h.c.navGroupsV3.some(g=>g[0]!=='analysis'&&g[3].includes('stuck')));
 assert.equal(h.c.groupForV3('stuck')[0],'analysis');assert.deepEqual(h.calls.filter(q=>q.action!=='catalog'),[]);
 h.c.render();assert.match(h.nodes.get('nav').innerHTML,/stuck/);assert.match(h.nodes.get('crumbTitle').textContent,/数据分析.*代付中分析/);
});
