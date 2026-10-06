const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
// Offline executable Edge source loader. Each graph gets isolated dependencies;
// an unmocked fetch fails instead of contacting any real service.
function loadEdge(filename, globals = {}) {
  const cache = new Map();
  const defaults = {crypto: webcrypto, fetch: () => { throw Error('Unexpected network'); }, Date,
    Deno: {env: {get: () => undefined}, serve: () => {}}};
  const env = {...defaults, ...globals};
  const read = file => {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = {exports: {}}; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.main', 'false'),
      {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
    const requireLocal = specifier => {
      if (!specifier.startsWith('.')) throw Error(`Unexpected dependency: ${specifier}`);
      const target = path.resolve(path.dirname(file), specifier);
      return read(target.endsWith('.ts') ? target : `${target}.ts`);
    };
    new Function('require', 'module', 'exports', ...Object.keys(env), code)(requireLocal, module, module.exports, ...Object.values(env));
    return module.exports;
  };
  return read(filename);
}
module.exports = {loadEdge};
