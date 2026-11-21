// Dependency-free checks for the protected iframe bootstrap. Run with node --test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function payload(file, constant) {
  const source = fs.readFileSync(path.join(__dirname, 'src', file),'utf8').replace(/export const /g,'const ');
  return vm.runInNewContext(source+'\n'+constant);
}
const controls = payload('lightPilotControls.ts','LIGHT_PILOT_CONTROLS');
const styles = payload('lightPilotStyles.ts','LIGHT_PILOT_STYLES');

function fixture(hasDatePanel) {
  const make = (key, options={}) => ({
    key, className:'', textContent:'', children:[], nodeType:1, attributes:{}, open:false,
    classes:new Set(), rows:{}, closestMap:{},
    ...options,
    classList:{toggle(name, state){if(state)this.owner.classes.add(name);else this.owner.classes.delete(name);}},
    getAttribute(name){return this.attributes[name]||null;},
    setAttribute(name,value){this.attributes[name]=value;},
    hasAttribute(name){return Object.hasOwn(this.attributes,name);},
    appendChild(node){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(n=>n!==node);this.children.push(node);node.parentNode=node.parentElement=this;return node;},
    insertBefore(node,ref){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(n=>n!==node);this.children.splice(this.children.indexOf(ref),0,node);node.parentNode=node.parentElement=this;},
    append(...nodes){nodes.forEach(n=>this.appendChild(n));},
    contains(n){return n===this||this.children.some(child=>child.contains(n));},
    matches(){return !!this.error;},
    closest(selector){if(selector==='.lp-date-shortcuts,.live-date-panel'){let n=this.parentNode;while(n){if(['lp-date-shortcuts','live-date-panel'].includes(n.className))return n;n=n.parentNode;}}return this.closestMap[selector]||null;},
    querySelectorAll(key){return this.rows[key]||[];},
    querySelector(key){return this.querySelectorAll(key)[0]||null;},
    getClientRects(){return this.invisible?[]:[{}];}
  });
  const elem=(name,opts)=>{const el=make(name,opts);el.classList.owner=el;return el;};
  const html=elem('html'),host=elem('content'),filters=elem('filters'),results=elem('results');
  const group=elem('shortcuts'),button=elem('original button'),toolbar=elem('toolbar');
  const native=elem('select'),field=elem('field'),label=elem('label',{textContent:'所属团队'});
  const query=elem('button'),prompt=elem('prompt',{textContent:'请选择筛选条件，点击查询。'});
  const partial=elem('partial',{textContent:'已读 12 / 20；以下仅为已读取结果（小计）。'});
  const error=elem('error',{error:true,textContent:'请选择筛选条件，点击查询。'});
  const panel=elem('panel',{className:'live-date-panel'}),dates=elem('date controls');
  host.append(filters,results);filters.append(toolbar);toolbar.append(group);group.append(button);
  group.closestMap['.live-business-filters']=toolbar;
  if(hasDatePanel){toolbar.append(panel);panel.append(dates);toolbar.rows['#liveDatePanel']=[panel];panel.rows['.live-date-controls']=[dates];}
  filters.rows['.live-date-shortcuts']=[group];filters.rows['.live-field > select']=[native];
  native.closestMap['.live-field']=field;field.rows[':scope > label']=[label];
  filters.rows['.live-query-actions .btn.primary']=[query];
  results.rows['.live-query-prompt']=[prompt,partial,error];
  let process,raf;
  const ctx={
    document:{documentElement:html,body:host,readyState:'complete',createElement:tag=>elem(tag),addEventListener(){},
      getElementById:id=>id==='page'?results:id==='liveFilters'?filters:null},
    window:{addEventListener(){},requestAnimationFrame(fn){raf=fn;return 7;},cancelAnimationFrame(){}},
    MutationObserver:class{constructor(fn){process=fn;}observe(){}disconnect(){}}
  };
  vm.runInNewContext(controls,ctx);
  const repaint=()=>{process([{target:{id:'page',nodeType:1}}]);raf();};
  return {html,ctx,toolbar,group,button,native,query,prompt,partial,error,panel,dates,repaint};
}

test('retains original shortcut button and selection state; re-render and second mount are idempotent',()=>{
  for(const hasDate of [false,true]){
    const f=fixture(hasDate);
    assert.equal(f.html.getAttribute('data-m8-light-pilot'),'1');
    assert.equal(f.native.getAttribute('aria-label'),'所属团队');
    assert.equal(f.group.children[0],f.button);
    const placement=f.group.parentNode;
    if(hasDate){assert.equal(placement,f.panel);assert.deepEqual(f.panel.children,[f.group,f.dates]);}
    else {assert.equal(placement.parentNode.className,'lp-date-shortcuts');assert.equal(placement.parentNode.children[0].textContent,'快捷日期');}
    vm.runInNewContext(controls,f.ctx);f.repaint();
    assert.equal(f.group.parentNode,placement);assert.equal(f.group.children[0],f.button);
  }
});

test('only redundant neutral guidance collapses; partial and failed data remain visible',()=>{
  const f=fixture(false);
  assert.equal(f.prompt.classes.has('lp-secondary-prompt'),true);
  assert.equal(f.partial.classes.size,0);assert.equal(f.error.classes.size,0);
  f.query.disabled=true;f.repaint();assert.equal(f.prompt.classes.size,0);
  f.query.disabled=false;f.query.invisible=true;f.repaint();assert.equal(f.prompt.classes.size,0);
  f.query.invisible=false;f.prompt.textContent='筛选条件已修改，点击查询读取对应的正式数据。';f.repaint();
  assert.equal(f.prompt.classes.size,0);
});

test('source controls, CSP and original business events remain authoritative',()=>{
  assert.match(styles,/appearance:base-select/);
  assert.match(styles,/html\[data-m8-light-pilot="1"\]/);
  assert.doesNotMatch(controls,/innerHTML\s*=|dispatchEvent\(|requestSubmit\(|\.click\(|\bfetch\(|XMLHttpRequest|postMessage\(|localStorage|sessionStorage/);
  assert.doesNotMatch(controls,/<\/script/i);assert.doesNotMatch(styles,/<\/style/i);
});
