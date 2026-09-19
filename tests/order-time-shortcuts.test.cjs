const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const {loadTs,root}=require('./load-typescript.cjs');
const {indiaShortcutDateRange}=loadTs(path.join(root,'src/lib/orderTimeQuery.ts'));

test('India date shortcuts do not follow the browser computer timezone',()=>{
  const epoch=Date.parse('2026-09-18T18:45:00Z'); // India: 19th 00:15.
  const previous=process.env.TZ;
  try {
    for(const zone of ['Asia/Yerevan','Asia/Hong_Kong','America/Los_Angeles','UTC','Asia/Kolkata']) {
      process.env.TZ=zone;
      assert.deepEqual(indiaShortcutDateRange('today','',epoch),{start:'2026-09-19',end:'2026-09-19'},zone);
      assert.deepEqual(indiaShortcutDateRange('yesterday','',epoch),{start:'2026-09-18',end:'2026-09-18'},zone);
      assert.deepEqual(indiaShortcutDateRange('beforeYesterday','',epoch),{start:'2026-09-17',end:'2026-09-17'},zone);
    }
  } finally {
    if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;
  }
});

test('week shortcuts use Monday through Sunday, including a year boundary',()=>{
  const epoch=Date.parse('2026-12-31T20:00:00Z'); // India: 2027-01-01.
  assert.deepEqual(indiaShortcutDateRange('thisWeek','',epoch),{start:'2026-12-28',end:'2027-01-03'});
  assert.deepEqual(indiaShortcutDateRange('lastWeek','',epoch),{start:'2026-12-21',end:'2026-12-27'});
  assert.deepEqual(indiaShortcutDateRange('yesterday','',epoch),{start:'2026-12-31',end:'2026-12-31'});
});

test('month shortcuts handle leap years, month end and selected previous month',()=>{
  const epoch=Date.parse('2028-01-31T20:00:00Z'); // India: leap-year February 1.
  assert.deepEqual(indiaShortcutDateRange('thisMonth','',epoch),{start:'2028-02-01',end:'2028-02-29'});
  assert.deepEqual(indiaShortcutDateRange('lastMonth','',epoch),{start:'2028-01-01',end:'2028-01-31'});
  assert.deepEqual(indiaShortcutDateRange('lastMonth','2026-01-31',epoch),{start:'2025-12-01',end:'2025-12-31'});
  assert.deepEqual(indiaShortcutDateRange('lastMonth','2026-02-30',epoch),{start:'2028-01-01',end:'2028-01-31'});
});
