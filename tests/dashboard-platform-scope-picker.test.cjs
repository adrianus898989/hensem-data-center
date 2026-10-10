const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {root,loadTs}=require('./load-typescript.cjs');
const api=loadTs(path.join(root,'src/lib/dashboardDataScope.ts'));
const owner={auth_user_id:'owner',role:'owner',active:true},ALL={mode:'all',countries:[]};
const pair=(country,platform)=>({country,platform});
const list=[{country:'IN',platform:'91CLUB',label:'91CLUB',source:'AR'},{country:'IN',platform:'6CLUB',label:'6CLUB',source:'AR'},{country:'BR',platform:'91CLUB',label:'91CLUB',source:'Other'}];
const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
const text=x=>Array.isArray(x)?x.map(text).join(''):x&&typeof x==='object'?text(x.props?.children):x==null||typeof x==='boolean'?'':String(x);
const flush=()=>new Promise(r=>setImmediate(r));
function ui(options={}){
 const source=ts.createSourceFile('AdminControlCenter.tsx',fs.readFileSync(path.join(root,'src/components/AdminControlCenter.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const functions=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&['scopeSelectionPresent','DataScopePicker'].includes(n.name?.text));
 const code=ts.transpileModule(functions.map(n=>n.getText(source)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 let cursor=0,ecursor=0;const states=[],deps=[],effects=[],cleanups=[],changes=[],calls=[];
 let props={id:'fixture',value:ALL,actor:owner,session:{user:{id:'owner'}},disabled:false,...options};
 const useState=initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}];};
 const useRef=initial=>{const i=cursor++;return states[i]||(states[i]={current:initial});};
 const useEffect=(fn,d)=>{const i=ecursor++;if(!deps[i]||d.some((v,j)=>v!==deps[i][j])){deps[i]=d;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn()});}};
 const read=async(session,signal)=>{calls.push({session,signal});return options.read?options.read(session,signal):list;};
 const render=Function('require','exports','useState','useRef','useEffect','readDashboardScopeCatalog',...Object.keys(api),code+'\nreturn DataScopePicker;')(()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),{},useState,useRef,useEffect,read,...Object.values(api));
 props.onChange=v=>{changes.push(v);props={...props,value:v};};
 const draw=()=>{cursor=ecursor=0;const tree=render(props);effects.splice(0).forEach(run=>run());return tree;};
 const all=()=>nodes(draw()),radio=value=>all().find(n=>n.type==='input'&&n.props.type==='radio'&&n.props.value===value),checkboxes=()=>all().filter(n=>n.type==='input'&&n.props.type==='checkbox');
 draw();return {draw,all,radio,checkboxes,calls,changes,value:()=>props.value,actor(next){props={...props,actor:next,session:{user:{id:next.auth_user_id}}};draw();},dispose(){cleanups.forEach(fn=>fn?.())}};
}
test('switching from whole country to specified platform clears broad access before selection',async()=>{
 const h=ui({value:{mode:'selected',countries:['IN']}});assert.equal(h.calls.length,0);h.radio('platforms').props.onChange();h.draw();assert.deepEqual(h.value(),{mode:'selected',countries:[],platforms:[]});await flush();
 h.checkboxes()[0].props.onChange({target:{checked:true}});assert.deepEqual(h.value(),{mode:'selected',countries:[],platforms:[pair('IN','91CLUB')]});assert.equal(api.dashboardScopeAllows(h.value(),'IN','6CLUB'),false);assert.equal(api.dashboardScopeAllows(h.value(),'BR','91CLUB'),false);h.dispose();
});
test('search and country filter never change saved selections or authorize the whole country',async()=>{
 const h=ui({value:{mode:'selected',countries:[],platforms:[pair('IN','91CLUB')]}});await flush();h.all().find(n=>n.props?.type==='search').props.onChange({target:{value:'6CLUB'}});assert.equal(h.checkboxes().length,1);assert.equal(h.changes.length,0);
 h.checkboxes()[0].props.onChange({target:{checked:true}});assert.equal(h.value().platforms.length,2);
 h.all().find(n=>n.props?.['aria-label']==='平台授权国家筛选').props.onChange({target:{value:'BR'}});assert.equal(h.checkboxes().length,0);assert.equal(h.value().platforms.length,2);h.dispose();
});
test('a platform restricted manager cannot assign broad groups or another platform even with a broad catalog reply',async()=>{
 const scope={mode:'selected',countries:[],platforms:[pair('IN','91CLUB')]};const h=ui({value:scope,actor:{auth_user_id:'manager',role:'viewer',active:true,data_scope:scope},session:{user:{id:'manager'}}});await flush();
 for(const mode of ['all','selected']){assert.equal(h.radio(mode).props.disabled,true);h.radio(mode).props.onChange();}assert.equal(h.changes.length,0);assert.equal(h.checkboxes().length,1);h.dispose();
});
test('late catalog response after actor switch or disposal is ignored and old request is aborted',async()=>{
 let resolve;const h=ui({value:{mode:'selected',countries:[],platforms:[]},read:()=>new Promise(r=>resolve=r)});const first=resolve;h.actor({auth_user_id:'other',role:'viewer',active:true,data_scope:{mode:'selected',countries:['BR']}});assert.equal(h.calls[0].signal.aborted,true);first(list);await flush();assert.equal(h.checkboxes().length,0);resolve(list);await flush();assert.equal(h.checkboxes().length,1);h.dispose();assert.equal(h.calls[1].signal.aborted,true);
});
test('catalog errors retain existing scope and offer retry without defaulting to all',async()=>{
 const scope={mode:'selected',countries:[],platforms:[pair('IN','91CLUB')]};let failing=true;const h=ui({value:scope,read:async()=>{if(failing)throw Error('fixture unavailable');return list;}});await flush();assert.match(text(h.draw()),/fixture unavailable/);assert.deepEqual(h.value(),scope);assert.equal(h.changes.length,0);
 failing=false;h.all().find(n=>n.type==='button'&&text(n)==='重试读取平台').props.onClick();h.draw();await flush();assert.equal(h.checkboxes().length,3);h.dispose();
});
test('busy picker cannot remove selections or switch access mode',async()=>{
 const h=ui({disabled:true,value:{mode:'selected',countries:[],platforms:[pair('IN','91CLUB')]}});await flush();h.radio('all').props.onChange();h.all().find(n=>n.props?.['aria-label']==='移除 印度 / 91CLUB').props.onClick();h.checkboxes()[0].props.onChange({target:{checked:false}});assert.equal(h.changes.length,0);h.dispose();
});

test('catalog verification refuses loading, failed and removed platform selections, then verifies a current selection',async()=>{
 const validations=[];let failing=true;
 const h=ui({value:{mode:'selected',countries:[],platforms:[pair('IN','REMOVED')]},onValidityChange:value=>validations.push(value),read:async()=>{if(failing)throw Error('unavailable');return list;}});
 assert.equal(validations.at(-1),false);await flush();h.draw();assert.equal(validations.at(-1),false);
 failing=false;h.all().find(n=>n.type==='button'&&text(n)==='重试读取平台').props.onClick();h.draw();await flush();h.draw();assert.equal(validations.at(-1),false);
 h.all().find(n=>n.props?.['aria-label']==='移除 印度 / REMOVED').props.onClick();h.checkboxes()[0].props.onChange({target:{checked:true}});h.draw();assert.equal(validations.at(-1),true);
 h.dispose();
});
