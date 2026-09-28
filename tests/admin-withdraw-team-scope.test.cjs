// Synthetic UI fixtures only: source grouping must survive display-country normalization.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const plain=value=>JSON.parse(JSON.stringify(value));
const source=name=>fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8');
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const m8=[{id:'m8-same',name:'SAME',country:'巴西',team:'M8',source:'ar',timezone:'America/Sao_Paulo'},{id:'m8-only',name:'M8-ONLY',country:'巴西',team:'M8',source:'ar'}];
const ph=[{id:'ph-same',name:'SAME',country:'胖虎巴西',team:'胖虎',scopeGroup:'BR_PANGHU',source:'withdraw',timezone:'America/Sao_Paulo'},{id:'ph-only',name:'PH-ONLY',country:'胖虎巴西',team:'胖虎',scopeGroup:'BR_PANGHU',source:'withdraw'}];
function fixture({catalog=m8,withdrawCatalog=ph,country='巴西',team='胖虎',view='auto_withdraw',respond}={}){
 const calls=[],L={catalogReady:true,catalog,withdrawCatalog,country,team,multi:{team:team==='all'?[]:[team]},from:'2026-09-24T00:00:00',to:'2026-09-25T23:59:59'},context={Date,Intl,document:{getElementById:()=>null,querySelector:()=>null},HensemLiveFilters:{multi:({items})=>'<div class="test-platforms">'+items.map(x=>E(x[0])).join('|')+'</div>'}};context.window=context;vm.createContext(context);vm.runInContext(source('live-report-data.js'),context);vm.runInContext(source('live-withdraw-pages.js'),context);
 const page=context.HensemLiveWithdrawPages.create({L,E,C:String,N:String,R:(n,d)=>d?String(n/d*100)+'%':'—',box:(_,body)=>body,table:(headers,rows)=>'<table>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</table>',render:()=>{},page:()=>view,request:async q=>{calls.push(plain(q));if(respond)return respond(q);if(q.action==='withdrawReasons')return {available:false};if(q.action==='withdrawNote')return {...q,version:'saved'};return {rows:[{country:q.country,platform:'SAME',total:4,success:3,rejected:1}],totals:{total:4},notes:[],canWriteNotes:true}}});return {L,context,page,calls};
}

test('entering automatic withdrawals from Panghu/Brazil queries only the original Panghu scope',async()=>{
 const f=fixture();await f.page.load();assert.equal(f.calls[0].country,'胖虎巴西');assert.deepEqual(f.calls[0].platforms,['SAME','PH-ONLY']);assert.equal(f.L.country,'巴西');assert.deepEqual(plain(f.L.multi.team),['胖虎']);assert.equal(f.page.state.data.rawCountry,'胖虎巴西');const html=f.page.render();assert.match(html,/所属团队/);assert.match(html,/<option value="胖虎" selected>胖虎/);assert.match(html,/<option selected>巴西/);assert.doesNotMatch(html,/M8-ONLY|<option[^>]*>胖虎巴西/);
 f.page.cancel();assert.equal(f.L.country,'巴西');assert.deepEqual(plain(f.L.multi.team),['胖虎'],'leaving for overview retains the selected team');
});

test('all-team Brazil explicitly requests both authorized original sources',async()=>{
 const f=fixture({team:'all'});await f.page.load();assert.equal(f.calls.length,1);assert.equal(f.calls[0].country,'巴西');assert.deepEqual(f.calls[0].scopeTargets,[{country:'巴西',platforms:['SAME','M8-ONLY']},{country:'胖虎巴西',platforms:['SAME','PH-ONLY']}]);assert.equal(f.page.state.error,'');f.context.withdrawTeam('胖虎');await f.page.load();assert.equal(f.calls.at(-1).country,'胖虎巴西');assert.equal(f.calls.at(-1).scopeTargets,undefined);
});

test('switching between identical platform names clears stale platform selections and retains the correct raw source',async()=>{
 const f=fixture();await f.page.load();f.page.state.platforms=['PH-ONLY'];f.context.withdrawTeam('M8');assert.equal(f.L.country,'巴西');assert.deepEqual(plain(f.L.multi.team),['M8']);assert.equal(f.page.state.data,null);await f.page.load();assert.equal(f.calls.at(-1).country,'巴西');assert.deepEqual(f.calls.at(-1).platforms,['SAME','M8-ONLY']);assert.doesNotMatch(f.page.render(),/PH-ONLY/);f.page.cancel();assert.deepEqual(plain(f.L.multi.team),['M8']);
});

