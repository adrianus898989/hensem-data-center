const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");

// Execute production TypeScript using the project's existing compiler dependency.
const root = path.resolve(__dirname, "..");
const modules = new Map();
function loadTs(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const nativeRequire = createRequire(filename);
  const localRequire = (specifier) => {
    const target = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : null;
    return target && fs.existsSync(`${target}.ts`) ? loadTs(`${target}.ts`) : nativeRequire(specifier);
  };
  new Function("require", "module", "exports", source)(localRequire, module, module.exports);
  return module.exports;
}

module.exports = { loadTs, root };
