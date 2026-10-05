// Synthetic Google and Supabase requests only; no live connection or credentials.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/sync-deposit-issue-sheet/index.ts'),'utf8');
const compiled=ts.transpileModule(source+'\nexport {rowsFromValues,dateValue,entryRowsFromValues,ENTRY_TABS,CURRENT_ENTRY_TABS,DEFAULT_ENTRY_SOURCE_ID,HISTORICAL_ENTRY_SOURCE_ID};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleUnderTest={exports:{}};new Function('module','exports',compiled)(moduleUnderTest,moduleUnderTest.exports);
const {rowsFromValues,dateValue,entryRowsFromValues,ENTRY_TABS,CURRENT_ENTRY_TABS,DEFAULT_ENTRY_SOURCE_ID,HISTORICAL_ENTRY_SOURCE_ID,createDepositIssueSyncHandler}=moduleUnderTest.exports;
const headers=['盘口','订单号','UTR','金额','三方','UPI','KYC-UPI','KYC正确','UTR是否匹配','三方回复','对上','状态','未入款天数','日期','三方'];
const row=['SYNTHETIC-PLATFORM','SYNTHETIC-ORDER-20260901','00001234','1,250.50','LKgoPayINR','synthetic@upi.invalid','***@bank.invalid','正确','一致','成功 2026-09-24','对得上','已入款',19,'2026年9月23日','SUMMARY-NOT-PROVIDER'];

test('source dates accept Chinese formatted days and valid serials without inferring order dates',()=>{
 assert.equal(dateValue('2026年9月23日'),'2026-09-23');assert.equal(dateValue('2026/9/3'),'2026-09-03');assert.equal(dateValue('2026-09-23 12:30:00'),'2026-09-23');
 assert.equal(dateValue(46288),'2026-09-23');
 for(const value of ['2026-02-30','2026/13/01','SYNTHETIC-ORDER-20260923',null,20260923,-1])assert.equal(dateValue(value),null,String(value));
});
test('safe sheet columns retain original status, matching flags, reply and exact UTR',()=>{
 const rows=rowsFromValues([headers,row],'synthetic-sheet','2026-09-24T10:00:00Z');assert.equal(rows.length,1);const r=rows[0];
 assert.equal(r.record_date,'2026-09-23');assert.equal(r.amount,1250.5);assert.equal(r.provider,'LKgoPayINR');assert.equal(r.status,'已入款');assert.equal(r.unreceived_days,19);assert.equal(r.utr,'00001234');assert.equal(r.provider_reply,'成功 2026-09-24');assert.equal(r.utr_match,'一致');assert.equal(r.kyc_correct,'正确');
 assert(!JSON.stringify(r).includes('PRIVATE-'));assert(!JSON.stringify(r).includes('SUMMARY-NOT-PROVIDER'));assert.equal(r.source_row,2);assert.equal(r.upi_id,'synthetic@upi.invalid');assert.equal(r.kyc_upi_id,'***@bank.invalid');
 const missing=row.slice();missing[13]='';assert.equal(rowsFromValues([headers,missing],'synthetic-sheet','2026-09-24T10:00:00Z')[0].record_date,null);
});
const entryHeaders=['MEMBER ID','WORK ORDER NUMBER','Order Number ','UTR NUMMBER','AMOUNT ','THIRDPARTY','UPI ID','KYC-UPI ID','KYC记录正确','UTR Matched','MAIN THIRD PARTY REPLY','ID NUMBER','STATUS','PDF/VIDEO','MAIN THIRD PARTY FOLLOW UP DATE & TIME','RECEIPT DATE'];
const entryRow=['PRIVATE-MEMBER','SYNTHETIC-TICKET','SYNTHETIC-ORDER-20260901','00001234','1,250.50','LKgoPayINR','synthetic@upi.invalid','***@bank.invalid','YES','NO','First line\nSecond line','STAFF-001/STAFF-002','Success To Other Platform','Need video','25/9/2026 13:53:55','29'];
test('entry headers preserve multiline replies, follow-up status and day-first dates with authorized UPI columns only',()=>{
 const [r]=entryRowsFromValues([entryHeaders,entryRow],'synthetic-entry','RAJALOTTERY',42,'2026-09-25T00:00:00Z');
 assert.equal(r.work_order_number,'SYNTHETIC-TICKET');assert.equal(r.utr,'00001234');assert.equal(r.provider_reply,'First line\nSecond line');assert.equal(r.followup_status,'Success To Other Platform');assert.equal(r.followup_date,'2026-09-25');assert.equal(r.receipt_text,'29');assert.equal(r.source_gid,42);assert(!JSON.stringify(r).includes('PRIVATE-'));assert.equal(r.status,undefined);
 assert.equal(r.staff_code,'STAFF-001/STAFF-002');assert.equal(r.source_date_text,null);assert.equal(r.upi_id,'synthetic@upi.invalid');assert.equal(r.kyc_upi_id,'***@bank.invalid');
 const noDate=entryRow.slice();noDate[14]='';assert.equal(entryRowsFromValues([entryHeaders,noDate],'synthetic-entry','JAICLUB',42,'2026-09-25T00:00:00Z')[0].followup_date,null);
 const bad=entryRow.slice();bad[14]='31/2/2026';assert.equal(entryRowsFromValues([entryHeaders,bad],'synthetic-entry','JAICLUB',42,'2026-09-25T00:00:00Z')[0].followup_date,null);
});
test('staff code comes from L even when member column A also says ID NUMBER',()=>{
 const duplicateHeaders=entryHeaders.slice();duplicateHeaders[0]='ID NUMBER';
 const [r]=entryRowsFromValues([duplicateHeaders,entryRow],'synthetic-entry','JALWA',43,'2026-09-25T00:00:00Z');
 assert.equal(r.staff_code,'STAFF-001/STAFF-002');assert(!JSON.stringify(r).includes('PRIVATE-'));
 duplicateHeaders[11]='UNKNOWN';
 const [unknown]=entryRowsFromValues([duplicateHeaders,entryRow],'synthetic-entry','JALWA',43,'2026-09-25T00:00:00Z');
 assert.equal(unknown.staff_code,null);assert(!JSON.stringify(unknown).includes('PRIVATE-'));
});
test('JAICLUB duplicate receipt headers keep O original date separate from P age text',()=>{
 const duplicateHeaders=entryHeaders.slice();duplicateHeaders[14]='RECEIPT DATE';
 const sample=entryRow.slice();sample[14]='25/9/2026 13:53:55';sample[15]='17';
 const [r]=entryRowsFromValues([duplicateHeaders,sample],'synthetic-entry','JAICLUB',44,'2026-09-25T00:00:00Z');
 assert.equal(r.receipt_text,'17');assert.equal(r.source_date_text,'25/9/2026 13:53:55');
 assert.equal(r.followup_at,null);assert.equal(r.followup_date,null);assert.equal(r.staff_code,'STAFF-001/STAFF-002');
 assert(!JSON.stringify(r).includes('PRIVATE-'));
});
function harness({failUpsert=false,missingTab=false,failEntries=false,failArchive=false,failEntryRead=false,failResultRead=false,failEntryMetadata=false,initialRows=[],envOverrides={},metadataTabs,entryValues={},onRequest,handlerFactory=createDepositIssueSyncHandler}={}){
 const stored=new Map(initialRows.map(r=>[r.table+":"+r.id,{...r}]));
 const calls=[],writes=[],env={SYNC_SECRET:'synthetic-sync',GOOGLE_SERVICE_ACCOUNT_EMAIL:'example@example.invalid',GOOGLE_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',DEPOSIT_ISSUE_SHEET_ID:'synthetic_source_12345',DEPOSIT_FOLLOWUP_SHEET_ID:'synthetic_entries_12345',SUPABASE_URL:'https://synthetic-project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key'};
 Object.assign(env,envOverrides);
 let inFlight=0,maxInFlight=0;
 const crypto={subtle:{digest:webcrypto.subtle.digest.bind(webcrypto.subtle),importKey:async()=>({}),sign:async()=>new Uint8Array([1,2,3]).buffer}};
 const fetch=async(input,init)=>{const url=new URL(input);calls.push({url,init});assert.equal(init.redirect,'error');assert(init.signal);inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  try{await onRequest?.(url,init);
  if(url.origin==='https://oauth2.googleapis.com')return Response.json({access_token:'synthetic-google-token'});
  if(url.origin==='https://sheets.googleapis.com'){
   if(url.pathname.includes('synthetic_source_'))return failResultRead?new Response('PRIVATE upstream error',{status:503}):Response.json({valueRanges:[{values:[headers,row]},{values:[[],['LKgoPay']]},{values:[[],['已确认']]}]});
   if(url.pathname.endsWith('/values:batchGet')){
    if(failEntryRead)return new Response('PRIVATE upstream error',{status:503});
    return Response.json({valueRanges:url.searchParams.getAll('ranges').map(range=>({values:entryValues[range.split("'")[1]]||(range.startsWith("'51GAME'")?[entryHeaders,entryRow]:[entryHeaders])}))});
   }
   if(failEntryMetadata)return new Response('PRIVATE upstream error',{status:503});
   const tabs=metadataTabs||[...(url.pathname.includes(DEFAULT_ENTRY_SOURCE_ID)?CURRENT_ENTRY_TABS:ENTRY_TABS)];
   return Response.json({sheets:tabs.slice(missingTab?1:0).map((title,i)=>({properties:{title,sheetId:i}})).concat([{properties:{title:'Sheet21',sheetId:99,hidden:true}}])});
  }
  assert.equal(url.origin,'https://synthetic-project.supabase.co');assert.notEqual(init.method,'DELETE','Sheet sync never deletes a persisted row');const table=url.pathname.split('/').at(-1);
  if(init.method==='POST'){const rows=JSON.parse(init.body);writes.push(rows);if(failUpsert||failEntries&&table==='admin_deposit_followup_rows')return new Response('PRIVATE upstream error',{status:503});for(const r of rows){const key=table+':'+r.id;stored.set(key,{...stored.get(key),source_kind:'sheet',...r,table});}}
  if(init.method==='PATCH'){if(failArchive)return new Response('PRIVATE archive error',{status:503});const patch=JSON.parse(init.body);for(const r of stored.values())if(r.table===table&&[...url.searchParams].every(([key,value])=>value==='is.null'?r[key]==null:value.startsWith('eq.')?r[key]===value.slice(3):value.startsWith('lt.')?r[key]<value.slice(3):false))Object.assign(r,patch);}
  return new Response(null,{status:204});
  }finally{inFlight--;}
 };
 const handle=handlerFactory({env:key=>env[key],fetch,now:()=>Date.parse('2026-09-24T10:00:00Z'),crypto});
 const call=(secret='synthetic-sync')=>handle(new Request('https://synthetic-project.supabase.co/functions/v1/sync-deposit-issue-sheet',{method:'POST',headers:{'x-sync-secret':secret,'Content-Type':'application/json'},body:JSON.stringify({action:'sync'})}));
 return {calls,writes,call,stored,maxInFlight:()=>maxInFlight};
}
test('authorized refresh reads both complete sources and only mirrors their safe columns',async()=>{
 const h=harness(),response=await h.call();assert.equal(response.status,200);const body=await response.json();assert.equal(body.rowsWritten,1);assert.equal(body.entryRows,1);assert.equal(body.entryTabs,16);
 const google=h.calls.find(x=>x.url.origin==='https://sheets.googleapis.com').url;assert.equal(google.searchParams.get('valueRenderOption'),'FORMATTED_VALUE');assert.deepEqual(google.searchParams.getAll('ranges'),['UPI核对!A1:N40001','UPI核对!AB1:AB40001','UPI核对!AS1:AS40001']);assert.equal(h.writes[0][0].canonical_provider,'LKgoPay');assert.equal(h.writes[0][0].confirmation_status,'已确认');
 assert.equal(h.writes[0][0].record_date,'2026-09-23');assert.equal(h.writes[0][0].status,'已入款');assert.equal(h.writes[1][0].followup_status,'Success To Other Platform');assert.equal(h.writes[1][0].utr,'00001234');
 const archives=h.calls.filter(x=>x.init.method==='PATCH');assert.equal(archives.length,17);assert.equal(archives[0].url.searchParams.get('source_sheet'),'eq.synthetic_source_12345');assert.equal(archives[0].url.searchParams.get('source_tab'),'eq.UPI核对');assert.equal(archives[1].url.searchParams.get('source_sheet'),'eq.synthetic_entries_12345');
 assert.deepEqual(archives.slice(1).map(x=>x.url.searchParams.get('source_tab')).sort(),[...ENTRY_TABS].map(x=>'eq.'+x).sort());
 for(const x of archives){assert.equal(x.url.searchParams.get('stale_at'),'is.null');assert.equal(x.url.searchParams.get('updated_at'),'lt.2026-09-24T10:00:00.000Z');assert.deepEqual(JSON.parse(x.init.body),{stale_at:'2026-09-24T10:00:00.000Z'});}for(const x of archives.slice(1))assert.equal(x.url.searchParams.get('source_kind'),'eq.sheet');
 for(const table of ['admin_deposit_issue_rows','admin_deposit_followup_rows'])assert(h.calls.findLastIndex(x=>x.init.method==='POST'&&x.url.pathname.endsWith(table))<h.calls.findIndex(x=>x.init.method==='PATCH'&&x.url.pathname.endsWith(table)));
 assert(h.writes.flat().every(r=>r.stale_at===null));assert(!h.calls.some(x=>x.init.method==='DELETE'));assert.equal(body.ok,true);assert.equal(body.sourceResults.result.ok,true);assert.equal(body.sourceResults.entries.ok,true);assert(h.maxInFlight()<=2);
});
test('each failed source keeps its old rows while the independent successful source may refresh',async()=>{
 for(const options of [{failUpsert:true},{failEntries:true},{missingTab:true}]){
  const failed=harness(options),response=await failed.call();assert(response.status>=500);assert(!failed.calls.some(x=>x.init.method==='DELETE'));const body=await response.json();assert.equal(body.ok,false);assert(!JSON.stringify(body).includes('PRIVATE'));
  assert(!failed.calls.some(x=>x.init.method==='PATCH'&&x.url.pathname.endsWith('admin_deposit_followup_rows')));
  if(options.failUpsert){assert.equal(body.sourceResults.result.ok,false);assert(!failed.calls.some(x=>x.init.method==='PATCH'));}
  else{assert.equal(body.sourceResults.result.ok,true);assert.equal(body.sourceResults.entries.ok,false);assert(failed.calls.some(x=>x.init.method==='PATCH'&&x.url.pathname.endsWith('admin_deposit_issue_rows')));}
  if(options.missingTab)assert(!failed.writes.flat().some(r=>r.source_tab==='51GAME'));
 }
 const denied=harness();assert.equal((await denied.call('wrong')).status,401);assert.equal(denied.calls.length,0);
});

test('exact G/H headers retain masked and missing historical text without confusing ID NUMBER',()=>{
 const r=entryRow.slice();r[6]='-';r[7]='masked original';
 const [kept]=entryRowsFromValues([entryHeaders,r],'synthetic-entry','51GAME',1,'2026-09-27T00:00:00Z');assert.equal(kept.upi_id,'-');assert.equal(kept.kyc_upi_id,'masked original');
 const h=entryHeaders.slice();h[0]='UPI ID';h[6]='PHONE';h[7]='BANK ACCOUNT';
 const [blocked]=entryRowsFromValues([h,entryRow],'synthetic-entry','51GAME',1,'2026-09-27T00:00:00Z');assert.equal(blocked.upi_id,null);assert.equal(blocked.kyc_upi_id,null);assert(!JSON.stringify(blocked).includes('PRIVATE-MEMBER'));
});

test('soft archival preserves old rows, restores present rows, and is idempotent with exact tab scope',async()=>{
 const issue={table:'admin_deposit_issue_rows',id:'old-result',source_sheet:'synthetic_source_12345',source_tab:'UPI核对',source_row:3,updated_at:'2026-09-23T00:00:00Z',stale_at:null};
 const entry={table:'admin_deposit_followup_rows',id:'old-entry',source_sheet:'synthetic_entries_12345',source_tab:'51GAME',source_row:3,source_kind:'sheet',updated_at:'2026-09-23T00:00:00Z',stale_at:null};
 const initialRows=[issue,entry,{...entry,id:'other-tab',source_tab:'NOT_READ'},{...entry,id:'other-source',source_sheet:'other_workbook'},{...entry,id:'portal',source_kind:'portal'},{...entry,id:'newer-run',updated_at:'2026-09-24T11:00:00Z'},
 {...entry,id:'synthetic_entries_12345:51GAME:2',source_row:2,stale_at:'2026-09-23T01:00:00Z'}];
 const h=harness({initialRows});assert.equal((await h.call()).status,200);const get=id=>[...h.stored.values()].find(r=>r.id===id);
 assert.equal(h.stored.size,initialRows.length+1,'existing rows are never removed; only the current result is new');
 for(const id of ['old-result','old-entry'])assert.equal(get(id).stale_at,'2026-09-24T10:00:00.000Z');
 for(const id of ['other-tab','other-source','portal','newer-run','synthetic_entries_12345:51GAME:2'])assert.equal(get(id).stale_at,null);
 const snapshot=JSON.stringify([...h.stored.values()]);assert.equal((await h.call()).status,200);assert.equal(JSON.stringify([...h.stored.values()]),snapshot,'repeated complete reads do not duplicate or alter archival state');
});
test('failed soft archival retains every persisted row and reports failure without deletion',async()=>{
 const old={table:'admin_deposit_issue_rows',id:'old',source_sheet:'synthetic_source_12345',source_tab:'UPI核对',updated_at:'2026-09-23T00:00:00Z',stale_at:null,amount:987};
 const h=harness({failArchive:true,initialRows:[old]}),response=await h.call();assert.equal(response.status,503);assert.deepEqual(h.stored.get(old.table+':old'),old);assert.equal(h.stored.size,3);assert(!h.calls.some(x=>x.init.method==='DELETE'));assert(!JSON.stringify(await response.json()).includes('PRIVATE'));
});

test('October follow-up source replaces only the known retired default or legacy environment value',async()=>{
 for(const configured of [undefined,'',DEFAULT_ENTRY_SOURCE_ID,HISTORICAL_ENTRY_SOURCE_ID,'https://docs.google.com/spreadsheets/d/'+HISTORICAL_ENTRY_SOURCE_ID+'/edit?gid=0#gid=0']){
  const h=harness({envOverrides:{DEPOSIT_FOLLOWUP_SHEET_ID:configured}}),response=await h.call();assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.entrySource,DEFAULT_ENTRY_SOURCE_ID);assert.equal(body.entrySourceRole,'current');assert.equal(body.entryTabs,17);
  assert.equal(body.entrySourceMigrated,!!configured&&configured.includes(HISTORICAL_ENTRY_SOURCE_ID));
  assert.deepEqual(body.historicalEntrySources,[{source:HISTORICAL_ENTRY_SOURCE_ID,role:'historical',sync:false}]);
  const entryReads=h.calls.filter(x=>x.url.origin==='https://sheets.googleapis.com'&&!x.url.pathname.includes('synthetic_source_'));
  assert.equal(entryReads.length,6,'one metadata read and five bounded tab batches; no second workbook scan');
  assert(entryReads.every(x=>x.url.pathname.includes(DEFAULT_ENTRY_SOURCE_ID)));
  assert(!h.calls.some(x=>x.url.href.includes(HISTORICAL_ENTRY_SOURCE_ID)),'historical workbook is not read or archived');
  assert(h.writes[1].every(r=>r.source_sheet===DEFAULT_ENTRY_SOURCE_ID));
  assert(!JSON.stringify(body).includes('synthetic-service-key'));assert(!JSON.stringify(body).includes('synthetic-google-token'));assert(!JSON.stringify(body).includes('example@example.invalid'));
 }
 const custom=harness(),body=await (await custom.call()).json();assert.equal(body.entrySource,'synthetic_entries_12345');assert.equal(body.entrySourceMigrated,false);assert.equal(body.entryTabs,16,'unrelated custom overrides retain their supported tab profile');
});

test('switching to October preserves historical originals and portal rows through repeated successful mirrors',async()=>{
 const history={table:'admin_deposit_followup_rows',id:HISTORICAL_ENTRY_SOURCE_ID+':51GAME:2',source_sheet:HISTORICAL_ENTRY_SOURCE_ID,source_tab:'51GAME',source_row:2,source_kind:'sheet',country:'印度',platform:'51GAME',order_number:entryRow[2],amount:1250.5,followup_status:'Not Yet Received',updated_at:'2026-09-30T00:00:00Z',stale_at:null};
 const portal={...history,id:'PORTAL:synthetic',source_sheet:'PORTAL',source_tab:'synthetic',source_kind:'portal',followup_status:'Success'};
 const h=harness({envOverrides:{DEPOSIT_FOLLOWUP_SHEET_ID:HISTORICAL_ENTRY_SOURCE_ID},initialRows:[history,portal]});
 for(let i=0;i<2;i++){
  assert.equal((await h.call()).status,200);
  assert.deepEqual(h.stored.get(history.table+':'+history.id),history);assert.deepEqual(h.stored.get(portal.table+':'+portal.id),portal);
 }
 assert.equal(h.stored.size,4,'old sheet + portal + new source original + result mirror; no repeated inserts');
 const current=h.stored.get('admin_deposit_followup_rows:'+DEFAULT_ENTRY_SOURCE_ID+':51GAME:2');assert.equal(current.order_number,history.order_number);assert.equal(current.followup_status,'Success To Other Platform','mirror preserves differing source evidence for reader conflict handling');
 assert(h.calls.filter(x=>x.init.method==='PATCH'&&x.url.pathname.endsWith('admin_deposit_followup_rows')).every(x=>x.url.searchParams.get('source_sheet')==='eq.'+DEFAULT_ENTRY_SOURCE_ID));
});

test('9KCLUB is required in the current workbook and retained under its exact name without granting scope',async()=>{
 const h=harness({envOverrides:{DEPOSIT_FOLLOWUP_SHEET_ID:DEFAULT_ENTRY_SOURCE_ID},entryValues:{'9KCLUB':[entryHeaders,entryRow]}}),response=await h.call();assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.entryRows,2);assert.equal(body.entryTabs,17);
 const row9k=h.writes.flat().find(r=>r.platform==='9KCLUB');assert(row9k);assert.equal(row9k.source_tab,'9KCLUB');assert.equal(row9k.source_sheet,DEFAULT_ENTRY_SOURCE_ID);assert.equal(row9k.followup_status,'Success To Other Platform');assert.equal(row9k.followup_date,'2026-09-25');assert.equal(row9k.receipt_text,'29');
 assert(!('team' in row9k));assert(!('scope' in row9k));assert(!('portal_team' in row9k));
 assert(h.calls.filter(x=>x.url.origin==='https://synthetic-project.supabase.co').every(x=>['admin_deposit_followup_rows','admin_deposit_issue_rows'].includes(x.url.pathname.split('/').at(-1))));
 const incomplete=harness({envOverrides:{DEPOSIT_FOLLOWUP_SHEET_ID:DEFAULT_ENTRY_SOURCE_ID},metadataTabs:[...ENTRY_TABS]}),failed=await incomplete.call();assert.equal(failed.status,502);const partial=await failed.json();assert.equal(partial.code,'deposit_issue_sync_partial');assert.equal(partial.sourceResults.entries.code,'entry_tabs_incomplete');assert.equal(partial.sourceResults.entries.stage,'entry_metadata');assert.equal(partial.sourceResults.result.ok,true);assert(!incomplete.writes.flat().some(r=>r.source_sheet===DEFAULT_ENTRY_SOURCE_ID));assert(!incomplete.calls.some(x=>x.init.method==='PATCH'&&x.url.pathname.endsWith('admin_deposit_followup_rows')));
});

