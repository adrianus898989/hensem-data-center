const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const {root,loadTs}=require('./load-typescript.cjs');
const filename=path.join(root,'src/components/AutoWithdrawReasons.tsx');
const source=fs.readFileSync(filename,'utf8');
const target={country:'印度',platform:'TPPLAY',date:'2026-09-09'};

// Execute the real provider's hook callbacks with deterministic state/effect lifecycles.
// No browser, network, production credentials or real timers are used.
function harness() {
  const states=[],refs=[],effects=[];let stateIndex=0,refIndex=0,effectIndex=0,tree;
  let auth={session:{access_token:'initial',user:{id:'user-1'}},profile:{active:true,role:'owner'}};
  const pending=[],calls=[];
  const fakeReact={...React,
    useState(initial){const i=stateIndex++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},
    useRef(initial){const i=refIndex++;return refs[i]||(refs[i]={current:initial});},
    useMemo(fn){return fn();},
    useEffect(fn,deps){const i=effectIndex++;const last=effects[i];if(!last||deps.some((v,j)=>!Object.is(v,last.deps[j])))pending.push(()=>{last?.cleanup?.();effects[i]={deps,cleanup:fn()};});}
  };
  const api=loadTs(path.join(root,'src/lib/autoWithdrawReasonsClient.ts'));
  const module={exports:{}};
  new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{
    if(name==='react')return fakeReact;
    if(name==='react/jsx-runtime')return require(name);
    if(name==='./DashboardAuthGate')return {useDashboardAuth:()=>auth};
    if(name==='@/lib/autoWithdrawReasonsClient')return {...api,getAutoWithdrawReasons(session,target,signal){return new Promise((resolve,reject)=>calls.push({session,target,signal,resolve,reject}));}};
    throw Error(name);
  },module,module.exports);
  const Provider=module.exports.AutoWithdrawReasonsProvider;
  const render=()=>{stateIndex=0;refIndex=0;effectIndex=0;tree=Provider({startDate:'2026-09-01',endDate:'2026-09-09',availableRows:[{...target,total:1,manualCount:1}],children:null});while(pending.length)pending.shift()();return tree;};
  render();states[0]=target;states[1]=true;render();
  return {states,refs,calls,render,setAuth(value){auth=value;},getAuth(){return auth;},panel(){return tree.props.value?.panel;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const day={snapshot:{totals:{total:1,manual:1,auto:0,unknown:0,success:1,reject:0,other:0},coverage:{incomplete_note_count:0},groups:[]}};
function textOf(node){if(node==null)return '';if(Array.isArray(node))return node.map(textOf).join('');if(typeof node==='string'||typeof node==='number')return String(node);return textOf(node.props?.children);}

test('no polling or focus listeners are registered by the reason provider',()=>{
  assert.doesNotMatch(source,/setInterval|setTimeout|visibilitychange|addEventListener\s*\(\s*["']focus/);
});
test('same user token renewal does not refetch; manual refresh reads newest token',async()=>{
  const h=harness();assert.equal(h.calls.length,1);
  h.calls[0].resolve(day);await settle();h.render();
  h.setAuth({...h.getAuth(),session:{access_token:'renewed',user:{id:'user-1'}}});
  h.render();h.render();assert.equal(h.calls.length,1);
  const previous=h.states[2];h.states[5]++;h.render();
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].session.access_token,'renewed');
  assert.equal(h.states[2],previous,'Manual refresh does not clear successful current-scope content');
  assert.match(textOf(h.panel()),/总笔数/);
  h.calls[1].resolve(day);await settle();
});
test('switching platform aborts the old request and ignores its late response',async()=>{
  const h=harness();h.states[0]={...target,platform:'OTHER'};h.render();
  assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.calls.length,2);
  h.calls[0].resolve(day);await settle();assert.equal(h.states[2],null);
  h.calls[1].resolve(day);await settle();assert.match(h.states[2].key,/OTHER/);
});
test('switching authenticated user hides cached data and uses a new request',async()=>{
  const h=harness();h.calls[0].resolve(day);await settle();h.render();
  h.setAuth({...h.getAuth(),session:{access_token:'other-token',user:{id:'user-2'}}});h.render();
  assert.equal(h.calls.length,2);assert.doesNotMatch(textOf(h.panel()),/总笔数/);
  h.calls[1].resolve(day);await settle();h.render();assert.equal(h.states[2].viewerKey,'user-2');
});
test('permission loss aborts in-flight request and clears prior data',async()=>{
  const h=harness();h.setAuth({...h.getAuth(),profile:{active:false,role:'owner'}});h.render();
  assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.panel(),undefined);
  h.calls[0].resolve(day);await settle();assert.equal(h.states[2],null);
});
test('daily platform row keys are stable when main-table ordering changes',()=>{
  const dashboard=fs.readFileSync(path.join(root,'src/components/Dashboard.tsx'),'utf8');
  assert.match(dashboard,/key=\{withNotes \? JSON\.stringify\(\[row\.country, row\.platform\]\)/);
});
test('opening a loading dialog focuses the enabled close control, not refresh',()=>{
  const h=harness();let selected='',focused=0;
  h.refs[0].current={querySelector(selector){selected=selector;return {focus(){focused++;}};}};
  const oldDocument=global.document;
  global.document={body:{style:{overflow:''}}};
  try {
    h.states[1]=false;h.states[4]=true;h.render();
    assert.equal(selected,'.wr-close');assert.equal(focused,1);
    assert.equal(global.document.body.style.overflow,'hidden');
  } finally {
    if(oldDocument===undefined)delete global.document;else global.document=oldDocument;
  }
});
