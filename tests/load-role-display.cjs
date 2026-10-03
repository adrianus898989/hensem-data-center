const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const filename=path.join(__dirname,'../src/lib/dashboardRoleDisplay.ts'),moduleObject={exports:{}};
const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{module:moduleObject,exports:moduleObject.exports,require(name){
 if(name==='./dashboardRoleClient')return{dashboardRolePages:require('../src/lib/dashboardRoleCatalog.json').pages};
 throw Error(name);
}});
module.exports=moduleObject.exports;
