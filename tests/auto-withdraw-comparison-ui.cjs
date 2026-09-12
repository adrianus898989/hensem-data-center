/* Read-only local visual QA. All data/auth APIs are mocked and external requests blocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const origin = process.env.UI_TEST_ORIGIN || 'http://127.0.0.1:3112';
const output = path.join(__dirname, '../outputs');
const specs = [
  ['92LOTTERY',3290,1928,72,3100,1650,94,'2分42秒','2分37秒','+3.18%'],
  ['VN168',1725,849,21,1630,864,19,'3分12秒','3分12秒','0.00%'],
  ['82VN',1426,464,44,1510,430,46,'4分0秒','3分55秒','+2.13%'],
  ['98VV',1334,28,42,1250,16,37,'3分19秒','3分23秒','-1.97%'],
  ['66CLUB',1224,632,41,1190,608,49,'3分16秒','3分18秒','-1.01%'],
  ['XX98',520,5,10,600,13,14,'3分28秒','3分26秒','+0.97%'],
  ['COINVID',146,0,8,148,0,7,'7分47秒','9分59秒','-22.04%'],
];
const makeRow = ([platform,total,autoCount,rejected,priorTotal,priorAuto,priorRejected,avgTime,yesterdayAvgTime,comparePercent]) => ({
  date:'2026-09-10',country:'越南',platform,total,autoCount,manualCount:total-autoCount,
  success:total-rejected,rejected,successRate:(total-rejected)/total,rejectRate:rejected/total,
  autoRate:autoCount/total,manualRate:(total-autoCount)/total,avgTime,yesterdayAvgTime,comparePercent,
  sourceSheet:'local-visual-fixture',blockTitle:'2026-09',
  previousDay:{date:'2026-09-09',total:priorTotal,autoCount:priorAuto,manualCount:priorTotal-priorAuto,success:priorTotal-priorRejected,rejected:priorRejected},
});
let rows = specs.map(makeRow);
(async () => {
  fs.mkdirSync(output,{recursive:true});
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const context = await browser.newContext({viewport:{width:1668,height:1050},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
    await context.addInitScript(() => {
      const t = new Date('2026-09-11T08:00:00Z').getTime();
      localStorage.setItem('hensem:dashboard:auth-session:v2',JSON.stringify({access_token:'local-ui-token',refresh_token:'local-ui-refresh',expires_in:3600,expires_at:t/1000+3600,user:{id:'test-admin'}}));
      localStorage.setItem('hensem.dashboard.last_activity',String(t));
    });
    const writes=[];
    await context.route('**/*',async route => {
      const req=route.request();const url=new URL(req.url());
      const json=body=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
      if(url.hostname.endsWith('supabase.co')) {
        assert.equal(url.hostname,'ui-test.supabase.co');
        if(req.method()==='OPTIONS') return json({});
        if(url.pathname==='/auth/v1/token') return json({access_token:'local-ui-token',refresh_token:'local-ui-refresh',expires_in:3600,user:{id:'test-admin'}});
        if(url.pathname.includes('dashboard_profiles')) return json([{auth_user_id:'test-admin',username:'本地样本',role:'owner',active:true,permissions:{home:true,auto_withdraw:true}}]);
        if(url.pathname.includes('functions/v1/')) {
          const action=req.postDataJSON()?.action;
          assert.ok(['check-access','history-status','auto-withdraw-history-status'].includes(action),'only read-only auth/status actions');
          return json({ok:true,allowed:true,history:null});
        }
        if(req.method()!=='GET') writes.push(url.pathname);
        return json([]);
      }
      if(url.origin===origin && url.pathname==='/api/auto-withdraw') return json({meta:{year:'2026',month:'09',source:'supabase',updatedAt:'2026-09-11T08:00:00Z',message:'本地演示数据，非实际业务统计'},dailyRows:rows,monthlyRows:[],operatorRows:[]});
      if(url.origin===origin && url.pathname==='/api/monthly-status') return json({});
      if(url.origin===origin || ['data:','blob:'].includes(url.protocol)) return route.continue();
      return route.abort();
    });
    const page=await context.newPage();
    await page.clock.setFixedTime(new Date('2026-09-11T08:00:00Z'));
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);
    await page.getByRole('button',{name:/提现\/自动出款统计/}).click({timeout:60000});
    await page.getByRole('button',{name:'越南盘口',exact:true}).click();
    await page.locator('.aw-rate-compare').first().waitFor();
    await page.locator('.auto-note-cell-button').first().waitFor();
    assert.match(await page.locator('.aw-daily-summary').innerText(),/对比 2026-09-09/);
    assert.equal(await page.locator('.aw-rate-compare').count(),28);
    assert.match(await page.locator('.auto-withdraw-daily-compact tbody tr').first().innerText(),/53.23%/);
    assert.match(await page.locator('.auto-withdraw-daily-compact tbody tr').first().innerText(),/5.38 pp/);
    assert.equal(await page.locator('.aw-rate-previous.is-unavailable').count(),0);
    assert.ok((await page.locator('.aw-comparison-legend').innerText()).includes('百分点'));
    const layout=await page.locator('.auto-withdraw-daily-compact').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,bodyWidth:document.body.scrollWidth,viewport:window.innerWidth}));
    assert.ok(layout.bodyWidth<=layout.viewport+2,'no document-level horizontal overflow');
    assert.ok(layout.scroll<=layout.width+2,'desktop sample shows all columns without horizontal scrolling');
    const actions=await page.locator('.wr-row-actions').first().locator('button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
    assert.equal(actions.length,2);
    assert.ok(Math.abs(actions[0].y-actions[1].y)<2,'reason and daily-detail actions share one line');
    assert.ok(actions[1].x>=actions[0].x+actions[0].width,'daily-detail action is to the right of reason action');
    await page.evaluate(()=>{const el=document.createElement('div');el.textContent='排版样本 · 模拟数据（10 日对比 9 日）';el.style.cssText='position:fixed;right:16px;bottom:12px;background:#10284a;color:white;padding:7px 12px;border-radius:6px;font-size:12px;z-index:99999';document.body.append(el);});
    await page.screenshot({path:path.join(output,'auto-withdraw-comparison-sample.png'),fullPage:true});
    await page.locator('.wr-row-actions').first().getByRole('button',{name:'展开原因',exact:true}).click();
    await page.locator('.wr-expanded-row').first().waitFor();
    await page.locator('.wr-row-actions').first().getByRole('button',{name:'收起原因',exact:true}).click();
    await page.locator('.wr-expanded-row').waitFor({state:'detached'});
    await page.locator('.wr-row-actions').first().getByRole('button',{name:'日明细',exact:true}).click();
    await page.getByRole('heading',{name:'越南 92LOTTERY 每日明细',exact:true}).waitFor();
    // The existing modal styles visually replace "关闭" with a pseudo-element ×.
    await page.locator('.detail-modal-header > button').click();
    await page.locator('.detail-modal').waitFor({state:'detached'});
    // Date-range and missing-baseline cases must never pretend yesterday is zero.
    await page.locator('input[type="date"]').nth(0).fill('2026-09-09');
    await page.getByRole('button',{name:'查询',exact:true}).click();
    await page.getByText('当前为区间累计 · 选择单日可查看与前一日的占比变化').waitFor();
    assert.equal(await page.locator('.aw-rate-previous').count(),0);
    rows=specs.map(makeRow);rows[0].previousDay=null;
    await page.reload();
    await page.getByRole('button',{name:/提现\/自动出款统计/}).click();
    await page.getByRole('button',{name:'越南盘口',exact:true}).click();
    await page.getByText('无对比数据',{exact:true}).first().waitFor();
    assert.equal(await page.locator('.aw-rate-previous.is-unavailable').count(),4);
    assert.match(await page.locator('.aw-daily-summary').innerText(),/覆盖 6\/7 平台/);
    await page.setViewportSize({width:1280,height:850});
    assert.ok(await page.evaluate(()=>document.body.scrollWidth<=window.innerWidth+2));
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
    console.log(JSON.stringify({ok:true,layout,errors,writes,sample:path.join(output,'auto-withdraw-comparison-sample.png')}));
    await context.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
