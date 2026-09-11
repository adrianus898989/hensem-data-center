const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "BACKEND_CURRENT/dashboard-user-admin.ts"), "utf8");
const compiled = ts.transpileModule(source.replace(/^import .*;\n/, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const none = { manage_viewers: false, refresh_data: false, view_audit: false };
const selected = { manage_viewers: false, refresh_data: true, view_audit: true };
const full = { home: true, third_party: true, auto_withdraw: true, work_orders: true, customer_service: true };
const viewer = { home: true, third_party: true, auto_withdraw: false, work_orders: false, customer_service: false };

// Execute the real Edge handler against an in-memory client. No network or real accounts.
async function request(patch, options = {}) {
  const target = { auth_user_id: "fixture-target", username: "fixture", role: "viewer", active: false, permissions: null, management_permissions: none, updated_at: "old", ...options.target };
  const caller = { role: options.callerRole || "owner", active: options.active !== false, username: "fixture-manager", management_permissions: { ...selected, manage_viewers: true, ...options.management } };
  const writes = [], audits = [];
  let handler;
  const client = {
    auth: { getUser: async () => ({ data: { user: options.invalidToken ? null : { id: "fixture-manager", user_metadata: { dashboard_role: "owner" } } } }) },
    from(table) {
      let values, filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        update(patch) { values = patch; return query; },
        async insert(row) { assert.equal(table, "dashboard_audit_log"); audits.push(row); return { error: null }; },
        async maybeSingle() {
          assert.equal(table, "dashboard_profiles");
          if (values) {
            if (options.writeError) return { error: { message: "fixture write failure" } };
            if (options.race || !filters.every(([key, value]) => target[key] === value)) return { data: null };
            writes.push({ ...values });
            Object.assign(target, values);
            return { data: { role: target.role } };
          }
          if (filters.some(([key, value]) => key === "auth_user_id" && value === "fixture-manager")) return { data: caller };
          return { data: options.missing ? null : { ...target } };
        },
      };
      return query;
    },
  };
  vm.runInNewContext(compiled, {
    createClient: () => client,
    Deno: { env: { get: () => "fixture-only" }, serve: fn => { handler = fn; } },
    Request, Response, Date, Intl, console,
    fetch: () => { throw new Error("No external requests allowed"); },
  });
  const response = await handler(new Request("https://fixture.invalid", {
    method: "POST", headers: options.noToken ? {} : { authorization: "Bearer fixture" },
    body: JSON.stringify({ action: "update-account", username: "fixture", ...patch }),
  }));
  return { status: response.status, body: await response.json(), writes: JSON.parse(JSON.stringify(writes)), audits: JSON.parse(JSON.stringify(audits)), target };
}
const promotion = { role: "admin", expected_role: "viewer", management_permissions: selected };

test("owner promotes with explicit permissions; inactive and sparse business access stay unchanged", async () => {
  const result = await request({ ...promotion, active: true, permissions: full });
  assert.equal(result.status, 200);
  assert.equal(result.body.role, "admin");
  assert.equal(result.target.active, false);
  assert.deepEqual(result.writes[0].permissions, viewer);
  assert.deepEqual(result.writes[0].management_permissions, selected);
  assert.equal(result.audits[0].details.previous_role, "viewer");
  assert.equal(result.audits[0].details.role, "admin");
});
test("downgrade clears management but preserves effective admin business defaults", async () => {
  const result = await request({ role: "viewer", expected_role: "admin", management_permissions: selected }, { target: { role: "admin", permissions: { third_party: false }, management_permissions: selected } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.writes[0].permissions, { ...full, third_party: false });
  assert.deepEqual(result.writes[0].management_permissions, none);
});
test("non-owner cannot submit any role, regardless of metadata or same-role request", async () => {
  for (const callerRole of ["admin", "viewer"]) for (const role of ["admin", "viewer"]) {
    const result = await request({ ...promotion, role }, { callerRole });
    assert.equal(result.status, 403);
    assert.deepEqual(result.writes, []);
  }
});
test("owner target and unauthenticated/inactive users are protected", async () => {
  for (const options of [{ target: { role: "owner" } }, { active: false }, { noToken: true }, { invalidToken: true }]) {
    const result = await request(promotion, options);
    assert([401, 403].includes(result.status));
    assert.deepEqual(result.writes, []);
  }
});
test("invalid roles and incomplete or nonboolean management choices fail closed", async () => {
  for (const role of [null, "owner", "ADMIN", "", 1, {}, ["admin"]]) {
    const result = await request({ ...promotion, role });
    assert.equal(result.status, 400);
    assert.deepEqual(result.writes, []);
  }
  for (const management_permissions of [undefined, null, {}, [], { refresh_data: true }, { ...selected, view_audit: "true" }]) {
    const result = await request({ ...promotion, management_permissions });
    assert.equal(result.status, 400);
    assert.deepEqual(result.writes, []);
  }
});
test("stale roles, missing expected role, concurrent updates and write failures cannot report success", async () => {
  for (const [patch, options, status] of [
    [{ ...promotion, expected_role: undefined }, {}, 400],
    [{ ...promotion, expected_role: "admin" }, {}, 409],
    [promotion, { race: true }, 409],
    [promotion, { writeError: true }, 500],
    [promotion, { missing: true }, 404],
  ]) {
    const result = await request(patch, options);
    assert.equal(result.status, status);
    assert.deepEqual(result.writes, []);
    assert.deepEqual(result.audits, []);
  }
});
test("normal admin viewer-permission edits still work but cannot give management or edit admin targets", async () => {
  const result = await request({ permissions: full, management_permissions: selected }, { callerRole: "admin" });
  assert.equal(result.status, 200);
  assert.equal(result.target.role, "viewer");
  assert.deepEqual(result.writes[0].permissions, full);
  assert.equal(result.writes[0].management_permissions, undefined);
  assert.equal((await request({ active: true }, { callerRole: "admin", target: { role: "admin" } })).status, 403);
  assert.equal((await request({ active: true }, { callerRole: "admin", management: { manage_viewers: false } })).status, 403);
});
test("legacy viewer path rejects role and cannot race with a promotion", async () => {
  assert.equal((await request({ ...promotion, action: "update-viewer" })).status, 400);
  const result = await request({ action: "update-viewer", permissions: full }, { race: true, callerRole: "admin" });
  assert.equal(result.status, 409);
  assert.deepEqual(result.writes, []);
});

function roleUi(user) {
  let values = [], cursor = 0, saves = [], confirmResult = true;
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, "src/components/AccountRoleEditor.tsx"), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], value => { values[index] = value; }];
    },
  };
  new Function("require", "module", "exports", "window", output)(
    name => name === "react" ? react : require(name),
    module, module.exports, { confirm: () => confirmResult },
  );
  function render(busy = false) { cursor = 0; return module.exports.default({ user, busy, onSave: async patch => { saves.push(patch); return true; } }); }
  function all(node) { if (!node || typeof node !== "object") return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(all)]; }
  return { render, all, saves, cancelConfirm: () => { confirmResult = false; } };
}
test("role control stages changes, cancellation does not save, promotion starts with no implicit grants", async () => {
  const ui = roleUi({ role: "viewer", username: "fixture", auth_user_id: "fixture" });
  let elements = ui.all(ui.render());
  assert(elements.find(e => e.type === "button" && e.props.children === "保存角色").props.disabled);
  elements.find(e => e.type === "select").props.onChange({ target: { value: "admin" } });
  elements = ui.all(ui.render());
  assert.deepEqual(elements.filter(e => e.type === "input").map(e => e.props.checked), [false, false, false]);
  elements.find(e => e.type === "button" && e.props.children === "取消").props.onClick();
  assert.equal(ui.saves.length, 0);
  elements = ui.all(ui.render());
  elements.find(e => e.type === "select").props.onChange({ target: { value: "admin" } });
  elements = ui.all(ui.render());
  elements.filter(e => e.type === "input")[1].props.onChange({ target: { checked: true } });
  elements = ui.all(ui.render());
  elements.find(e => e.type === "button" && e.props.children === "保存角色").props.onClick();
  assert.deepEqual(ui.saves, [{ role: "admin", expected_role: "viewer", management_permissions: { ...none, refresh_data: true } }]);
  ui.cancelConfirm();
  elements.find(e => e.type === "button" && e.props.children === "保存角色").props.onClick();
  assert.equal(ui.saves.length, 1);
  assert(ui.all(ui.render(true)).find(e => e.type === "select").props.disabled);
  assert.equal(roleUi({ role: "owner" }).render(), null);
});