test('current source read failure exits once and leaves historical rows untouched',async()=>{
 const old={table:'admin_deposit_followup_rows',id:'old',source_sheet:HISTORICAL_ENTRY_SOURCE_ID,source_tab:'51GAME',source_row:2,source_kind:'sheet',updated_at:'2026-09-30T00:00:00Z',stale_at:null};
 const h=harness({envOverrides:{DEPOSIT_FOLLOWUP_SHEET_ID:DEFAULT_ENTRY_SOURCE_ID},failEntryRead:true,initialRows:[old]}),response=await h.call();assert.equal(response.status,503);const body=await response.json();assert.equal(body.ok,false);assert.equal(body.code,'deposit_issue_sync_partial');assert.equal(body.sourceResults.entries.code,'upstream_request_failed');assert.equal(body.sourceResults.entries.stage,'entry_read');assert.equal(body.sourceResults.result.ok,true);
 assert.equal(h.calls.filter(x=>x.url.pathname.includes(DEFAULT_ENTRY_SOURCE_ID)&&x.url.pathname.endsWith('/values:batchGet')).length,1,'failed Google request is not retried in a loop');
 assert.deepEqual(h.stored.get(old.table+':old'),old);assert.equal(h.stored.size,2,'result source independently refreshed');assert(!h.calls.some(x=>x.init.method==='DELETE'||x.init.method==='PATCH'&&x.url.pathname.endsWith('admin_deposit_followup_rows')));
});

