const {test, before, after, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
const {randomUUID} = require('node:crypto');

const fixtureDir = path.join(__dirname, 'fixtures/deposit-tickets-nov09');
const migrations = path.join(__dirname, '../supabase/migrations');
const migrationsUnderTest = [
  '20261109093000_deposit_ticket_list.sql',
  '20261109100500_deposit_ticket_identifier_latency.sql',
  '20261111121301_deposit_ticket_source_fields.sql',
  '20261111123316_deposit_ticket_native_platforms.sql',
];
const actor = '00000000-0000-0000-0000-000000000011';
const permissions = ['workorders.view','workorders.query','workorders.detail'];
const scope = {IN:['arOne','newOne','futureNew','nonTicket']};
const filters = {from:'2026-11-07',to:'2026-11-08'};
let db;

async function configure(name, value) {
  await db.query('select set_config($1,$2,true)', ['test.'+name,typeof value==='string'?value:JSON.stringify(value)]);
}
async function request(extraFilters={}, options={}) {
  const input={view:'depositTickets',operation:'list',country:'IN',filters:{...filters,...extraFilters},limit:20,offset:0,...options};
  const r=await db.query("select public.dashboard_admin_execute('workorders',$1) as data", [JSON.stringify(input)]);
  return r.rows[0].data;
}
async function insert(table,row) {
  const keys=Object.keys(row);
  await db.query('insert into '+table+' ('+keys.join(',')+') values ('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(row));
}
async function ar(id, fields={}) {
  await insert('public.ar_workorder_issue_details',{
    system_name:'AR',country_code:'IN',country:'印度',platform:'arOne',tenant_id:'10',
    work_order_id:id,source_record_id:id,work_order_no:null,payment_order_no:'shared-payment',source_order_no:'original-'+id,
    issue_kind:'deposit',work_order_type_name:'存款未到账',status_code:3,amount:'102.50',
    submitted_date:'2026-11-08',submitted_at:'2026-11-08T05:00:00.123456Z',observed_at:'2026-11-08T07:00:00Z',
    source_updated_at:'2026-11-08T07:00:00Z',operated_at:'2026-11-08T07:00:00Z',operation_time_source:'lastUpdateTime',
    ...fields
  });
}
async function snapshot(id, fields={}) {
  await insert('private.ar_workorder_latest_v1',{
    system_name:'AR',country_code:'IN',country:'印度',platform:'arOne',tenant_id:'10',
    source_record_id:id,work_order_no:'native-'+id,payment_order_no:'shared-payment',
    issue_kind:'deposit',work_order_type_name:'存款未到账',submitted_at:'2026-11-08T05:00:00.123456Z',
    submitted_date:'2026-11-08',state_code:4,source_updated_at:'2026-11-08T09:00:00Z',
    observed_at:'2026-11-08T09:01:00Z',...fields
  });
}
async function newar(id, fields={}) {
  await insert('public.newar_detail_records',{
    id:randomUUID(),platform:'newOne',dataset:'workorder',source_id:id,workorder_type:'存款未到账自动化',currency:'INR',
    status_code:'4',amount:100,order_number:'shared-payment',created_at:'2026-11-08T05:00:00.123456Z',
    captured_at:'2026-11-08T10:00:00Z',raw:JSON.stringify({depositOrderNo:'shared-payment',rechargeState:'Cancel',requestedAmount:'100'}),
    ...fields
  });
}
async function rejected(callback,pattern) {
  await db.exec('savepoint expect_denied');
  try {await assert.rejects(callback,pattern);} finally {await db.exec('rollback to savepoint expect_denied; release savepoint expect_denied');}
}

before(async()=>{
  db=new PGlite();
  for (const name of ['gateway.sql','native-sources.sql','charge-sources.sql','native-platform-registry.sql']) await db.exec(fs.readFileSync(path.join(fixtureDir,name),'utf8'));
  await db.exec(`insert into public.ticket_test_catalog values
    ('00000000-0000-0000-0000-000000000001','AR ONE','M8','印度','IN','ar','Asia/Kolkata','INR','arOne'),
    ('00000000-0000-0000-0000-000000000002','NEW ONE','M8','印度','IN','newar','Asia/Kolkata','INR','newOne'),
    ('00000000-0000-0000-0000-000000000003','RESTRICTED','Else','印度','IN','ar','Asia/Kolkata','INR','restricted'),
    ('00000000-0000-0000-0000-000000000004','FUTURE','M8','印度','IN','newar','Asia/Kolkata','INR','futureNew'),
    ('00000000-0000-0000-0000-000000000005','NO TICKETS','M8','印度','IN','lg','Asia/Kolkata','INR','nonTicket');
    insert into public.newar_detail_platforms values ('newOne','IN','印度','Asia/Kolkata','INR',true,null),
      ('futureNew','IN','印度','Asia/Kolkata','INR',true,'2100-01-01')`);
  for(const file of migrationsUnderTest)await db.exec('begin;\n'+fs.readFileSync(path.join(migrations,file),'utf8')+'\ncommit;');
});
after(async()=>{if(db)await db.close()});
beforeEach(async()=>{
  await db.exec('begin');await configure('actor',actor);await configure('scope',scope);
  await configure('access',{canView:true,permissions});
});
afterEach(async()=>await db.exec('rollback'));

test('each native ticket survives a repeated payment number and current snapshots overlay the matching ticket only',async()=>{
  await ar('a');await ar('b');await snapshot('a');await snapshot('snapshot-only');await newar('a');
  await ar('withdraw',{issue_kind:'withdraw'});await newar('support',{workorder_type:'一对一客服'});
  await ar('hidden',{platform:'restricted'});await newar('prelaunch',{platform:'futureNew'});
  const result=await request({orderNo:'shared-payment'});
  assert.deepEqual(result.rows.map(r=>[r.source,r.workorderId]).sort(),[['AR','a'],['AR','b'],['AR','snapshot-only'],['NEW_AR','a']]);
  assert.equal(new Set(result.rows.map(r=>r.id)).size,4);
  const merged=result.rows.find(r=>r.source==='AR'&&r.workorderId==='a');
  assert.equal(merged.statusCode,'4');assert.equal(Number(merged.amount),102.5);
  const lone=result.rows.find(r=>r.source==='AR'&&r.workorderId==='snapshot-only');
  assert.equal(lone.amount,null);assert.equal(lone.workorderNo,'native-snapshot-only');
  assert.equal(result.rows.find(r=>r.source==='AR'&&r.workorderId==='b').workorderNo,null);
  assert.equal(result.sourceComplete,false);
});

test('workorder, requested and paid amounts, dates and independent references use only their own source fields',async()=>{
  await ar('native',{attachment_types:['image','image','pdf','unapproved'],work_order_type_id:4,source_pay_type_id:9});
  await newar('usdt',{workorder_type:'USDT存款未到账自动化',currency:null,amount:80,
    raw:JSON.stringify({depositOrderNo:'payment',workorderTypeId:4,payTypeId:'not-a-number',sourceDepositOrderNo:null,orderReferenceSource:'test-form',
      sourceFormOrderReference:'payment',orderNo:'independent',rechargeNumber:'recharge-identifier',
      requestedAmount:'75.00',requestedCurrency:'INR',rechargeState:'Cancel',sourceOperatedAt:'2026-11-08T09:00:00Z'})});
  const r=(await request()).rows;const arRow=r.find(x=>x.source==='AR'); const nr=r.find(x=>x.workorderId==='usdt');
  assert.equal(Number(arRow.amount),102.5);assert.equal(arRow.requestedAmount,null);
  assert.deepEqual(arRow.attachmentTypes,['image','pdf']);assert.equal(String(arRow.workorderTypeId),'4');
  assert.equal(arRow.operatedAt,null);assert.equal(arRow.requestedCurrency,null);
  assert.equal(Number(nr.amount),80);assert.equal(Number(nr.requestedAmount),75);
  assert.equal(nr.requestedCurrency,null);assert.equal(nr.collectedCurrency,null);
  assert.equal(nr.workorderTypeId,'4');assert.equal(nr.sourcePayTypeId,null);
  assert.equal(nr.statusCode,'4');assert.equal(nr.statusLabel,'已处理');assert.equal(nr.receiptStatus,'Cancel');
  assert.equal(nr.paidAt,null);assert.equal(nr.operatedAt,null);assert.equal(nr.paidAmount,null);
  assert.equal(nr.sourceOrderNo,'independent');assert.equal(nr.orderNo,'payment');
  assert.equal(nr.depositOrderNo,null);assert.equal(nr.rechargeNumber,'recharge-identifier');assert.equal(nr.formOrderReference,'payment');
});

test('cursor continues across equal microsecond timestamps and ignores new rows ahead of page one',async()=>{
  for(let i=0;i<22;i++)await ar('a'+String(i).padStart(2,'0'));
  await ar('early',{submitted_date:'2026-11-07',submitted_at:'2026-11-07T04:00:00Z'});
  await ar('undated',{submitted_at:null});
  const first=await request();assert.equal(first.rows.length,20);assert.equal(first.hasMore,true);
  await ar('newer',{submitted_at:'2026-11-08T05:00:00.123457Z'});
  const next=await request({}, {offset:20,cursor:first.nextCursor});
  assert.deepEqual(next.rows.map(r=>r.workorderId),['a20','a21','early','undated']);
  assert.equal(next.hasMore,false);assert.equal(next.nextCursor,null);
  const ids=[...first.rows,...next.rows].map(r=>r.id);
  assert.equal(new Set(ids).size,24);
  await rejected(()=>request({platform:'AR ONE'},{cursor:first.nextCursor}),/invalid_ticket_cursor/);
  await rejected(()=>request({}, {cursor:{...first.nextCursor,h:'not-the-same-context'}}),/invalid_ticket_cursor/);
  await configure('actor','00000000-0000-0000-0000-000000000012');
  await rejected(()=>request({}, {cursor:first.nextCursor}),/invalid_ticket_cursor/);
});

test('detail, account and native scope permissions also govern direct RPC calls',async()=>{
  await newar('visible');
  await configure('access',{canView:true,permissions:['workorders.view','workorders.query']});
  const list=await request();assert.equal(list.canDetail,false);
  for(const key of ['raw','memberId','paidAmount','sourceOrderNo','sourceUpdatedAt','collectedCurrency','formOrderReference','workorderName','attachmentTypes','sourcePayTypeId','workorderTypeId'])
    assert.equal(Object.hasOwn(list.rows[0],key),false,key);
  await configure('scope',{IN:['arOne']});
  assert.equal((await request({platform:'NEW ONE'})).rows.length,0);
  await configure('access',{canView:true,permissions:['workorders.view']});
  await rejected(()=>request(),/role_permission_denied/);
  await configure('actor','');
  await rejected(()=>request(),/session_denied/);
});

test('identifier filters match a single ticket, keep the original form reference, and honor the local date',async()=>{
  await ar('in-range',{work_order_no:'W-CASE',payment_order_no:'RC-CaSe',utr:'U-Case'});
  await ar('decoy',{work_order_no:'W-OTHER',payment_order_no:'RC-CaSe',utr:'U-other'});
  await newar('first-instant',{created_at:'2026-11-06T18:30:00Z',
    raw:JSON.stringify({depositOrderNo:'RC-CaSe',sourceDepositOrderNo:null,
      orderReferenceSource:'verified-form',sourceFormOrderReference:'RC-CaSe',orderNo:'independent',utr:'U-Case'})});
  await newar('fallback',{order_number:'normalized-reference',raw:JSON.stringify({
    depositOrderNo:{code:'wrong-type'},rechargeNumber:'  Fallback-REF  ',requestedCurrency:'INR'})});
  await newar('before-midnight',{created_at:'2026-11-06T18:29:59.999999Z',
    raw:JSON.stringify({depositOrderNo:'RC-CaSe',utr:'U-Case'})});
  const result=await request({orderNo:'RC-CaSe',utr:'U-Case'});
  assert.deepEqual(result.rows.map(r=>r.workorderId).sort(),['first-instant','in-range']);
  const form=result.rows.find(r=>r.workorderId==='first-instant');
  assert.equal(form.orderNo,'RC-CaSe');assert.equal(form.depositOrderNo,null);
  assert.equal(form.formOrderReference,'RC-CaSe');assert.equal(form.sourceOrderNo,'independent');
  const fallback=(await request({orderNo:'Fallback-REF'})).rows[0];
  assert.equal(fallback.workorderId,'fallback');assert.equal(fallback.orderNo,'Fallback-REF');
  assert.equal(fallback.depositOrderNo,null);assert.equal(fallback.sourceOrderNo,null);
  assert.equal(fallback.requestedCurrency,null);
  assert.equal((await request({workorderId:'decoy',utr:'U-Case'})).rows.length,0);
  assert.equal((await request({workorderNo:'W-CASE'})).rows[0].workorderId,'in-range');
});

test('a signed-in list role may read the gateway but cannot call the internal slice; anon cannot read the workorder gateway',async()=>{
  await ar('case');
  await db.exec('set local role authenticated');
  assert.equal((await request()).rows.length,1);
  await rejected(()=>db.query("select count(*) from private.dashboard_deposit_ticket_ar_slice('IN','arOne','2026-11-07','2026-11-08',null,null,'{}'::jsonb)"),/permission denied/);
  await db.exec('reset role; set local role anon');
  await rejected(()=>request(),/permission denied/);
});

test('an undated continuation stays in native submission-day scope and uses stable ticket identity',async()=>{
  for(let i=0;i<21;i++)await ar('u'+String(i).padStart(2,'0'),{submitted_at:null});
  await ar('outside',{submitted_at:null,submitted_date:'2026-11-06'});
  const first=await request();assert.equal(first.nextCursor.at,null);assert.equal(first.rows.length,20);
  const next=await request({}, {cursor:first.nextCursor,offset:20});
  assert.deepEqual(next.rows.map(r=>r.workorderId),['u20']);assert.equal(next.nextCursor,null);
});

test('source operation and display ticket number keep identity, processing time and scopes separate',async()=>{
  await ar('legacy-id');
  await ar('hidden-id',{work_order_no:'native-no'});
  await newar('new-id',{raw:JSON.stringify({sourceOperatedAt:'2026-11-08T07:00:00Z',
    sourceOperatedSourceField:'lastUpdateTime'})});
  assert.equal((await request({workorderNo:'legacy-id'})).rows[0].workorderId,'legacy-id');
  assert.equal((await request({workorderNo:'hidden-id'})).rows.length,0);
  assert.equal((await request({workorderId:'hidden-id'})).rows[0].workorderNo,'native-no');
  const nr=(await request({workorderNo:'new-id'})).rows[0];
  assert.equal(nr.workorderId,'new-id');assert.equal(nr.operatedAt,null);
  assert.equal(nr.sourceOperatedAt,'2026-11-08T07:00:00Z');assert.equal(nr.operationTimeSource,'lastUpdateTime');
});

test('only unique same-system/platform recharge records enrich permitted pages, preserving separate workorder fields',async()=>{
  await configure('access',{canView:true,permissions:[...permissions,'orders.view','orders.query','orders.detail']});
  await snapshot('just-status');
  await ar('no-ref',{payment_order_no:null});
  await ar('no-charge',{payment_order_no:'wrong-platform'});
  await newar('new',{raw:JSON.stringify({depositOrderNo:'unique',rechargeState:'Wait'})});
  await newar('ambiguous',{raw:JSON.stringify({depositOrderNo:'duplicate'})});
  const payment={source_system:'AR',country_code:'IN',order_kind:'recharge',platform:'arOne',order_no:'shared-payment',
    status:'已支付',amount:'91.75',raw_channel:'source-provider',channel_type:'QR',completed_at:'2026-11-08 03:00'};
  await insert('public.ar_collected_orders',payment);
  await insert('public.ar_collected_orders',{...payment,platform:'restricted',order_no:'wrong-platform'});
  await insert('public.ar_collected_orders',{...payment,order_kind:'withdraw',order_no:'wrong-platform'});
  const charge={id:randomUUID(),source_id:'charge-1',platform:'newOne',dataset:'charge',created_at:'2026-11-07T11:00Z',
    order_number:'unique',status_code:'Payed',amount:'99',currency:'INR',provider:'original-provider',
    raw:JSON.stringify({rechargeState:'Payed',sourcePaidAt:'2026-11-08T01:00:00Z',utr:'reference'})};
  await insert('public.newar_detail_records',charge);
  for(const id of ['second','third'])await insert('public.newar_detail_records',{...charge,id:randomUUID(),source_id:id,order_number:'duplicate'});
  const rows=(await request()).rows;
  const arRow=rows.find(r=>r.workorderId==='just-status'), n=rows.find(r=>r.workorderId==='new');
  assert.equal(arRow.rechargeOrder.status,'已支付');assert.equal(Number(arRow.rechargeOrder.amount),91.75);
  assert.equal(arRow.rechargeOrder.currency,null);assert.equal(arRow.rechargeOrder.provider,'source-provider');
  assert.equal(arRow.ticketEvidence,'snapshot_only');assert.equal(n.ticketEvidence,'detail');
  assert.equal(arRow.rechargeOrder.utr,null);assert.equal(arRow.amount,null);assert.equal(arRow.requestedAmount,null);
  assert.equal(arRow.receiptStatus,null);assert.equal(arRow.operatedAt,null);
  assert.equal(n.rechargeOrder.match,'matched');assert.equal(n.rechargeOrder.currency,null);
  assert.equal(n.receiptStatus,'Wait');assert.equal(n.rechargeOrder.status,'Payed');assert.equal(n.rechargeOrder.utr,'reference');
  assert.deepEqual(rows.find(r=>r.workorderId==='no-ref').rechargeOrder,{match:'no_reference'});
  assert.deepEqual(rows.find(r=>r.workorderId==='no-charge').rechargeOrder,{match:'not_found'});
  assert.deepEqual(rows.find(r=>r.workorderId==='ambiguous').rechargeOrder,{match:'ambiguous'});
  await db.exec("update public.ar_collected_orders set amount_local=15,currency_local='INR',money_format_version=1 where order_no='shared-payment'");
  const local=(await request({workorderId:'just-status'})).rows[0].rechargeOrder;
  assert.equal(local.currency,'INR');assert.equal(Number(local.amount),15);
  for(const keys of [permissions,['workorders.view','workorders.query','orders.view','orders.query','orders.detail']]){
    await configure('access',{canView:true,permissions:keys});
    assert.ok((await request()).rows.every(r=>!Object.hasOwn(r,'rechargeOrder')));
  }
  await db.exec('set local role authenticated');
  await rejected(()=>db.query("select private.dashboard_ticket_recharge_order('ar','IN','arOne','Asia/Kolkata','shared-payment')"),/permission denied/);
});

test('AR form names require the same enabled platform registration, tenant and both scopes; the recharge keeps its own key',async()=>{
  const id='00000000-0000-0000-0000-000000000090';
  await db.query("insert into public.ticket_test_catalog values ($1,'OKWIN','M8','印度','IN','ar','Asia/Kolkata','INR','OKWIN')",[id]);
  await db.query("insert into private.ar_middle_channel_platforms values ('IN',$1,'OKWIN','fixture-tenant',true)",[id]);
  await configure('scope',{IN:['OKWIN','OK.WIN']});
  await configure('access',{canView:true,permissions:[...permissions,'orders.view','orders.query','orders.detail']});
  await ar('allowed-form',{tenant_id:'fixture-tenant',platform:'OK.WIN',work_order_no:'native-form'});
  await ar('wrong-tenant',{tenant_id:'other-tenant',platform:'OK.WIN',work_order_no:'decoy'});
  await insert('public.ar_collected_orders',{source_system:'AR',country_code:'IN',platform:'OKWIN',order_kind:'recharge',
    order_no:'shared-payment',status:'已支付',amount:'10.00',raw_channel:'source-provider'});
  await insert('public.ar_collected_orders',{source_system:'AR',country_code:'IN',platform:'OK.WIN',order_kind:'recharge',
    order_no:'shared-payment',status:'待支付',amount:'20.00',raw_channel:'decoy-provider'});
  for(const platform of ['OKWIN','OK.WIN']){
    const page=await request({platform,workorderNo:'native-form'});
    assert.equal(page.rows.length,1);assert.equal(page.sourceStatus,'ready');
    assert.equal(page.rows[0].platform,'OKWIN');assert.equal(page.rows[0].sourcePlatform,'OK.WIN');
    assert.equal(page.rows[0].rechargeOrder.status,'已支付');assert.equal(page.rows[0].rechargeOrder.provider,'source-provider');
  }
  assert.deepEqual((await request({platform:'OKWIN'})).rows.map(r=>r.workorderId),['allowed-form']);
  assert.equal((await request({platform:'OKWIN',workorderNo:'decoy'})).rows.length,0);
  await configure('scope',{IN:['OKWIN']});assert.equal((await request()).rows.length,0);
  await configure('scope',{IN:['OK.WIN']});assert.equal((await request()).rows.length,0);
  await configure('scope',{IN:['OKWIN','OK.WIN']});
  await db.exec('update private.ar_middle_channel_platforms set enabled=false');assert.equal((await request()).rows.length,0);
  await db.exec("update private.ar_middle_channel_platforms set enabled=true,country_code='PK'");assert.equal((await request()).rows.length,0);
});