test('legacy country navigation is translated to display country plus an explicit team',async()=>{
 const f=fixture({country:'印度',team:'all',catalog:[{name:'IN-ONE',country:'印度',team:'M8'},...m8]});f.context.withdrawCountry('胖虎巴西');assert.equal(f.L.country,'巴西');assert.deepEqual(plain(f.L.multi.team),['胖虎']);await f.page.load();assert.equal(f.calls[0].country,'胖虎巴西');assert.deepEqual(f.calls[0].platforms,['SAME','PH-ONLY']);
});

test('country source groups for Hong Kong and Red Crab are only exposed as teams',async()=>{
 const f=fixture({country:'印度',team:'香港',withdrawCatalog:[],catalog:[{name:'HK-A',country:'香港',team:'香港',source:'game66'},{name:'RC-A',country:'红膏蟹',team:'红膏蟹',source:'game66'}]});await f.page.load();assert.equal(f.calls[0].country,'香港');assert.deepEqual(f.calls[0].platforms,['HK-A']);const html=f.page.render();assert.match(html,/<option selected>印度/);assert.doesNotMatch(html,/<option[^>]*>香港<\/option>[^]*国家 \/ 地区[^]*<option[^>]*>香港/);f.context.withdrawTeam('红膏蟹');await f.page.load();assert.equal(f.calls.at(-1).country,'红膏蟹');assert.deepEqual(f.calls.at(-1).platforms,['RC-A']);
});

test('India all-team navigation cannot collapse three authorized source groups into the M8 query',async()=>{
 const catalog=[{name:'M8-A',country:'印度',scopeGroup:'IN',team:'M8',source:'ar'},{name:'HK-A',country:'香港',scopeGroup:'HK_TEAM',team:'香港',source:'game66'},{name:'RC-A',country:'红膏蟹',scopeGroup:'RED_CRAB',team:'红膏蟹',source:'game66'}];
 const f=fixture({country:'印度',team:'all',catalog,withdrawCatalog:[]});await f.page.load();assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].scopeTargets,[{country:'印度',platforms:['M8-A']},{country:'香港',platforms:['HK-A']},{country:'红膏蟹',platforms:['RC-A']}]);
 for(const [team,country,platform]of [['香港','香港','HK-A'],['红膏蟹','红膏蟹','RC-A'],['M8','印度','M8-A']]){
  f.context.withdrawTeam(team);await f.page.load();assert.equal(f.calls.at(-1).country,country);assert.deepEqual(f.calls.at(-1).platforms,[platform]);
  f.page.cancel();assert.equal(f.L.country,'印度');assert.deepEqual(plain(f.L.multi.team),[team],'returning to overview keeps the selected team under India');
 }
});

test('reason and note detail requests preserve the raw row country after rendering it as Brazil',async()=>{
 const f=fixture();await f.page.load();f.context.withdrawReasons(0,'blocking');await new Promise(setImmediate);assert.equal(f.calls.at(-1).country,'胖虎巴西');f.context.withdrawNoteOpen(0);f.context.withdrawNoteInput('synthetic note');await f.context.withdrawNoteSave();assert.equal(f.calls.at(-1).action,'withdrawNote');assert.equal(f.calls.at(-1).country,'胖虎巴西');assert.equal(f.calls.at(-1).platform,'SAME');
});

test('operator statistics use the same team source resolution and ordinary single-country queries stay compatible',async()=>{
 const phOperators=fixture({view:'withdraw_operators'});await phOperators.page.load();assert.equal(phOperators.calls[0].view,'operators');assert.equal(phOperators.calls[0].country,'胖虎巴西');
 const india=fixture({catalog:[{name:'ONE',country:'印度',team:'M8'}],withdrawCatalog:[],country:'印度',team:'all'});await india.page.load();assert.equal(india.calls[0].country,'印度');assert.deepEqual(india.calls[0].platforms,[]);
});

