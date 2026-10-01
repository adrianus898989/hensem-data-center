const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const lib={exports:{}};
vm.runInNewContext(compile('src/lib/dashboardEmbedding.ts'),{module:lib,exports:lib.exports,URL});
const {dashboardIsTopLevel}=lib.exports;
const ownWindow=()=>{const w={};w.self=w;w.top=w;return w;};
function fixture(win){
  let value='checking';const effects=[],opened=[];
  if(win){win.location={href:'https://dashboard.example.invalid/#admin/access'};win.open=(...args)=>opened.push(args);}
  const jsx=(type,props)=>({type,props}),react={useState:()=>[value,next=>{value=next;}],useEffect:effect=>effects.push(effect)};
  const module={exports:{}};
  const imports={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'@/lib/dashboardEmbedding':lib.exports};
  vm.runInNewContext(compile('src/components/DashboardEmbeddingGuard.tsx'),{module,exports:module.exports,window:win,require:name=>{assert(name in imports,name);return imports[name];}});
  return {render:child=>module.exports.default({children:child}),flush:()=>effects.splice(0).forEach(fn=>fn()),opened};
}
function nodes(node){return node&&typeof node==='object'?[node,...Object.values(node.props||{}).flatMap(value=>Array.isArray(value)?value.flatMap(nodes):nodes(value))]:[];}

test('only the actual top-level browser window is accepted, and unknown/throwing contexts fail closed',()=>{
  const w=ownWindow();assert.equal(dashboardIsTopLevel(w),true);
  assert.equal(dashboardIsTopLevel(undefined),false);
  assert.equal(dashboardIsTopLevel({top:{},self:{}}),false);
  const embedded=ownWindow();embedded.top=w;assert.equal(dashboardIsTopLevel(embedded),false);
  const cross=ownWindow();Object.defineProperty(cross,'top',{get(){throw new Error('cross-origin denied');}});assert.equal(dashboardIsTopLevel(cross),false);
  const spoof={top:w,self:w};assert.equal(dashboardIsTopLevel(spoof),false);
});
test('SSR and the first client render do not mount login, saved-session restoration or account controls',()=>{
  for(const win of [undefined,ownWindow()]){
    const f=fixture(win),child={type:'protected-auth',props:{}};
    const result=f.render(child);assert.equal(nodes(result).some(node=>node===child),false);
    assert.equal(nodes(result).find(node=>node.props.role)?.props.role,'status');
  }
});
test('a top-level application becomes usable only after the embedding check',()=>{
  const f=fixture(ownWindow()),child={type:'protected-auth',props:{}};
  f.render(child);f.flush();assert.equal(f.render(child).props.children,child);
});
test('same-origin and cross-origin parent frames never receive the authenticated UI',()=>{
  const top=ownWindow(),same=ownWindow();same.top=top;
  const cross=ownWindow();cross.top={};
  for(const win of [same,cross]){
    const f=fixture(win),child={type:'protected-auth',props:{}};
    f.render(child);f.flush();const result=f.render(child);
    assert.equal(nodes(result).some(node=>node===child),false);
    assert.equal(nodes(result).find(node=>node.props.role)?.props.role,'alert');
    const button=nodes(result).find(node=>node.type==='button');assert(button);button.props.onClick();
    assert.deepEqual(f.opened[0],[win.location.href,'_blank','noopener,noreferrer']);
  }
});
test('the official route guards the auth gate, while the existing internal preview retains opaque sandbox isolation',()=>{
  const page=fs.readFileSync(path.join(root,'src/app/page.tsx'),'utf8');
  assert.match(page,/<DashboardEmbeddingGuard><DashboardAuthGate>/);
  const preview=fs.readFileSync(path.join(root,'src/components/OwnerAdminPreview.tsx'),'utf8');
  assert.match(preview,/sandbox="allow-scripts allow-downloads"/);assert.doesNotMatch(preview,/allow-same-origin/);
});
test('deployment actions are immutable and build does not receive deployment privileges',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/deploy-pages.yml'),'utf8');
  const refs=[...workflow.matchAll(/uses:\s*([^\s@]+)@([^\s]+)/g)];assert(refs.length>=6);
  for(const [,name,ref]of refs){assert.match(ref,/^[a-f0-9]{40}$/);assert.match(name,/^(actions|pnpm)\//);}
  const build=workflow.split('  build:')[1].split('  deploy:')[0],permissions=workflow.split('permissions:')[1].split('concurrency:')[0];
  assert.doesNotMatch(build,/pages:\s*write|id-token:\s*write|configure-pages/);
  assert.doesNotMatch(permissions,/pages:\s*write|id-token:\s*write/);
  assert.match(build,/persist-credentials:\s*false/);assert.match(build,/install --frozen-lockfile/);
  assert.match(workflow.split('  deploy:')[1],/pages:\s*write/);
});

test('old public Pages links redirect to the gated Worker before auth is mounted and do not transfer query credentials',()=>{
 const redirect=lib.exports.dashboardSecureEntryRedirect;
 assert.equal(redirect('https://adrianus898989.github.io/hensem-data-center/?token=private#admin/access'),'https://data-center.workdesk-hub.workers.dev/hensem-data-center/#admin/access');
 for(const href of ['https://data-center.workdesk-hub.workers.dev/hensem-data-center/','https://evil.invalid/hensem-data-center/','https://adrianus898989.github.io/other/','https://adrianus898989.github.io/hensem-data-center-evil/','not a url'])assert.equal(redirect(href),null);
 const w=ownWindow(),f=fixture(w),child={type:'protected-auth',props:{}};let next='';w.location={href:'https://adrianus898989.github.io/hensem-data-center/#admin/ip',replace:url=>{next=url;}};
 f.render(child);f.flush();assert.equal(next,'https://data-center.workdesk-hub.workers.dev/hensem-data-center/#admin/ip');assert.equal(nodes(f.render(child)).some(n=>n===child),false);
});
