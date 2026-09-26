const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../admin-preview/live-provider-sticky.js'),'utf8');
function fixture(){
 const elements=[],listeners=new Map(),frames=new Map();let seq=0,provider=true;
 const cell=width=>({style:{},getBoundingClientRect:()=>({width})});
 const head={rows:[{cells:[cell(100),cell(80),cell(200)]}],getBoundingClientRect:()=>({height:32}),cloneNode:()=>({rows:[{cells:[cell(0),cell(0),cell(0)]}]})};
 const table={tHead:head,getBoundingClientRect:()=>({width:380})},bounds={top:150,bottom:1000,left:240,width:340};
 const wrap={isConnected:true,clientWidth:340,scrollLeft:0,querySelector:()=>table,getBoundingClientRect:()=>bounds};
 const add=(name,fn)=>listeners.set(name,fn),remove=(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)};
 const root={document:{querySelector:selector=>selector==='.topbar'?{getBoundingClientRect:()=>({bottom:55})}:provider?wrap:null,
  createElement:tag=>({tag,style:{},children:[],setAttribute(){},appendChild(el){this.children.push(el)},remove(){elements.splice(elements.indexOf(this),1)}}),body:{appendChild:el=>elements.push(el)},addEventListener:add,removeEventListener:remove},
  addEventListener:add,removeEventListener:remove,requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq},cancelAnimationFrame:id=>frames.delete(id)};
 root.window=root;vm.runInNewContext(source,root);const flush=()=>{for(const [id,fn]of [...frames]){frames.delete(id);fn()}};
 return {api:root.HensemProviderSticky,elements,listeners,bounds,wrap,head,flush,overview(){provider=false}};
}
test('provider header pins below the app bar, tracks horizontal columns, and disappears after the table',()=>{
 const h=fixture();h.api.mount();const fixed=h.elements[0];assert.equal(fixed.hidden,true);
 h.bounds.top=20;h.wrap.scrollLeft=35;h.listeners.get('scroll')();h.flush();
 assert.equal(fixed.hidden,false);assert.equal(fixed.style.top,'55px');assert.equal(fixed.style.left,'240px');assert.equal(fixed.style.width,'340px');
 const copy=fixed.children[0];assert.equal(copy.style.marginLeft,'-35px');assert.deepEqual(copy.children[0].rows[0].cells.map(c=>c.style.width),['100px','80px','200px']);
 h.bounds.bottom=70;h.listeners.get('scroll')();h.flush();assert.equal(fixed.hidden,true);
 h.api.clear();assert.equal(h.elements.length,0);assert.equal(h.listeners.size,0);
});
test('overview never installs the provider header and pending updates are cancelled on navigation',()=>{
 const h=fixture();h.api.mount();h.listeners.get('scroll')();h.overview();h.api.mount();h.flush();assert.equal(h.elements.length,0);assert.equal(h.listeners.size,0);
});
