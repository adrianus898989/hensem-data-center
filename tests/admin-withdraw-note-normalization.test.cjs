/* Synthetic-only text and SQL integration checks. Never reads a live database. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const repo=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(repo,'admin-preview/live-withdraw-pages.js'),'utf8');
const patch=fs.readFileSync(path.join(repo,'supabase/admin-live-withdraw-note-normalization.sql'),'utf8');
const frontend={module:{exports:{}}};vm.createContext(frontend);vm.runInContext(source,frontend);const text=frontend.module.exports;
let db;const scalar=async(sql,params=[])=>(await db.query(sql,params)).rows[0].value;
const q={country:'印度',platform:'SYNTHETIC',date:'2026-09-01'},call=extra=>scalar('select private.dashboard_admin_live_withdraw_reasons($1::jsonb) value',[JSON.stringify({...q,...extra})]);
const decode=value=>scalar('select private.dashboard_admin_live_decode_note($1) value',[value]);
const clean=value=>scalar('select private.dashboard_admin_live_clean_note($1) value',[value]);
const category=value=>scalar("select private.dashboard_admin_live_rejection_category('IN',$1) value",[value]);
const blocking=value=>scalar('select private.dashboard_admin_live_blocking_category($1) value',[value]);
const lastDeposit=(days,date,limit=30)=>'最后充值日限额超过 当前配置的...\n\n最后充值日限额超过 当前配置的最后充值日限制:'+limit+' 天,最后充值时间：'+date+',当前时间:9/1/2026 12:00:00 AM, 间隔：'+days+' 天';
before(async()=>{
 db=new PGlite();await db.exec(`create schema private;create role anon;create role authenticated;create role service_role;
 create function private.dashboard_admin_live_scope() returns jsonb language sql stable as $$select '{"mode":"all"}'::jsonb$$;
 create function private.dashboard_scope_allows(jsonb,text,text) returns boolean language sql immutable as $$select $2 in ('印度','IN') and $3='SYNTHETIC'$$;
 create function private.dashboard_admin_live_withdraw_key(text) returns text language sql immutable as $$select upper($1)$$;
 create function private.dashboard_admin_live_platforms() returns table(name text,source_name text,country text,scope_group text,source text) language sql stable as $$select 'SYNTHETIC','SYNTHETIC','印度','IN','ar'$$;
 create table public.ar_collected_orders(source_system text,country_code text,platform text,order_kind text,order_no text,amount numeric,status text,operator text,applied_at timestamp,completed_at timestamp,manual_remark text,remark text,raw_channel text,updated_at timestamptz default now());
 create table public.auto_withdraw_daily(country text,data_date date,platform text,total bigint,updated_at timestamptz);
 create table public.dashboard_platform_team_map(country_name text,country_code text,active boolean);
 create table public.withdraw_reasons_daily(country_code text,platform text,stat_date date,source_system text,snapshot jsonb,updated_at timestamptz);
 create view public.withdraw_reasons_daily_grouped as select * from public.withdraw_reasons_daily;
 insert into public.auto_withdraw_daily values('印度','2026-09-01','SYNTHETIC',24,now());`);
 for(const name of ['admin-live-withdraw-templates.sql','admin-live-withdraw-reasons.sql'])await db.exec(fs.readFileSync(path.join(repo,'supabase',name),'utf8'));
 await db.exec(patch);
 const rows=[['[Resubmit Order] Retry request',2],['Resubmit Order ...\n\n&#40;Resubmit Order&#41; Retry request',3],['IFSC Code Incor...\n\n&#40;IFSC Code Incorrect&#41; Check account',4],['【IFSC Code Incorrect】 Check account',5],['Return Rewards]...\n\nReturn Rewards] Duplicate bonus',1],['Return Rewards ...\n\n&amp;#40;Return Rewards&amp;#41; Duplicate bonus',2],['SYNTHETIC-UNKNOWN-NUMBER',3],['An unrelated unclassified note',1]];
 let i=0;for(const [remark,count]of rows)for(let j=0;j<count;j++){i++;await db.query("insert into ar_collected_orders values('AR','IN','SYNTHETIC','withdraw',$1,100,'未通过',$2,'2026-09-01 12:00','2026-09-01 12:01',$3,$4,'',now())",['TEST-'+i,i%2?'operator-a':'operator-b',lastDeposit(i%2?50:70,i%2?'6/1/2026':'5/1/2026'),remark])}
 for(let j=0;j<3;j++)await db.query("insert into ar_collected_orders values('AR','IN','SYNTHETIC','withdraw',$1,100,'已支付','operator-a','2026-09-01 12:00','2026-09-01 12:01',$2,null,'',now())",['SUCCESS-'+j,'会员在限制的游戏类型中总的投注数：'+(j+1)]);
});
after(async()=>{await db?.close()});

test('decimal, hexadecimal, named and doubly encoded notes decode to safe text consistently',async()=>{
 const pairs=[['&#40;IFSC Code Incorrect&#41;','(IFSC Code Incorrect)'],['&#x5b;Resubmit Order&#x5d;','[Resubmit Order]'],['&amp;#40;Return Rewards&amp;#41;','(Return Rewards)'],['&quot;name&quot; &amp; value&nbsp;x','"name" & value x'],['&#0; &#55296; &#1114112; &unknown;','&#0; &#55296; &#1114112; &unknown;'],['&#128512;','😀']];
 for(const [input,expected]of pairs){assert.equal(await decode(input),expected);assert.equal(text.decodeNote(input),expected)}
});

test('only duplicated truncated previews are removed, preserving all distinct original lines',async()=>{
 const notes=[['IFSC Code Incor...\n\n&#40;IFSC Code Incorrect&#41; Check account','(IFSC Code Incorrect) Check account'],['Return Rewards]...\n\nReturn Rewards] Duplicate bonus','Return Rewards] Duplicate bonus'],['Alpha...\nBeta full text\nAdditional explanation','Alpha...\nBeta full text\nAdditional explanation'],['line 1<br>line 2','line 1\nline 2']];
 for(const [input,expected]of notes){assert.equal(await clean(input),expected);assert.equal(text.cleanNote(input),expected)}
});

test('rejection category recognizes full equivalent bracket headings without guessing unrelated remarks',async()=>{
 for(const input of ['[IFSC Code Incorrect] Check account','【IFSC Code Incorrect】 Check account','(IFSC Code Incorrect) Check account','IFSC Code Incor...\n\n&#40;IFSC Code Incorrect&#41; Check account'])assert.equal(await category(input),'IFSC 错误（IFSC Code Incorrect）');
 assert.equal(await category('Return Rewards] Duplicate bonus'),'回归奖励（Return Rewards）');
 assert.equal(await category('Please review: IFSC Code Incorrect maybe applies'),'其他未归类备注');
 assert.equal(await category('Unknown numeric label'),'其他未归类备注');
 assert.equal(await category('[An Unrecognized Heading] Content'),'其他标签 · an unrecognized heading');
});

test('different recharge dates, elapsed days and configured thresholds belong to one blocking rule',async()=>{
 for(const input of [lastDeposit(80,'5/1/2026'),lastDeposit(100,'4/1/2026',60)])assert.equal(await blocking(input),'最后充值日限额超过');
 assert.equal(await blocking('最后充值日限额超过但规则未完整'),'最后充值日限额超过但规则未完整');
 assert.equal(await blocking('会员在限制的游戏类型中总的投注数：15'),'会员在限制的游戏类型中总的投注数');
 assert.equal(await blocking('单日充值次数超过：15'),'单日充值次数超过：15');
});

test('multiple blocking reasons never collapse into only the last-recharge rule',async()=>{
 const complete=lastDeposit(80,'5/1/2026');
 for(const value of [complete+'；会员备注不为空，请检查备注',complete+'\n其他条件：投注异常',complete+'\n'+lastDeposit(120,'4/1/2026'),complete.replace('当前时间:','额外规则：需要人工审核,当前时间:')]){
  assert.equal(await blocking(value),text.cleanNote(value).replace(/\s+/g,' ').trim());
  assert.notEqual(await blocking(value),'最后充值日限额超过');
 }
 for(const suffix of ['',' 。','；  ','!'])assert.equal(await blocking(complete+suffix),'最后充值日限额超过');
});

test('categories, order drilldown and search keep one classification and conserve counts and original fields',async()=>{
 const all=await call({kind:'categories'});assert.equal(all.noteCount,21);assert.equal(all.rows.reduce((n,r)=>n+r.count,0),21);
 const expected=new Map([['重新提交（Resubmit Order）',5],['IFSC 错误（IFSC Code Incorrect）',9],['回归奖励（Return Rewards）',3],['其他未归类备注',4]]);
 for(const row of all.rows){assert.equal(row.count,expected.get(row.category));const orders=await call({kind:'orders',category:row.categoryKey});assert.equal(orders.total,row.count);assert.equal(orders.noteCount,21);assert(orders.rows.every(r=>r.category===row.category));assert.equal(orders.summary.selectedCount,row.count)}
 const orders=await call({kind:'orders'});assert.equal(orders.total,21);assert.equal(orders.rows.length,20);assert.equal((await call({kind:'orders',offset:20})).rows.length,1);
 const encoded=orders.rows.find(r=>r.rawRejectionReason?.includes('&#40;'));assert(encoded);assert.doesNotMatch(encoded.rejectionReason,/&#40;/);assert.match(encoded.rawRejectionReason,/&#40;/);
 assert.equal((await scalar('select count(*)::integer value from ar_collected_orders where remark like $1',['%&#40;%'])),7,'the raw database text is unchanged');
 const searched=await call({kind:'orders',query:'TEST-1'});assert.equal(searched.noteCount,21);assert(searched.rows.every(r=>r.orderNumber.includes('TEST-1')));
});

test('blocking grouping preserves denominator, statuses and source variant evidence',async()=>{
 const result=await call({kind:'blocking'});assert.equal(result.noteCount,24);assert.equal(result.rows.reduce((n,r)=>n+r.count,0),24);
 const recharge=result.rows.find(r=>r.reason==='最后充值日限额超过');assert.equal(recharge.count,21);assert.equal(recharge.sourceVariantCount,2);assert.equal(recharge.rejected,21);assert.match(recharge.sourceReason,/最后充值时间/);
 assert.equal(result.rows.find(r=>r.reason==='会员在限制的游戏类型中总的投注数').count,3);
});

test('helpers are not callable by anonymous/authenticated and existing RPC scope checks still reject foreign platforms',async()=>{
 for(const name of ['decode_note(text)','clean_note(text)','blocking_category(text)','rejection_category(text,text)'])for(const role of ['anon','authenticated'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\') value',[role,'private.dashboard_admin_live_'+name]),false);
 await assert.rejects(()=>call({platform:'FOREIGN',kind:'orders'}),/scope_denied/);
});

test('snapshot-only rows use the same category and blocking normalization without fabricated orders',async()=>{
 const snapshot={note_field:'remark',totals:{reject:7},coverage:{unique_count:7},groups:[{reason_label:'&#40;IFSC Code Incorrect&#41; Check account',reject:3,count:3,success:0,other:0,operator_class:'manual'},{reason_label:'(IFSC Code Incorrect) Check account',reject:4,count:4,success:0,other:0,operator_class:'manual'}]};
 await db.query("insert into withdraw_reasons_daily values('IN','SYNTHETIC','2026-09-02','AR',$1,now())",[JSON.stringify(snapshot)]);
 const result=await call({date:'2026-09-02',kind:'categories'});assert.equal(result.rows.length,1);assert.equal(result.rows[0].count,7);assert.equal(result.canViewOrders,false);assert.equal((await call({date:'2026-09-02',kind:'orders'})).available,false);
});

function uiFixture(reasonData){
 let html='',page;const requests=[],E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const root={Intl,Date,document:{querySelector(){return null},getElementById(){return null}},HensemLiveFilters:{multi(){return ''}}};root.window=root;vm.createContext(root);vm.runInContext(source,root);
 const ctx={L:{catalogReady:true,catalog:[{country:'印度',name:'SYNTHETIC'}],country:'印度',from:'2026-09-01T00:00:00',to:'2026-09-01T23:59:59'},E,N:String,C:String,R:(n,d)=>d?String(n/d*100)+'%':'—',page:()=> 'auto_withdraw',box:(_,body)=>body,table:(headers,rows)=>'<table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>',request:async q=>{requests.push(q);return reasonData},render(){html=page.render()}};
 page=root.HensemLiveWithdrawPages.create(ctx);page.state.data={country:'印度',rows:[{country:'印度',platform:'SYNTHETIC'}],totals:{},notes:[]};
 page.state.reason={...q,kind:'orders'};page.state.reasonData=reasonData;ctx.render();return {root,page,requests,html:()=>html,draw:ctx.render};
}

test('UI shows decoded escaped full remarks and never injects source HTML',()=>{
 const malicious='&#40;IFSC Code Incorrect&#41; '+ '&lt;img src=x onerror=alert(1)&gt;'+' Long content'.repeat(20);
 const h=uiFixture({available:true,source:'Synthetic',noteCount:1,total:1,rows:[{orderNumber:'TEST-1',category:'IFSC 错误（IFSC Code Incorrect）',rejectionReason:malicious}],summary:{totalRejected:1},coverage:{}});
 assert.match(h.html(),/\(IFSC Code Incorrect\)/);assert.match(h.html(),/&lt;img/);assert.doesNotMatch(h.html(),/<img|&amp;#40;/);
 h.root.withdrawReasonOriginal(malicious);assert.match(h.html(),/aria-label="驳回原文"/);assert.match(h.html(),/Long content Long content/);assert.doesNotMatch(h.html(),/<img/);
});

test('category drilldown sends the selected category key and preserves the full-data denominator',async()=>{
 const categoryKey='a'.repeat(32),h=uiFixture({available:true,source:'Synthetic',noteCount:100,total:1,canViewOrders:true,rows:[{categoryKey,category:'IFSC 错误（IFSC Code Incorrect）',sourceReason:'(IFSC Code Incorrect) Check',count:9}],summary:{totalRejected:100},coverage:{}});
 h.page.state.reason.kind='categories';h.draw();h.root.withdrawReasonDrill(0,'category');await new Promise(r=>setImmediate(r));
 assert.equal(h.requests[0].kind,'orders');assert.equal(h.requests[0].category,categoryKey);assert.equal(h.page.state.reason.category,categoryKey);assert.match(h.html(),/100 笔驳回订单/);
});


test('grouped blocking rules open an explicitly labeled full original sample',()=>{
 const original=lastDeposit(123,'5/1/2026');
 const h=uiFixture({available:true,source:'Synthetic',noteCount:8,total:1,rows:[{reason:'最后充值日限额超过',sourceReason:original,sourceVariantCount:2,count:8}],coverage:{collected:8}});
 h.page.state.reason.kind='blocking';h.draw();assert.match(h.html(),/已合并 2 种原文/);assert.match(h.html(),/>最后充值日限额超过<\/button>/);
 h.root.withdrawReasonOriginal(original,'自动出款拦截原文（代表样本）');assert.match(h.html(),/aria-label="自动出款拦截原文（代表样本）"/);assert.match(h.html(),/最后充值时间：5\/1\/2026/);
});
