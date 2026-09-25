// Synthetic Google and Supabase requests only; no live connection or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/sync-deposit-issue-sheet/index.ts'),'utf8');
const compiled=ts.transpileModule(source+'\nexport {rowsFromValues,dateValue,entryRowsFromValues,ENTRY_TABS};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleUnderTest={exports:{}};new Function('module','exports',compiled)(moduleUnderTest,moduleUnderTest.exports);
const {rowsFromValues,dateValue,entryRowsFromValues,ENTRY_TABS,createDepositIssueSyncHandler}=moduleUnderTest.exports;
const headers=['盘口','订单号','UTR','金额','三方','UPI','KYC-UPI','KYC正确','UTR是否匹配','三方回复','对上','状态','未入款天数','日期','三方'];
const row=['SYNTHETIC-PLATFORM','SYNTHETIC-ORDER-20260901','00001234','1,250.50','LKgoPayINR','PRIVATE-UPI','PRIVATE-KYC','正确','一致','成功 2026-09-24','对得上','已入款',19,'2026年9月23日','SUMMARY-NOT-PROVIDER'];

test('source dates accept Chinese formatted days and valid serials without inferring order dates',()=>{
 assert.equal(dateValue('2026年9月23日'),'2026-09-23');assert.equal(dateValue('2026/9/3'),'2026-09-03');assert.equal(dateValue('2026-09-23 12:30:00'),'2026-09-23');
 assert.equal(dateValue(46288),'2026-09-23');
 for(const value of ['2026-02-30','2026/13/01','SYNTHETIC-ORDER-20260923',null,20260923,-1])assert.equal(dateValue(value),null,String(value));
});
test('safe sheet columns retain original status, matching flags, reply and exact UTR',()=>{
 const rows=rowsFromValues([headers,row],'synthetic-sheet','2026-09-24T10:00:00Z');assert.equal(rows.length,1);const r=rows[0];
 assert.equal(r.record_date,'2026-09-23');assert.equal(r.amount,1250.5);assert.equal(r.provider,'LKgoPayINR');assert.equal(r.status,'已入款');assert.equal(r.unreceived_days,19);assert.equal(r.utr,'00001234');assert.equal(r.provider_reply,'成功 2026-09-24');assert.equal(r.utr_match,'一致');assert.equal(r.kyc_correct,'正确');
 assert(!JSON.stringify(r).includes('PRIVATE-'));assert(!JSON.stringify(r).includes('SUMMARY-NOT-PROVIDER'));assert.equal(r.source_row,2);
 const missing=row.slice();missing[13]='';assert.equal(rowsFromValues([headers,missing],'synthetic-sheet','2026-09-24T10:00:00Z')[0].record_date,null);
});
const entryHeaders=['MEMBER ID','WORK ORDER NUMBER','Order Number ','UTR NUMMBER','AMOUNT ','THIRDPARTY','UPI ID','KYC-UPI ID','KYC记录正确','UTR Matched','MAIN THIRD PARTY REPLY','ID NUMBER','STATUS','PDF/VIDEO','MAIN THIRD PARTY FOLLOW UP DATE & TIME','RECEIPT DATE'];
const entryRow=['PRIVATE-MEMBER','SYNTHETIC-TICKET','SYNTHETIC-ORDER-20260901','00001234','1,250.50','LKgoPayINR','PRIVATE-UPI','PRIVATE-KYC','YES','NO','First line\nSecond line','PRIVATE-ID','Success To Other Platform','Need video','25/9/2026 13:53:55','29'];
test('entry headers preserve multiline replies, follow-up status and day-first dates without payment identifiers',()=>{
 const [r]=entryRowsFromValues([entryHeaders,entryRow],'synthetic-entry','RAJALOTTERY',42,'2026-09-25T00:00:00Z');
 assert.equal(r.work_order_number,'SYNTHETIC-TICKET');assert.equal(r.utr,'00001234');assert.equal(r.provider_reply,'First line\nSecond line');assert.equal(r.followup_status,'Success To Other Platform');assert.equal(r.followup_date,'2026-09-25');assert.equal(r.receipt_text,'29');assert.equal(r.source_gid,42);assert(!JSON.stringify(r).includes('PRIVATE-'));assert.equal(r.status,undefined);
 const noDate=entryRow.slice();noDate[14]='';assert.equal(entryRowsFromValues([entryHeaders,noDate],'synthetic-entry','JAICLUB',42,'2026-09-25T00:00:00Z')[0].followup_date,null);
 const bad=entryRow.slice();bad[14]='31/2/2026';assert.equal(entryRowsFromValues([entryHeaders,bad],'synthetic-entry','JAICLUB',42,'2026-09-25T00:00:00Z')[0].followup_date,null);
});
function harness({failUpsert=false,missingTab=false,failEntries=false}={}){
 const calls=[],writes=[],env={SYNC_SECRET:'synthetic-sync',GOOGLE_SERVICE_ACCOUNT_EMAIL:'example@example.invalid',GOOGLE_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',DEPOSIT_ISSUE_SHEET_ID:'synthetic_source_12345',DEPOSIT_FOLLOWUP_SHEET_ID:'synthetic_entries_12345',SUPABASE_URL:'https://synthetic-project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key'};
 const crypto={subtle:{digest:webcrypto.subtle.digest.bind(webcrypto.subtle),importKey:async()=>({}),sign:async()=>new Uint8Array([1,2,3]).buffer}};
 const fetch=async(input,init)=>{const url=new URL(input);calls.push({url,init});assert.equal(init.redirect,'error');assert(init.signal);
  if(url.origin==='https://oauth2.googleapis.com')return Response.json({access_token:'synthetic-google-token'});
  if(url.origin==='https://sheets.googleapis.com'){
   if(url.pathname.includes('synthetic_source_'))return Response.json({values:[headers,row]});
   if(url.pathname.endsWith('/values:batchGet'))return Response.json({valueRanges:url.searchParams.getAll('ranges').map(range=>({values:range.startsWith("'51GAME'")?[entryHeaders,entryRow]:[entryHeaders]}))});
   return Response.json({sheets:[...ENTRY_TABS].slice(missingTab?1:0).map((title,i)=>({properties:{title,sheetId:i}})).concat([{properties:{title:'Sheet21',sheetId:99,hidden:true}}])});
  }
  assert.equal(url.origin,'https://synthetic-project.supabase.co');if(init.method==='POST'){writes.push(JSON.parse(init.body));if(failUpsert||failEntries&&url.pathname.endsWith('admin_deposit_followup_rows'))return new Response('PRIVATE upstream error',{status:503})}return new Response(null,{status:204});
 };
 const handle=createDepositIssueSyncHandler({env:key=>env[key],fetch,now:()=>Date.parse('2026-09-24T10:00:00Z'),crypto});
 const call=(secret='synthetic-sync')=>handle(new Request('https://synthetic-project.supabase.co/functions/v1/sync-deposit-issue-sheet',{method:'POST',headers:{'x-sync-secret':secret,'Content-Type':'application/json'},body:JSON.stringify({action:'sync'})}));
 return {calls,writes,call};
}
test('authorized refresh reads both complete sources and only mirrors their safe columns',async()=>{
 const h=harness(),response=await h.call();assert.equal(response.status,200);const body=await response.json();assert.equal(body.rowsWritten,1);assert.equal(body.entryRows,1);assert.equal(body.entryTabs,16);
 const google=h.calls.find(x=>x.url.origin==='https://sheets.googleapis.com').url;assert.equal(google.searchParams.get('valueRenderOption'),'FORMATTED_VALUE');assert(decodeURIComponent(google.pathname).endsWith('/UPI核对!A1:N40001'));
 assert.equal(h.writes[0][0].record_date,'2026-09-23');assert.equal(h.writes[0][0].status,'已入款');assert.equal(h.writes[1][0].followup_status,'Success To Other Platform');assert.equal(h.writes[1][0].utr,'00001234');
 const cleanups=h.calls.filter(x=>x.init.method==='DELETE');assert.equal(cleanups.length,2);assert.equal(cleanups[0].url.searchParams.get('source_sheet'),'eq.synthetic_source_12345');assert.equal(cleanups[1].url.searchParams.get('source_sheet'),'eq.synthetic_entries_12345');
 assert(h.calls.findLastIndex(x=>x.init.method==='POST')<h.calls.findIndex(x=>x.init.method==='DELETE'));
});
test('failed writes and incomplete entry reads never remove old rows, and unauthorized calls contact neither source',async()=>{
 for(const options of [{failUpsert:true},{failEntries:true},{missingTab:true}]){
  const failed=harness(options),response=await failed.call();assert(response.status>=500);assert(!failed.calls.some(x=>x.init.method==='DELETE'));assert(!JSON.stringify(await response.json()).includes('PRIVATE'));
  if(options.missingTab)assert.equal(failed.writes.length,0);
 }
 const denied=harness();assert.equal((await denied.call('wrong')).status,401);assert.equal(denied.calls.length,0);
});