test('a team without matching metadata never falls through to another team or a country-wide query',async()=>{
 const f=fixture({team:'UNKNOWN'});await f.page.load();assert.equal(f.calls.length,0);assert.match(f.page.state.error,/没有可读取/);const specific=fixture();specific.page.state.platforms=['M8-ONLY'];await specific.page.load();assert.equal(specific.calls.length,0);assert.match(specific.page.state.error,/不属于当前团队/);
});

test('withdraw page snapshots preserve filters, loaded data and unsaved note draft with independent cancellation serials',async()=>{
 const f=fixture();await f.page.load();f.page.state.account='SAVED';f.page.state.platforms=['PH-ONLY'];f.page.state.page=3;f.page.state.noteDraft='unsaved note';const data=f.page.state.data,saved=f.page.capture(),serial=f.page.state.serial,reads=f.calls.length;
 f.page.pause();f.page.restore(null);f.page.state.account='OTHER';f.page.state.platforms=['SAME'];f.page.restore(saved);
 assert.equal(f.page.state.data,data);assert.equal(f.page.state.account,'SAVED');assert.deepEqual(plain(f.page.state.platforms),['PH-ONLY']);assert.equal(f.page.state.page,3);assert.equal(f.page.state.noteDraft,'unsaved note');assert(f.page.state.serial>serial);f.page.render();assert.equal(f.calls.length,reads);
});

test('confirmed SUPERLG history is a separate exact authorized source and never blocks current Philippines queries',async()=>{
 const rows=[{name:'SUPERLG',country:'菲律宾',team:'M8',scopeGroup:'PH'},{name:'PH19',country:'菲律宾',team:'M8',scopeGroup:'PH'},{name:'SUPERLG',country:'LG',team:'M8',scopeGroup:'LG'}];
 for(const view of ['auto_withdraw','withdraw_operators']){
  const f=fixture({catalog:[],withdrawCatalog:rows,country:'菲律宾',team:'M8',view});await f.page.load();assert.equal(f.calls.at(-1).country,'菲律宾');assert.deepEqual(f.calls.at(-1).platforms,['SUPERLG','PH19']);assert.match(f.page.render(),/当前记录/);assert.match(f.page.render(),/历史记录（2026-07-30）/);
  const before=f.calls.length,from=f.L.from,to=f.L.to;f.context.withdrawHistorical('historical');assert.equal(f.calls.length,before,'source selection waits for manual query');assert.equal(f.L.from,from);assert.equal(f.L.to,to);assert.equal(f.L.team,'M8');await f.page.load();assert.equal(f.calls.at(-1).country,'LG');assert.deepEqual(f.calls.at(-1).platforms,['SUPERLG']);assert.equal(f.page.state.data.rawCountry,'LG');
  const saved=f.page.capture(),data=f.page.state.data;f.page.restore(null);f.page.restore(saved);assert.equal(f.page.state.historical,true);assert.equal(f.page.state.data,data);assert.equal(f.L.from,from);assert.match(f.page.render(),/value="historical" selected/);assert.equal(f.calls.length,before+1,'restoring a tab does not read again');
  f.context.withdrawHistorical('current');await f.page.load();assert.equal(f.calls.at(-1).country,'菲律宾');assert.deepEqual(f.calls.at(-1).platforms,['SUPERLG','PH19']);
 }
});

test('historical source switch requires the exact authorized identity, has a fixed platform and does not create a selectable fake team',async()=>{
 const onlyCurrent=fixture({catalog:[],withdrawCatalog:[{name:'SUPERLG',country:'菲律宾',team:'M8'}],country:'菲律宾',team:'M8'});onlyCurrent.context.withdrawHistorical('historical');assert.equal(onlyCurrent.page.state.historical,false);assert.doesNotMatch(onlyCurrent.page.render(),/历史记录（2026-07-30）/);await onlyCurrent.page.load();assert.equal(onlyCurrent.calls[0].country,'菲律宾');
 const onlyHistory=fixture({catalog:[],withdrawCatalog:[{name:'SUPERLG',country:'LG',team:'M8'}],country:'菲律宾',team:'all'});onlyHistory.context.withdrawHistorical('historical');await onlyHistory.page.load();assert.equal(onlyHistory.calls[0].country,'LG');assert.deepEqual(onlyHistory.calls[0].platforms,['SUPERLG'],'all-team selection must still pin the one confirmed historical platform');
 const pending=fixture({catalog:[],withdrawCatalog:[{name:'PENDING',country:'菲律宾',team:null},{name:'CONFLICT',country:'菲律宾',team:'__team_conflict__'}],country:'菲律宾',team:'all'});assert.doesNotMatch(pending.page.render(),/<option[^>]+value="(?:__team_pending__|__team_conflict__|__unassigned__)"/);pending.context.withdrawTeam('__team_pending__');assert.equal(pending.L.team,'all');
});