test('a result timeout cannot hold up the complete current 17-tab mirror; partial receipt is explicit and safe',async()=>{
 let abortResult,timers=0,entryCommittedBeforeTimeout=false;
 const timedModule={exports:{}};
 new Function('module','exports','setTimeout','clearTimeout',compiled)(timedModule,timedModule.exports,(fn,delay)=>++timers===2?(abortResult=fn,-1):setTimeout(fn,delay),id=>{if(id!==-1)clearTimeout(id)});
 const historical={table:'admin_deposit_followup_rows',id:'history',source_sheet:HISTORICAL_ENTRY_SOURCE_ID,source_tab:'51GAME',source_row:2,source_kind:'sheet',updated_at:'2026-09-01T00:00:00Z',stale_at:null};
 const oldResult={table:'admin_deposit_issue_rows',id:'old-result',source_sheet:'synthetic_source_12345',source_tab:'UPI核对',source_row:3,updated_at:'2026-09-01T00:00:00Z',stale_at:null};
 const h=harness({handlerFactory:timedModule.exports.createDepositIssueSyncHandler,envOverrides:{DEPOSIT_FOLLOWUP_SHEET_ID:DEFAULT_ENTRY_SOURCE_ID},initialRows:[historical,oldResult],onRequest:async(url,init)=>{
  if(url.origin==='https://sheets.googleapis.com'&&url.pathname.includes('synthetic_source_'))await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('PRIVATE timeout context')),{once:true}));
  if(init.method==='PATCH'&&url.searchParams.get('source_tab')==='eq.9KCLUB'){
   entryCommittedBeforeTimeout=h.stored.has('admin_deposit_followup_rows:'+DEFAULT_ENTRY_SOURCE_ID+':51GAME:2');abortResult();
  }
 }});
 const response=await h.call(),body=await response.json();assert.equal(response.status,504);assert.equal(body.ok,false);assert.equal(body.code,'deposit_issue_sync_partial');assert(entryCommittedBeforeTimeout);
 assert.deepEqual(body.sourceResults.result,{ok:false,stage:'result_read',code:'sync_request_timed_out',rowsRead:0,rowsWritten:0,tabsRead:0});
 assert.deepEqual(body.sourceResults.entries,{ok:true,stage:'complete',rowsRead:1,rowsWritten:1,tabsRead:17,syncedAt:'2026-09-24T10:00:00.000Z'});
 assert.equal(h.calls.filter(x=>x.url.origin==='https://sheets.googleapis.com'&&x.url.pathname.includes('synthetic_source_')).length,1);assert.equal(h.maxInFlight(),2);
 assert.deepEqual(h.stored.get(oldResult.table+':'+oldResult.id),oldResult);assert.deepEqual(h.stored.get(historical.table+':'+historical.id),historical);
 assert(!h.calls.some(x=>x.init.method==='PATCH'&&x.url.pathname.endsWith('admin_deposit_issue_rows')));
 assert(!/PRIVATE|https:|synthetic-google-token|synthetic-service-key/.test(JSON.stringify(body.sourceResults)));
});

