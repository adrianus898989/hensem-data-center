// Run with NODE_PATH pointing to @electric-sql/pglite. Synthetic data only; no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite');
const fixtures = require('./fixtures/reason-categories.json');
const migration = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');
const key = 'c'.repeat(64);

(async () => {
  const db = new PGlite();
  let checks = 0;
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  const fail = async (sql, params, message) => {
    await assert.rejects(() => db.query(sql, params), error => error.message.includes(message)); checks++;
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create function public.dashboard_has_permission(text) returns boolean language sql stable as $$ select coalesce(current_setting('test.auto_withdraw',true),'false') = 'true' $$;`);
    await db.exec(migration('20260910073836_withdraw_reasons_snapshots.sql'));
    await db.exec(migration('20260910105601_withdraw_reason_categories.sql'));
    // Reproduce managed-project defaults, then verify the derived view is read only.
    await db.exec('grant all on public.withdraw_reasons_daily_grouped to service_role');
    await db.exec(migration('20260910111641_withdraw_reason_view_readonly.sql'));
    await db.exec(migration('20260910152757_withdraw_reason_daily_profit.sql'));
    assert.equal(await scalar("select has_table_privilege('service_role','public.withdraw_reasons_daily_grouped','insert,update,delete')"),false); checks++;
    const labels = new Map();
    for (const c of fixtures.cases) {
      const result = await scalar('select public.withdraw_reason_category($1,$2)', [c.input_label, c.classification || 'unclassified']);
      assert.equal(result.label, c.expected_canonical_label, c.id); labels.set(c.id, result.label); checks++;
    }
    for (const set of fixtures.must_equal) { assert.equal(new Set(set.ids.map(id => labels.get(id))).size, 1, set.why); checks++; }
    for (const set of fixtures.must_different) { assert.equal(new Set(set.ids.map(id => labels.get(id))).size, set.ids.length, set.why); checks++; }
    for (const classification of ['empty','truncated']) {
      assert.deepEqual(await scalar('select public.withdraw_reason_category($1,$2)', ['会员在限制的游戏类型中总的投注数:3', classification]), {label:'会员在限制的游戏类型中总的投注数:3', classification}); checks++;
    }
    await fail('select public.withdraw_reason_category($1,$2)', ['x'.repeat(401),'unclassified'], 'WR_CATEGORY_LABEL_TOO_LONG');
    await fail('select public.withdraw_reasons_group_snapshot($1::jsonb)', ['{}'], 'WR_INVALID_GROUPING_INPUT');
    const profitLabel = amount => `当日盈利金额大于{金额},当日盈利:${amount}`;
    const profitAmounts = ['118552.18','149803.23','100244.56','128570.76'];
    for (const amount of profitAmounts) {
      assert.deepEqual(await scalar('select public.withdraw_reason_category($1,$2)',[profitLabel(amount),'template']),
        {label:'当日盈利金额大于{金额}',classification:'template'}); checks++;
    }
    assert.equal((await scalar('select public.withdraw_reason_category($1,$2)',
      [' 当日盈利金额大于{金额} ， 当日盈利： 118552.18 ','unclassified'])).label,'当日盈利金额大于{金额}'); checks++;
    for (const threshold of ['80000.00','100000','200000']) {
      for (const amount of ['250000','300000.25']) {
        assert.equal((await scalar('select public.withdraw_reason_category($1,$2)',
          [`当日盈利金额大于${threshold},当日盈利:${amount}`,'unclassified'])).label,`当日盈利金额大于${threshold}`); checks++;
      }
    }
    for (const unchanged of [
      '当日盈利金额小于{金额},当日盈利:118552.18',
      '当日盈利金额大于等于{金额},当日盈利:118552.18',
      '累计盈利金额大于{金额},当日盈利:118552.18',
      `${profitLabel('118552.18')},错误码:501`,
      `${profitLabel('118552.18')},余额不足`,
      profitLabel(''),profitLabel('未知'),profitLabel('118552.18/149803.23'),profitLabel('118552x18'),
      profitLabel('-118552.18'),
    ]) {
      assert.deepEqual(await scalar('select public.withdraw_reason_category($1,$2)',[unchanged,'unclassified']),
        {label:unchanged,classification:'unclassified'}); checks++;
    }
    for (const classification of ['empty','truncated']) {
      assert.deepEqual(await scalar('select public.withdraw_reason_category($1,$2)',[profitLabel('118552.18'),classification]),
        {label:profitLabel('118552.18'),classification}); checks++;
    }
    await db.exec('set role service_role');
    await db.query(`insert into public.withdraw_reasons_credentials(token_hash,source_system,allowed_scopes,expires_at)
      values($1,'AR','[{"country_code":"IN","platform":"TPPLAY"}]',now()+interval '1 day')`, [key]);
    const group = (label, count, success, operator = 'manual', classification = 'unclassified') => ({
      operator_class: operator, reason_key: createHash('sha256').update(label).digest('hex'), reason_label: label,
      classification, count, success, reject: count-success, other: 0, samples: [label, '脱敏样本'],
    });
    const profitGroups = profitAmounts.map(amount=>group(profitLabel(amount),1,1,'manual','template'));
    const profitSnapshot = {totals:{manual:16020},groups:[...profitGroups,
      group(profitLabel('118552.18'),2,1,'auto','template'),group('未填写备注',929,574,'manual','empty')]};
    const profitBefore = JSON.stringify(profitSnapshot);
    const profitResult = await scalar('select public.withdraw_reasons_group_snapshot($1::jsonb)',[profitBefore]);
    const profitMerged = profitResult.groups.find(g=>g.operator_class==='manual' && g.classification!=='empty');
    assert.equal(profitResult.groups.length,3);
    assert.equal(profitMerged.reason_label,'当日盈利金额大于{金额}');
    assert.equal(profitMerged.count,4); assert.equal(profitMerged.success,4); assert.equal(profitMerged.reject,0);
    assert.equal(profitMerged.variants.length,4);
    assert.deepEqual(profitMerged.variants.map(v=>v.reason_label).sort(),profitGroups.map(g=>g.reason_label).sort());
    assert.ok(profitMerged.variants.every(v=>v.count===1));
    assert.equal((profitMerged.count / profitSnapshot.totals.manual * 100).toFixed(2),'0.02');
    assert.equal(JSON.stringify(profitSnapshot),profitBefore); checks++;
    const groups = [group('会员在限制的游戏类型中总的投注数:1', 14, 13), group('会员在限制的游戏类型中总的投注数:3', 19, 19),
      group('会员在限制的游戏类型中总的投注数:3', 2, 2, 'auto'),
      group('无充值连续提款大于3次',5,3), group('无充值连续提款大于5次',3,2),
      group('未填写备注',4,3,'manual','empty'), group('备注内容截断，待补充',2,1,'manual','truncated')];
    const totals = { total:0, auto:0, manual:0, unknown:0, success:0, reject:0, other:0 };
    for (const g of groups) { totals.total+=g.count; totals[g.operator_class]+=g.count; totals.success+=g.success; totals.reject+=g.reject; }
    const snapshot = { schema_version:1, source_system:'AR', country_code:'IN', platform:'TPPLAY', stat_date:'2026-09-09', timezone:'Asia/Kolkata',
      snapshot_id:randomUUID(), snapshot_at:new Date(Date.now()-60000).toISOString(), classifier_version:'note-template-v2',
      coverage:{complete:true,expected_count:totals.total,fetched_count:totals.total,unique_count:totals.total,missing_order_ids:0,note_header_found:true,incomplete_note_count:2}, totals, groups };
    assert.equal((await scalar('select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)',[key,JSON.stringify(snapshot)])).status,'accepted'); checks++;
    const receipt = await scalar('select payload_hash from public.withdraw_reasons_snapshot_receipts where snapshot_id=$1',[snapshot.snapshot_id]);
    const result = await scalar('select snapshot from public.withdraw_reasons_daily_grouped');
    const merged = result.groups.find(g=>g.operator_class==='manual' && g.reason_label==='受限游戏类型投注');
    assert.equal(merged.count,33); assert.equal(merged.success,32); assert.equal(merged.reject,1);
    assert.equal(merged.variants.length,2); assert.equal(merged.variants.reduce((sum,v)=>sum+v.count,0),33);
    assert.equal(merged.samples.length,3); assert.equal(result.groups.length,6); checks++;
    assert.equal(result.groups.find(g=>g.operator_class==='auto').count,2, 'Auto and manual must not merge'); checks++;
    assert.deepEqual({...result,groups:snapshot.groups},snapshot,'Only derived groups change'); checks++;
    assert.deepEqual(await scalar('select snapshot from public.withdraw_reasons_daily'),snapshot);
    assert.equal(await scalar('select payload_hash from public.withdraw_reasons_snapshot_receipts where snapshot_id=$1',[snapshot.snapshot_id]),receipt); checks++;
    assert.equal((await scalar('select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)',[key,JSON.stringify(snapshot)])).status,'unchanged'); checks++;
    const report = await scalar("select public.report_withdraw_reasons_snapshots($1,'2026-09-01','2026-09-09','{}')",[key]);
    assert.deepEqual(report.snapshots,[result]); assert.equal(report.grouping_version,'reason-category-v1'); checks++;
    await fail("select public.report_withdraw_reasons_snapshots($1,'2026-09-01','2026-09-09',array['OTHER'])",[key],'WR_SCOPE_DENIED');
    await fail("select public.report_withdraw_reasons_snapshots($1,'2026-01-01','2026-09-09','{}')",[key],'WR_INVALID_REPORT');
    await fail("select public.report_withdraw_reasons_snapshots($1,'2026-09-01','2026-09-09','{}')",['d'.repeat(64)],'WR_AUTH_INVALID');
    const empty = {...snapshot,stat_date:'2026-09-08',snapshot_id:randomUUID(),groups:[],totals:Object.fromEntries(Object.keys(totals).map(k=>[k,0])),coverage:{...snapshot.coverage,expected_count:0,fetched_count:0,unique_count:0,incomplete_note_count:0}};
    await scalar('select public.publish_withdraw_reasons_snapshot($1,$2::jsonb)',[key,JSON.stringify(empty)]);
    assert.deepEqual(await scalar("select snapshot from public.withdraw_reasons_daily_grouped where stat_date='2026-09-08'"),empty); checks++;
    await db.exec('reset role');
    for (const role of ['anon','authenticated']) {
      assert.equal(await scalar("select has_table_privilege($1,'public.withdraw_reasons_daily_grouped','insert,update,delete')",[role]),false);
      assert.equal(await scalar("select has_function_privilege($1,'public.report_withdraw_reasons_snapshots(text,date,date,text[])','execute')",[role]),false); checks++;
    }
    await db.exec('set role anon');
    await fail('select * from public.withdraw_reasons_daily_grouped',[],'permission denied');
    await db.exec("reset role; set role authenticated; set test.auto_withdraw='false'");
    assert.equal(await scalar('select count(*)::int from public.withdraw_reasons_daily_grouped'),0); checks++;
    await db.exec("set test.auto_withdraw='true'");
    assert.equal(await scalar('select count(*)::int from public.withdraw_reasons_daily_grouped'),2);
    assert.deepEqual(await scalar("select snapshot from public.withdraw_reasons_daily_grouped where stat_date='2026-09-09'"),result); checks++;
    console.log(JSON.stringify({result:'passed',checks,fixtureCases:fixtures.cases.length,database:'in-memory Postgres',productionAccess:false}));
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