test('historical table, reason and note displays use Philippines while every detail request preserves LG',async()=>{
 const f=fixture({catalog:[],withdrawCatalog:[{name:'SUPERLG',country:'LG',team:'M8'}],country:'菲律宾',team:'M8',respond:q=>q.action==='autoWithdraw'?{rows:[{country:'LG',platform:'SUPERLG',total:1,success:1,rejected:0}],totals:{total:1},notes:[],canWriteNotes:true}:q.action==='withdrawReasons'?{available:false}:{...q,version:'saved'}});
 f.L.from='2026-07-30T00:00:00';f.L.to='2026-07-30T23:59:59';f.context.withdrawHistorical('historical');await f.page.load();assert.match(f.page.render(),/<td>菲律宾<\/td><td>SUPERLG<\/td>/);assert.doesNotMatch(f.page.render(),/<td>LG<\/td>/);
 f.context.withdrawReasons(0,'blocking');await new Promise(setImmediate);assert.equal(f.calls.at(-1).country,'LG');assert.equal(f.calls.at(-1).platform,'SUPERLG');assert.match(f.page.render(),/<span>菲律宾 · SUPERLG<\/span>/);assert.equal(f.page.state.reason.country,'LG');
 f.context.withdrawNoteOpen(0);assert.match(f.page.render(),/class="config-context">菲律宾 · SUPERLG<\/div>/);assert.equal(f.page.state.note.country,'LG');f.context.withdrawNoteInput('Synthetic historical note');await f.context.withdrawNoteSave();assert.equal(f.calls.at(-1).country,'LG');assert.equal(f.calls.at(-1).platform,'SUPERLG');
});


test('same-name rows under multiple teams keep independent notes, saves and day drilldowns',async()=>{
 const f=fixture({team:'all',respond:q=>q.action==='withdrawNote'?{...q,version:'saved'}:{rows:[{country:'巴西',platform:'SAME',total:4},{country:'胖虎巴西',platform:'SAME',total:7}],totals:{total:11},notes:[{country:'BR',sourceCountry:'巴西',platform:'SAME',date:'2026-09-25',reason:'M8 original'},{country:'胖虎巴西',sourceCountry:'胖虎巴西',platform:'SAME',date:'2026-09-25',reason:'PH original'}],canWriteNotes:true}});
 await f.page.load();assert.match(f.page.render(),/巴西 · M8/);assert.match(f.page.render(),/巴西 · 胖虎/);f.context.withdrawNoteOpen(0);assert.equal(f.page.state.noteDraft,'M8 original');assert.equal(f.page.state.note.storageCountry,'BR');f.context.withdrawNoteInput('M8 saved');await f.context.withdrawNoteSave();assert.equal(f.calls.at(-1).country,'BR');assert.equal(f.page.state.data.notes.length,2);f.context.withdrawNoteOpen(1);assert.equal(f.page.state.noteDraft,'PH original');f.context.withdrawNoteClose();f.context.withdrawDaily(1);await new Promise(setImmediate);assert.equal(f.calls.at(-1).country,'胖虎巴西');assert.deepEqual(f.calls.at(-1).platforms,['SAME']);assert.equal(f.calls.at(-1).scopeTargets,undefined);f.context.withdrawMultiClear();await f.page.load();assert.equal(f.calls.at(-1).scopeTargets.length,2);
});
test('pending old-team response cannot overwrite the newly selected-team query',async()=>{
 let resolve;const f=fixture({team:'all',respond:q=>q.scopeTargets?new Promise(r=>resolve=r):{rows:[],totals:{total:2},notes:[]}});const previous=f.page.load();f.context.withdrawTeam('M8');await f.page.load();resolve({rows:[],totals:{total:999},notes:[]});await previous;assert.equal(f.page.state.data.totals.total,2);assert.equal(f.page.state.data.rawCountry,'巴西');assert.equal(f.page.state.dirty,false);
});


