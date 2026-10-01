// Exercise actual rendered read-query handlers without native submission (the production iframe blocks forms).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=name=>fs.readFileSync(path.join(__dirname,'../admin-preview',name),'utf8');
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(setImmediate)};
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function context(){const c={document:{getElementById:()=>null},Date,Intl};c.window=c;vm.createContext(c);return c;}
function handlers(html){const form=html.match(/<form\b([^>]*)>/)?.[1],button=html.match(/<button\b([^>]*)>查询<\/button>/)?.[1];assert(form&&button,'real query form/button must render');assert.match(button,/type="button"/);assert.match(form,/onsubmit="return false"/);return {click:button.match(/onclick="([^"]*)"/)[1],key:form.match(/onkeydown="([^"]*)"/)[1],submit:form.match(/onsubmit="([^"]*)"/)[1]};}
function invoke(c,code,self,event){c.__self=self;c.__event=event;return vm.runInContext('(function(event){'+code+'}).call(__self,__event)',c);}
function enter(extra={}){return {key:'Enter',target:{tagName:'INPUT',type:'search'},defaultPrevented:false,preventDefault(){this.defaultPrevented=true},...extra};}
async function fixture(kind){
 const c=context(),calls=[];let html,changed=0;
 const shared={E:escape,C:String,N:String,R:()=>'',metric:()=>'',box:(_,body)=>body,table:()=>'',pager:()=>'',formatTime:String,request:async q=>{calls.push(q);return {rows:[],total:0,summary:{}}},render:()=>{}};
 if(kind==='deposit'){
  vm.runInContext(source('live-workorder-operations.js'),c);vm.runInContext(source('live-deposit-issues.js'),c);
  const L={catalogReady:true,catalog:[{country:'印度',name:'DEMO'}],country:'印度',from:'2026-09-01T00:00:00',to:'2026-09-30T23:59:59',depositIssuesSize:20,depositIssuesPage:1,depositIssuesSerial:0,depositIssuesPlatform:'all',depositIssuesStatus:'all'};
  const api=c.HensemLiveDepositIssues.create({...shared,L,page:()=> 'deposit_tracking'});html=api.render();return {c,calls,html,changeAmount:(min,max)=>{c.depositIssuesSet('amountMin',min);c.depositIssuesSet('amountMax',max)},state:L};
 }
 if(kind==='provider'||kind==='platform'){
  vm.runInContext(source('live-configuration.js'),c);c.providerConfigLoad=reset=>calls.push({kind:'provider',reset});c.platformAssignmentsLoad=reset=>calls.push({kind:'platform',reset});
  const api=c.HensemLiveConfiguration.create({...shared,L:{country:'印度',providerConfig:{},platformAssignments:{options:{}},teamPlatformCountry:'all'},changed:()=>{}});html=kind==='provider'?api.providerView():api.platformView();return {c,calls,html};
 }
 if(kind==='payout'){
  vm.runInContext(source('live-payout-config.js'),c);const api=c.HensemLivePayoutConfig,t={platform:'DEMO',country_code:'IN',country_name:'印度',display_group:'IN',timezone:'Asia/Kolkata'};
  api.configure({request:async q=>{calls.push(q);return q.operation==='index'?{version:1,system:q.system,targets:[t],summaries:[],readOnly:true}:{version:1,system:q.system,target:t,snapshot:null,readOnly:true}}});await api.loadIndex();calls.length=0;return {c,calls,html:api.render()};
 }
 vm.runInContext(source('live-empty-pages.js'),c);const api=c.HensemLiveEmpty,page=api.pages.find(p=>p!=='access');c.document.getElementById=()=>({set innerHTML(v){changed++;calls.push({local:true})}});return {c,calls,html:api.render(page)};
}
for(const kind of ['deposit','provider','platform','payout','empty'])test(kind+' query button and Enter work without submit; invalid inputs and IME never issue requests',async()=>{
 const h=await fixture(kind),wire=handlers(h.html),reads=n=>kind==='payout'?0:n;let checks=0;const form={elements:{platform:{value:'DEMO'}},reportValidity(){checks++;return true}};
 invoke(h.c,wire.click,{form});await settle();assert.equal(h.calls.length,reads(1),'one click queries once; cached config search stays local');assert.equal(checks,1);
 const key=enter();invoke(h.c,wire.key,form,key);await settle();assert.equal(h.calls.length,reads(2));assert.equal(key.defaultPrevented,true,'prevent subsequent native submission');
 assert.equal(invoke(h.c,wire.submit,form,{}),false);assert.equal(h.calls.length,reads(2),'submit cannot duplicate query');
 for(const event of [enter({isComposing:true}),enter({keyCode:229}),enter({repeat:true}),enter({defaultPrevented:true}),enter({key:'Escape'}),enter({ctrlKey:true}),enter({target:{tagName:'TEXTAREA',type:'textarea'}}),enter({target:{tagName:'SELECT',type:'select-one'}}),enter({target:{tagName:'BUTTON',type:'button'}}),enter({target:{tagName:'INPUT',type:'checkbox'}}),enter({target:{tagName:'INPUT',type:'radio'}})])invoke(h.c,wire.key,form,event);
 await settle();assert.equal(h.calls.length,reads(2),'keyboard selection, IME, held key and already-handled event are ignored');
 form.reportValidity=()=>false;invoke(h.c,wire.click,{form});const invalid=enter();invoke(h.c,wire.key,form,invalid);await settle();assert.equal(invalid.defaultPrevented,true);assert.equal(h.calls.length,reads(2),'native field validity is preserved');
});
test('deposit amount validation still rejects an inverted range after the native checks pass',async()=>{
 const h=await fixture('deposit'),wire=handlers(h.html);h.changeAmount('100','10');invoke(h.c,wire.click,{form:{reportValidity:()=>true}});await settle();assert.equal(h.calls.length,0);assert.match(h.state.depositIssuesError,/最低金额不能大于最高金额/);
});
test('configuration write dialog remains unchanged and no iframe permission is broadened',()=>{
 const s=source('live-configuration.js');assert.match(s,/onsubmit="event.preventDefault\(\);configSave\(\)"/);assert.match(s,/<button class="btn primary" type="submit">保存/);
 const host=fs.readFileSync(path.join(__dirname,'../src/components/OwnerAdminPreview.tsx'),'utf8');assert.match(host,/sandbox="allow-scripts allow-downloads"/);assert.doesNotMatch(host,/allow-forms/);
});
