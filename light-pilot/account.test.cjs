const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

function account(crypto) {
  const source = readFileSync(path.join(__dirname, "src/account.ts"), "utf8");
  const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021}});
  const context = {exports:{}, crypto, TextEncoder, Uint8Array};
  vm.runInNewContext(outputText, context);
  return context.exports;
}
const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const correct = {username:"admin", auth_user_id:id, active:true};

test("the matched active login and session also need the pinned identity digest", async () => {
  let bytes;
  const api = account({subtle:{digest: async (name, data) => {
    assert.equal(name, "SHA-256");
    assert.equal(Buffer.from(data).toString(), id);
    return bytes;
  }}});
  bytes = Buffer.alloc(32);
  assert.equal(await api.isAdminLightPilot(correct,id),false);
  bytes = Buffer.from(api.PILOT_ACCOUNT_DIGEST, "hex");
  assert.equal(await api.isAdminLightPilot(correct,id),true);
});
test("role, display names, unrelated identities and disabled profiles never enable the pilot", async () => {
  const api = account({subtle:{digest: () => assert.fail("ordinary viewers must not load the pilot")}});
  for (const profile of [
    {...correct, username:"ADMIN"}, {...correct,username:"owner",role:"owner"},
    {...correct,username:"viewer",role:"admin"}, {...correct,active:false}, {...correct,auth_user_id:"other"},
  ]) assert.equal(await api.isAdminLightPilot(profile,id),false);
  assert.equal(await api.isAdminLightPilot({...correct,auth_user_id:""}, ""),false);
  assert.equal(await account(undefined).isAdminLightPilot(correct,id),false);
});
