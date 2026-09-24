/* Synthetic HTML only. No endpoint calls, credentials, or private snapshots. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const filename=path.resolve(__dirname,'../src/lib/adminPreviewRestore.ts');
const source=fs.readFileSync(filename,'utf8');
const compile=text=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const compiled=compile(source),fixture={oldAdapter:'(function(){window.syntheticOld=true;})();',newModules:'(function(){window.syntheticNew="$&-$1-`";})();',restoredCss:'.synthetic-layout{color:navy}'};
function load(generated=fixture){const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,require:name=>{assert.equal(name,'./adminPreviewRestore.generated');return generated}},{filename});return module.exports.restoreApprovedAdmin}
const html=old=>'<!doctype html><html><head><style>.original{color:red}</style><style>.secondary{display:block}</style></head><body><div id="private">SYNTHETIC_ONLY</div><script>window.before="kept";\n'+old+'\nwindow.after="kept";</script></body></html>';
const inlineScripts=text=>[...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);

test('replaces exactly the approved adapter and inserts CSS only in the first style, preserving all other bytes',()=>{
 const restore=load(),original=html(fixture.oldAdapter),out=restore(original);assert(!out.includes(fixture.oldAdapter));assert(out.includes(fixture.newModules));assert.equal(inlineScripts(out).length,1);assert(out.indexOf(fixture.restoredCss)<out.indexOf('</style>'));assert(out.includes('<style>.secondary{display:block}</style>'));assert(out.includes('<div id="private">SYNTHETIC_ONLY</div>'));assert(out.includes('window.before="kept";'));assert(out.includes('window.after="kept";'));assert(out.includes('window.syntheticNew="$&-$1-`"'));const recovered=out.replace(/\/\* HENSEM_APPROVED_ADMIN_RESTORE:v1:SCRIPT:BEGIN \*\/[\s\S]*?\/\* HENSEM_APPROVED_ADMIN_RESTORE:v1:SCRIPT:END \*\//,()=>fixture.oldAdapter).replace(/\n\/\* HENSEM_APPROVED_ADMIN_RESTORE:v1:STYLE:BEGIN \*\/[\s\S]*?\/\* HENSEM_APPROVED_ADMIN_RESTORE:v1:STYLE:END \*\/\n/,'');assert.equal(recovered,original);
 const context={window:{}};vm.runInNewContext(inlineScripts(out)[0],context);assert.equal(context.window.syntheticOld,undefined);assert.equal(context.window.syntheticNew,'$&-$1-`');assert.equal(context.window.before,'kept');assert.equal(context.window.after,'kept');
});

test('approved exact revision is idempotent without repeated scripts or CSS',()=>{
 const restore=load(),once=restore(html(fixture.oldAdapter));assert.equal(restore(once),once);assert.equal((once.match(/SCRIPT:BEGIN/g)||[]).length,1);assert.equal((once.match(/STYLE:BEGIN/g)||[]).length,1);
});

test('missing or duplicate legacy adapters fail closed without reflecting document content in errors',()=>{
 const restore=load();for(const input of [html('SYNTHETIC_PRIVATE_TEXT'),html(fixture.oldAdapter+'\n'+fixture.oldAdapter),'',null,42])assert.throws(()=>restore(input),error=>/版本不匹配/.test(error.message)&&!error.message.includes('SYNTHETIC_PRIVATE_TEXT'));
});

test('unknown, partial, duplicated or modified restored revisions are rejected',()=>{
 const restore=load(),once=restore(html(fixture.oldAdapter));for(const changed of [once.replace('v1:SCRIPT','v2:SCRIPT'),once.replace(fixture.newModules,fixture.newModules+'\nwindow.modified=true;'),once.replace(fixture.restoredCss,'.other{color:red}'),once.replace('STYLE:END','STYLE:MISSING'),once.replace('</body>','<!-- HENSEM_APPROVED_ADMIN_RESTORE:unexpected --></body>'),once.replace('</body>','<script>'+fixture.oldAdapter+'</script></body>'),once.replace('</body>','<script>'+inlineScripts(once)[0]+'</script></body>')])assert.throws(()=>restore(changed));assert.throws(()=>load({...fixture,newModules:fixture.newModules+'\n// next approved revision'})(once));assert.throws(()=>load({...fixture,restoredCss:fixture.restoredCss+'\n.next{}'})(once));
});

test('requires real inline script and first style containers, not matching body text or external script fallback',()=>{
 const restore=load();for(const input of ['<style>.x{}</style><div>'+fixture.oldAdapter+'</div>','<style>.x{}</style><script src="/synthetic.js">'+fixture.oldAdapter+'</script>','<script>'+fixture.oldAdapter+'</script>','<script>'+fixture.oldAdapter+'</script><style>.late{}</style>'])assert.throws(()=>restore(input));const mixed=html(fixture.oldAdapter).replace('<style>','<STYLE>').replace('</style>','</STYLE >').replace('<script>','<SCRIPT>').replace('</script>','</SCRIPT >');assert(load()(mixed).includes(fixture.newModules));
});

test('unsafe generated raw-text terminators and marker collisions are rejected before HTML is returned',()=>{
 for(const patch of [{newModules:'window.x="</script><script>bad()</script>";'}, {newModules:'window.x="</ScRiPt >";'}, {restoredCss:'a{content:"</STYLE><script>bad()"}'},{oldAdapter:''},{newModules:''},{restoredCss:''},{newModules:fixture.oldAdapter},{newModules:fixture.oldAdapter+'\nwindow.new=true;'}, {newModules:'/* HENSEM_APPROVED_ADMIN_RESTORE:collision */'}])assert.throws(()=>load({...fixture,...patch})(html(fixture.oldAdapter)));
});

