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

test('ambiguous all-team Brazil selection cannot silently request ordinary Brazil',async()=>{
 const f=fixture({team:'all'});await f.page.load();assert.equal(f.calls.length,0);assert.match(f.page.state.error,/多个团队/);assert.match(f.page.render(),/先选择一个团队/);f.context.withdrawTeam('胖虎');await f.page.load();assert.equal(f.calls[0].country,'胖虎巴西');
});

test('switching between identical platform names clears stale platform selections and retains the correct raw source',async()=>{
 const f=fixture();await f.page.load();f.page.state.platforms=['PH-ONLY'];f.context.withdrawTeam('M8');assert.equal(f.L.country,'巴西');assert.deepEqual(plain(f.L.multi.team),['M8']);assert.equal(f.page.state.data,null);await f.page.load();assert.equal(f.calls.at(-1).country,'巴西');assert.deepEqual(f.calls.at(-1).platforms,['SAME','M8-ONLY']);assert.doesNotMatch(f.page.render(),/PH-ONLY/);f.page.cancel();assert.deepEqual(plain(f.L.multi.team),['M8']);
});

test('legacy country navigation is translated to display country plus an explicit team',async()=>{
 const f=fixture({country:'印度',team:'all',catalog:[{name:'IN-ONE',country:'印度',team:'M8'},...m8]});f.context.withdrawCountry('胖虎巴西');assert.equal(f.L.country,'巴西');assert.deepEqual(plain(f.L.multi.team),['胖虎']);await f.page.load();assert.equal(f.calls[0].country,'胖虎巴西');assert.deepEqual(f.calls[0].platforms,['SAME','PH-ONLY']);
});

test('country source groups for Hong Kong and Red Crab are only exposed as teams',async()=>{
 const f=fixture({country:'国家待核对',team:'香港',withdrawCatalog:[],catalog:[{name:'HK-A',country:'香港',team:'香港',source:'game66'},{name:'RC-A',country:'红膏蟹',team:'红膏蟹',source:'game66'}]});await f.page.load();assert.equal(f.calls[0].country,'香港');assert.deepEqual(f.calls[0].platforms,['HK-A']);const html=f.page.render();assert.match(html,/<option selected>国家待核对/);assert.doesNotMatch(html,/<option[^>]*>香港<\/option>[^]*国家 \/ 地区[^]*<option[^>]*>香港/);f.context.withdrawTeam('红膏蟹');await f.page.load();assert.equal(f.calls.at(-1).country,'红膏蟹');assert.deepEqual(f.calls.at(-1).platforms,['RC-A']);
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
