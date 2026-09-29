const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),START=Date.parse('2026-09-29T10:00:00Z'),MIN=60000;
function fixture(){
 let now=START,next=0,loggedOut=0;const timers=new Map(),values=new Map();
 class Target{constructor(){this.listeners=new Map()}addEventListener(name,fn,options){const list=this.listeners.get(name)||[];list.push({fn,options});this.listeners.set(name,list)}removeEventListener(name,fn){this.listeners.set(name,(this.listeners.get(name)||[]).filter(x=>x.fn!==fn))}dispatchEvent(event){for(const {fn}of this.listeners.get(event.type)||[])fn(event)}}
 const window=new Target(),document=new Target();document.visibilityState='visible';
 Object.assign(window,{localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},setTimeout:(fn,ms)=>{timers.set(++next,{fn,at:now+ms});return next},clearTimeout:id=>timers.delete(id)});
 class Clock extends Date{static now(){return now}}
 const load=name=>{const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,window,document,Date:Clock,Event});return module.exports};
 const idle=load('dashboardIdle'),shell=load('ownerPreviewShell'),source={};
 const advance=ms=>{const end=now+ms;let count=0;while(true){const due=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert(++count<1000,'timer loop');now=due[1].at;timers.delete(due[0]);due[1].fn()}now=end};
 const record=payload=>{const at=shell.ownerPreviewActivityTime({source,origin:'null',isTrusted:true,data:payload},source,'channel',now);if(at!==null)idle.recordDashboardActivity(at)};
 const frame=new Target(),messages=[];Object.assign(frame,{setTimeout:window.setTimeout,requestAnimationFrame:fn=>fn()});
 const script=[...shell.makeOwnerPreviewShellDocument('<!doctype html><body></body>','channel',true).matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 vm.runInNewContext(script,{window:frame,document:{readyState:'complete',body:{},querySelector:()=>null,getElementById:()=>null},parent:{postMessage:payload=>{messages.push(payload);record(payload)}},Date:Clock});
 idle.writeLastActivity();const stop=idle.installDashboardIdleMonitor(()=>loggedOut++);
 return {idle,shell,window,document,frame,source,messages,values,timers,advance,stop,now:()=>now,loggedOut:()=>loggedOut,sleep:ms=>now+=ms};
}
test('idle expires at exactly 60 minutes; focus, layout, background work and synthetic input never extend it',()=>{
 const h=fixture();h.advance(59*MIN);h.window.dispatchEvent({type:'focus'});h.document.dispatchEvent({type:'visibilitychange'});
 for(const type of ['pointerdown','pointermove','keydown','touchstart','wheel','scroll']){h.window.dispatchEvent({type,isTrusted:false});h.frame.dispatchEvent({type,isTrusted:false})}
 h.window.dispatchEvent({type:'hensem:dashboard:session-changed'});h.advance(MIN-1);assert.equal(h.loggedOut(),0);h.advance(1);assert.equal(h.loggedOut(),1);
});
test('real input inside the actual sandbox shell extends the host deadline, including continuous movement',()=>{
 for(const type of ['pointerdown','pointermove','keydown','touchstart','wheel']){
  const h=fixture();h.advance(59*MIN);h.frame.dispatchEvent({type,isTrusted:true});h.advance(100);h.frame.dispatchEvent({type,isTrusted:true});h.advance(400);
  assert.equal(h.idle.readLastActivity(),START+59*MIN+100);h.advance(60*MIN-401);assert.equal(h.loggedOut(),0,type);h.advance(1);assert.equal(h.loggedOut(),1,type);
  assert.equal(h.frame.listeners.get(type)[0].options.capture,true,'stopped bubbling cannot hide input');
 }
});
test('host input uses capture, shares other-tab activity and survives listener remount/token renewal without resetting the deadline',()=>{
 const h=fixture();h.advance(45*MIN);h.window.dispatchEvent({type:'keydown',isTrusted:true});assert.equal(h.window.listeners.get('keydown')[0].options.capture,true);
 h.advance(40*MIN);h.idle.writeLastActivity();h.window.dispatchEvent({type:'storage',key:'hensem.dashboard.last_activity',newValue:String(h.now())});
 h.advance(59*MIN);assert.equal(h.loggedOut(),0);h.stop();let expired=0;const clean=h.idle.installDashboardIdleMonitor(()=>expired++);h.advance(MIN);assert.equal(expired,1);clean();assert.equal(h.timers.size,0);
});
test('after a suspended tab exceeds 60 minutes, late input cannot revive it; stale logout notices cannot clear an active login',()=>{
 const h=fixture();h.advance(50*MIN);h.window.dispatchEvent({type:'keydown',isTrusted:true});h.window.dispatchEvent({type:'storage',key:'hensem.dashboard.idle_logout_at',newValue:String(START)});assert.equal(h.loggedOut(),0);
 h.sleep(61*MIN);h.window.dispatchEvent({type:'keydown',isTrusted:true});assert.equal(h.loggedOut(),1);assert.equal(h.idle.readLastActivity(),START+50*MIN);
});
test('activity bridge rejects other windows, old channels, forged events, background commands and invalid timestamps',()=>{
 const h=fixture(),valid={source:h.source,origin:'null',isTrusted:true,data:{type:h.shell.OWNER_PREVIEW_SHELL_MESSAGE,channel:'channel',command:'user-activity',occurredAt:h.now()}};
 assert.equal(h.shell.ownerPreviewActivityTime(valid,h.source,'channel',h.now()),h.now());
 for(const event of [{...valid,source:{}},{...valid,origin:'https://other.invalid'},{...valid,isTrusted:false},...[
  {channel:'old'},{command:'account-page'},{command:'response'},{occurredAt:h.now()+1},{occurredAt:h.now()-5001},{occurredAt:'0'},{occurredAt:Infinity}
 ].map(change=>({...valid,data:{...valid.data,...change}}))])assert.equal(h.shell.ownerPreviewActivityTime(event,h.source,'channel',h.now()),null);
 const gate=fs.readFileSync(path.join(root,'src/components/DashboardAuthGate.tsx'),'utf8'),host=fs.readFileSync(path.join(root,'src/components/OwnerAdminPreview.tsx'),'utf8');
 assert.match(gate,/installDashboardIdleMonitor\(logout\)/);assert.match(host,/ownerPreviewActivityTime\(event,frame\.current\?\.contentWindow,channel\.current\)/);assert.match(host,/recordDashboardActivity\(activity\)/);
});