test('restored markers cannot be moved outside the inline script or into a later style container',()=>{
 const restore=load(),once=restore(html(fixture.oldAdapter)),scriptBlock=once.match(/\/\* HENSEM_APPROVED_ADMIN_RESTORE:v1:SCRIPT:BEGIN \*\/[\s\S]*?\/\* HENSEM_APPROVED_ADMIN_RESTORE:v1:SCRIPT:END \*\//)[0],cssBlock=once.match(/\n\/\* HENSEM_APPROVED_ADMIN_RESTORE:v1:STYLE:BEGIN \*\/[\s\S]*?\/\* HENSEM_APPROVED_ADMIN_RESTORE:v1:STYLE:END \*\/\n/)[0];assert.throws(()=>restore(once.replace(scriptBlock,'').replace('</body>',scriptBlock+'</body>')));assert.throws(()=>restore(once.replace(cssBlock,'').replace('.secondary{display:block}','.secondary{display:block}'+cssBlock)));
});

test('actual generated code bundle has valid script syntax and cannot close the HTML script element',()=>{
 const file=path.resolve(__dirname,'../src/lib/adminPreviewRestore.generated.ts'),module={exports:{}};vm.runInNewContext(compile(fs.readFileSync(file,'utf8')),{module,exports:module.exports},{filename:file});const generated=module.exports;assert(generated.oldAdapter.length>100);assert(generated.newModules.length>100);assert.doesNotMatch(generated.newModules,/<\/script/i);assert.doesNotMatch(generated.restoredCss,/<\/style/i);const restore=load(generated),out=restore(html(generated.oldAdapter));assert.equal(restore(out),out);assert.equal(inlineScripts(out).length,1);assert.doesNotThrow(()=>new vm.Script(inlineScripts(out)[0]));
});

test('host restores only the authorized HTML body, while authorization checks and the original endpoint stay unchanged',()=>{
 const component=fs.readFileSync(path.resolve(__dirname,'../src/components/OwnerAdminPreview.tsx'),'utf8'),client=fs.readFileSync(path.resolve(__dirname,'../src/lib/adminPreviewClient.ts'),'utf8');assert.match(component,/await adminPreviewRequest\(sessionRef\.current,check\?"\?check=1":"",\{signal:controller\.signal\}\)/);assert.match(component,/if\(!check\)\{const html=await response\.text\(\);if\(!cancelled\)setDocumentHtml\([^\n]*makeAdminLiveDocument\(restoreApprovedAdmin\(html\),channel\.current\)/);assert.equal((component.match(/restoreApprovedAdmin\(html\)/g)||[]).length,1);assert.match(component,/request\(\)\.catch\(fail\)/);assert.match(component,/request\(true\)\.catch\(fail\)/);assert.match(component,/controller\.abort\(\);setDocumentHtml\(""\)/);assert.match(client,/base\+"\/functions\/v1\/owner-admin-preview"\+query/);assert.doesNotMatch(source,/\bfetch\s*\(|localStorage|sessionStorage|access_token|Authorization|window\.|document\./);
});

test('published overlay matches every reviewed renderer and style source exactly',()=>{
 const m={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.resolve(__dirname,'../src/lib/adminPreviewRestore.generated.ts'),'utf8')),{module:m,exports:m.exports});
 const read=n=>fs.readFileSync(path.resolve(__dirname,'../admin-preview',n),'utf8');
 assert.equal(m.exports.oldAdapter,read('legacy-live-data.js'));
 assert.equal(m.exports.newModules,['live-comparison.js','live-reference-layout.js','live-empty-pages.js','live-pages-reference.js','live-rates-restored.js','live-duration-reference.js','live-payout-config.js','live-data.js'].map(read).join('\n'));
 assert.equal(m.exports.restoredCss,['live-restored.css','live-reference-pages.css','live-payout-config.css'].map(read).join('\n'));
});