test('per-source error stages distinguish metadata, read, writes and archival without repeated requests',async()=>{
 for(const [options,key,stage] of [[{failResultRead:true},'result','result_read'],[{failEntryMetadata:true},'entries','entry_metadata'],[{failEntryRead:true},'entries','entry_read'],[{failEntries:true},'entries','db_upsert'],[{failArchive:true},'result','db_archive']]){
  const h=harness(options),response=await h.call(),body=await response.json();assert(response.status>=400);assert.equal(body.ok,false);assert.equal(body.sourceResults[key].ok,false);assert.equal(body.sourceResults[key].stage,stage);assert.equal(body.sourceResults[key].syncedAt,undefined);assert(h.maxInFlight()<=2);
  assert(!JSON.stringify(body.sourceResults).includes('PRIVATE'));assert(!h.calls.some(x=>x.init.method==='DELETE'));
 }
});

test('partial result failures can be rerun without changing history or duplicating the successful current source',async()=>{
 const historical={table:'admin_deposit_followup_rows',id:'history',source_sheet:HISTORICAL_ENTRY_SOURCE_ID,source_tab:'51GAME',source_row:2,source_kind:'sheet',updated_at:'2026-09-01T00:00:00Z',stale_at:null};
 const h=harness({failResultRead:true,envOverrides:{DEPOSIT_FOLLOWUP_SHEET_ID:DEFAULT_ENTRY_SOURCE_ID},initialRows:[historical]});
 const first=await (await h.call()).json();assert.equal(first.sourceResults.entries.ok,true);assert.equal(first.sourceResults.result.ok,false);const before=JSON.stringify([...h.stored.values()]);
 assert.equal((await h.call()).status,503);assert.equal(JSON.stringify([...h.stored.values()]),before);assert.equal(h.stored.size,2);assert.deepEqual(h.stored.get(historical.table+':'+historical.id),historical);
});