test('sandboxed preview query uses direct buttons and one guarded Enter action',async()=>{
 const f=fixture({team:'all'});f.context.withdrawTeam('M8');const html=f.page.render();assert.match(html,/<button type="button" class="btn primary" onclick="withdrawQueryForm\(this.form\)">查询<\/button>/);assert.match(html,/onkeydown="withdrawFilterKey\(event\)"/);await f.context.withdrawQueryForm({reportValidity:()=>true});assert.equal(f.calls.length,1);assert.equal(f.page.state.dirty,false);
 f.context.withdrawDate('from','2026-09-23');let prevented=0;const event={key:'Enter',target:{tagName:'INPUT',type:'date'},preventDefault(){prevented++}};await f.context.withdrawFilterKey(event);assert.equal(prevented,1);assert.equal(f.calls.length,2);assert.equal(f.calls.at(-1).startAt,'2026-09-23T00:00:00.000Z');assert.equal(f.page.state.dirty,false);
 await f.context.withdrawQueryForm({reportValidity:()=>false});assert.equal(f.calls.length,2);
 for(const next of [{...event,repeat:true},{...event,defaultPrevented:true},{...event,ctrlKey:true},{...event,metaKey:true},{...event,altKey:true},{...event,shiftKey:true},{...event,keyCode:229},{...event,isComposing:true},{...event,key:' '},{...event,target:{tagName:'SELECT'}},{...event,target:{tagName:'BUTTON'}},{...event,target:{tagName:'INPUT',type:'checkbox'}},{...event,target:{tagName:'TEXTAREA'}}])await f.context.withdrawFilterKey(next);assert.equal(f.calls.length,2);
 const shell=fs.readFileSync(path.join(__dirname,'../src/components/OwnerAdminPreview.tsx'),'utf8');assert.match(shell,/sandbox="allow-scripts allow-downloads"/);assert.doesNotMatch(shell,/allow-forms/);
});


test('ordinary country code aliases deduplicate one source while special team scopes remain separate',async()=>{
 const f=fixture({team:'all',catalog:[{name:'M8-A',country:'BR',team:'M8'},{name:'M8-A',country:'巴西',team:'M8'}],withdrawCatalog:[{name:'PH-A',country:'巴西',scopeGroup:'BR_PANGHU',team:'胖虎'}]});await f.page.load();assert.deepEqual(f.calls[0].scopeTargets,[{country:'巴西',platforms:['M8-A']},{country:'胖虎巴西',platforms:['PH-A']}]);f.context.withdrawTeam('M8');await f.page.load();assert.equal(f.calls.at(-1).country,'巴西');assert.deepEqual(f.calls.at(-1).platforms,['M8-A']);
 const g=fixture({team:'all',country:'IN',withdrawCatalog:[],catalog:[{name:'M8-A',country:'IN',team:'M8'},{name:'HK-A',country:'HK_TEAM',team:'香港'},{name:'RC-A',country:'RED_CRAB',team:'红膏蟹'}]});await g.page.load();assert.deepEqual(g.calls[0].scopeTargets,[{country:'印度',platforms:['M8-A']},{country:'香港',platforms:['HK-A']},{country:'红膏蟹',platforms:['RC-A']}]);
});


test('reason search shares the keyboard guard and submits only one plain Enter',async()=>{
 const f=fixture();await f.page.load();f.context.withdrawReasons(0,'rejection');await new Promise(setImmediate);let submitted=0,prevented=0;f.context.withdrawReasonSearch=()=>{submitted++};const event={key:'Enter',target:{tagName:'INPUT',type:'search'},preventDefault(){prevented++}};
 for(const flag of ['repeat','defaultPrevented','ctrlKey','metaKey','altKey','shiftKey','isComposing'])f.context.withdrawReasonQueryKey({...event,[flag]:true});f.context.withdrawReasonQueryKey({...event,keyCode:229});assert.equal(submitted,0);assert.equal(prevented,0);f.context.withdrawReasonQueryKey(event);assert.equal(submitted,1);assert.equal(prevented,1);
});
