const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=path.resolve(__dirname,'..'),ts=require(path.join(repo,'node_modules/typescript'));
const filename=path.join(repo,'src/lib/ownerPreviewShell.ts');
function load(document){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,document},{filename});return module.exports}
const api=load();
const html='<!doctype html><html><head><title>Hensem</title><style>.topbar{display:none}</style></head><body><aside class="sidebar"></aside><main class="main"><div class="topbar">Top</div><div>content</div></main></body></html>';
test('one 48px sticky iframe bar reserves the real account and owner grant space',()=>{
 const owner=api.makeOwnerPreviewShellDocument(html,'nonce',true),viewer=api.makeOwnerPreviewShellDocument(html,'nonce',false);
 assert(owner.indexOf('owner-preview-frame-shell-style')>owner.indexOf('.topbar{display:none}'));
 assert.match(owner,/position:sticky!important;top:0!important;z-index:30!important/);
 assert.match(owner,/height:48px!important;min-height:48px!important;display:flex!important;visibility:visible!important/);
 for(const css of ['padding-right:276px!important','padding-right:142px!important'])assert(owner.includes(css));
 for(const css of ['padding-right:184px!important','padding-right:60px!important'])assert(viewer.includes(css));
 assert.match(api.OWNER_PREVIEW_HOST_CSS,/auth-user-trigger\{[^}]*height:32px!important/);
 assert.match(api.OWNER_PREVIEW_HOST_CSS,/auth-user-menu-wrap\{top:8px!important;right:12px!important/);
 assert(!api.OWNER_PREVIEW_HOST_CSS.includes('height:38px'));
 for(const width of [1280,1024]){const frameRight=width-276,grantLeft=width-180-84,accountLeft=width-12-160;assert(grantLeft-frameRight>=12);assert(accountLeft-(width-180)>=8)}
 for(const width of [800,480]){assert((width-56-74)-(width-142)>=12);assert((width-12-36)-(width-56)>=8)}
});
test('host body marker restores the prior state on unmount',()=>{
 const names=new Set(['existing-module']);const body={classList:{contains:x=>names.has(x),add:x=>names.add(x),remove:x=>names.delete(x)}};const scoped=load({body});
 const dispose=scoped.mountOwnerPreviewHostShell();assert(names.has(api.OWNER_PREVIEW_BODY_CLASS));dispose();assert.deepEqual([...names],['existing-module']);
 names.add(api.OWNER_PREVIEW_BODY_CLASS);scoped.mountOwnerPreviewHostShell()();assert(names.has(api.OWNER_PREVIEW_BODY_CLASS));
 assert.doesNotThrow(()=>load({}).mountOwnerPreviewHostShell()());
});
test('return control sends an encoded allowlisted navigation message and never reads a host session',()=>{
 const channel='</script><script>oops()</script>\u2028',result=api.makeOwnerPreviewShellDocument(html,channel,false),scripts=[...result.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert.equal(scripts.length,1);assert(!result.includes('oops()</script>'));
 const messages=[],children=[],listeners={};const sidebar={querySelector:()=>null,appendChild:node=>children.push(node)};
 const document={readyState:'loading',addEventListener:(type,fn)=>listeners[type]=fn,querySelector:()=>sidebar,getElementById:()=>null,createElement:()=>({children:[],setAttribute(name,value){this[name]=value},addEventListener(name,fn){this[name]=fn},appendChild(node){this.children.push(node)}})};
 const frameWindow={};vm.runInNewContext(scripts[0],{window:frameWindow,document,parent:{postMessage:(payload,target)=>messages.push({payload,target})}},{codeGeneration:{strings:false,wasm:false}});
 assert.equal(children.length,0);listeners.DOMContentLoaded();assert.equal(children.length,1);const button=children[0].children[0];button.click();
 assert.equal(button['aria-label'],'返回现有后台');assert.deepEqual(JSON.parse(JSON.stringify(messages[0])),{payload:{type:api.OWNER_PREVIEW_SHELL_MESSAGE,channel,command:'back'},target:'*'});
 assert(!/access_token|refresh_token|dashboardAuth|localStorage/.test(scripts[0]));
 for(const command of ['open-accounts','open-workorder-accounts']){assert.equal(frameWindow.hensemOpenAccountManager(command),true);assert.equal(messages.at(-1).payload.command,command);assert.equal(messages.at(-1).payload.channel,channel)}const count=messages.length;assert.equal(frameWindow.hensemOpenAccountManager('delete-account'),false);assert.equal(messages.length,count);
 assert(api.makeOwnerPreviewShellDocument('<!doctype html><body>Hensem','x',false).includes('owner-preview-frame-shell-style'));
});
test('message gate requires source, opaque origin, channel and back command',()=>{
 const source={},event={source,origin:'null',data:{type:api.OWNER_PREVIEW_SHELL_MESSAGE,channel:'current',command:'back'}};
 assert(api.isOwnerPreviewReturnMessage(event,source,'current'));
 for(const invalid of [{...event,source:{}},{...event,origin:'https://host.invalid'},{...event,data:{...event.data,channel:'old'}},{...event,data:{...event.data,command:'logout'}},{...event,data:null}])assert.equal(api.isOwnerPreviewReturnMessage(invalid,source,'current'),false);
 assert.equal(api.isOwnerPreviewReturnMessage(event,null,'current'),false);assert.equal(api.isOwnerPreviewReturnMessage(event,source,''),false);
});


test('account navigation requires matching opaque source and channel and only two commands',()=>{
 const source={},base={source,origin:'null',data:{type:api.OWNER_PREVIEW_SHELL_MESSAGE,channel:'session',command:'open-accounts'}};
 for(const command of ['open-accounts','open-workorder-accounts'])assert.equal(api.ownerPreviewAccountCommand({...base,data:{...base.data,command}},source,'session'),command);
 for(const event of [{...base,source:{}},{...base,origin:'https://other.invalid'},{...base,data:{...base.data,channel:'stale'}},{...base,data:{...base.data,command:'delete-account'}},{...base,data:{...base.data,command:'back'}},{...base,data:null}])assert.equal(api.ownerPreviewAccountCommand(event,source,'session'),null);
 assert.equal(api.ownerPreviewAccountCommand(base,source,''),null);assert.equal(api.ownerPreviewAccountCommand(base,null,'session'),null);
});
