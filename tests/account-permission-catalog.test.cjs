const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { loadTs, root } = require("./load-typescript.cjs");
const catalog = loadTs(path.join(root, "src/lib/accountPermissionCatalog.ts"));
const auth = loadTs(path.join(root, "src/lib/dashboardAuthClient.ts"));
const { ACCOUNT_PERMISSION_MODULES: modules, ALL_ACCOUNT_PERMISSIONS: items,
  createPermissionDraft: draftOf, canEditPermission: canEdit,
  buildPermissionPatch: patchOf, permissionModuleCount: count } = catalog;
const profile = (role, extra = {}) => ({ auth_user_id: `fixture-${role}`, username: `fixture_${role}`,
  role, active: true, ...extra });
const owner = profile("owner"), admin = profile("admin"), viewer = profile("viewer");
const item = (key) => items.find((entry) => entry.key === key);
const moduleOf = (id) => modules.find((entry) => entry.id === id);

// Exercise the exact production replacement sanitizers without starting its
// handler, loading Supabase, contacting a server, or mutating any real account.
const backend = ts.createSourceFile("dashboard-user-admin.ts", fs.readFileSync(
  path.join(root, "BACKEND_CURRENT/dashboard-user-admin.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const selected = backend.statements.filter((node) => ts.isFunctionDeclaration(node)
  && ["sanitizePermissions", "sanitizeManagementPermissions"].includes(node.name?.text));
assert.equal(selected.length, 2);
const sanitizers = new Function(ts.transpileModule(selected.map((node) => node.getText(backend)).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText + "\nreturn { business: sanitizePermissions, management: sanitizeManagementPermissions };")();

test("catalog has five modules, eight unique permissions and independent work/customer items", () => {
  assert.deepEqual(modules.map((entry) => [entry.id, entry.items.length]), [
    ["home", 1], ["third_party", 1], ["auto_withdraw", 1], ["work_customer", 2], ["management", 3],
  ]);
  assert.equal(items.length, 8);
  assert.equal(new Set(items.map((entry) => entry.id)).size, 8);
  assert.equal(new Set(items.map((entry) => entry.key)).size, 8);
  for (const entry of items) {
    assert.equal(entry.id, entry.key);
    for (const field of ["label", "description", "page"]) assert.equal(typeof entry[field], "string");
  }
  assert.equal(item("home").fixed, true);
  assert.deepEqual(moduleOf("work_customer").items.map((entry) => entry.key), ["work_orders", "customer_service"]);
});

for (const role of ["owner", "admin", "viewer"]) {
  for (const permissions of [undefined, null, {}, { home: false, third_party: false, work_orders: true, customer_service: false }]) {
    test(`${role} draft exactly follows existing normalization (${JSON.stringify(permissions)})`, () => {
      const target = profile(role, { permissions, management_permissions: { manage_viewers: false } });
      assert.deepEqual(draftOf(target), { ...auth.normalizedPermissions(target), ...auth.normalizedManagementPermissions(target) });
      assert.equal(draftOf(target).home, true);
      assert.equal(patchOf(owner, target, draftOf(target)), null);
    });
  }
}

test("home is permanently enabled and all owner target permissions are protected", () => {
  for (const actor of [owner, admin, viewer]) {
    for (const target of [owner, admin, viewer]) assert.equal(canEdit(actor, target, item("home")), false);
    for (const entry of items) assert.equal(canEdit(actor, owner, entry), false);
    assert.equal(patchOf(actor, owner, Object.fromEntries(items.map((entry) => [entry.id, false]))), null);
  }
  assert.deepEqual(count(moduleOf("home"), { home: false }), { enabled: 1, total: 1 });
});

test("only owner can edit admin management; viewer management cannot be granted", () => {
  for (const entry of moduleOf("management").items) {
    assert.equal(canEdit(owner, admin, entry), true);
    assert.equal(canEdit(admin, admin, entry), false);
    assert.equal(canEdit(owner, viewer, entry), false);
    assert.equal(canEdit(admin, viewer, entry), false);
  }
  assert.equal(patchOf(owner, viewer, { manage_viewers: true, refresh_data: true, view_audit: true }), null);
});

test("admin edits viewer business only with the existing manage_viewers capability", () => {
  const entry = item("auto_withdraw");
  assert.equal(canEdit(admin, viewer, entry), true);
  assert.equal(canEdit(profile("admin", { management_permissions: {} }), viewer, entry), true);
  assert.equal(canEdit(profile("admin", { management_permissions: { manage_viewers: false } }), viewer, entry), false);
  assert.equal(canEdit(admin, admin, entry), false);
  assert.equal(canEdit(viewer, viewer, entry), false);
  assert.equal(canEdit(owner, admin, entry), true);
  assert.equal(canEdit(owner, profile("viewer", { active: false }), entry), true);
});

test("missing and inactive actors cannot edit; caller business scope does not invent a new restriction", () => {
  for (const actor of [null, undefined, profile("owner", { active: false }), profile("admin", { active: false })]) {
    assert.equal(canEdit(actor, viewer, item("work_orders")), false);
    assert.equal(patchOf(actor, viewer, { work_orders: true }), null);
  }
  assert.equal(canEdit(profile("admin", { permissions: { work_orders: false } }), viewer, item("work_orders")), true);
});

test("unknown or forged item metadata cannot bypass fixed or kind guards", () => {
  assert.equal(canEdit(owner, viewer, { ...item("home"), fixed: false }), false);
  assert.equal(canEdit(owner, viewer, { ...item("auto_withdraw"), id: "unknown" }), false);
  assert.equal(canEdit(owner, viewer, { ...item("manage_viewers"), kind: "business" }), false);
});

test("no change, empty or ignored draft does not materialize absent default values", () => {
  for (const target of [profile("admin", { permissions: null, management_permissions: null }), profile("viewer")]) {
    assert.equal(patchOf(owner, target, draftOf(target)), null);
    assert.equal(patchOf(owner, target, {}), null);
    assert.equal(patchOf(owner, target, { home: false, unknown: true, role: "owner", active: false }), null);
  }
});

test("editing one business item preserves all other effective admin defaults through actual backend sanitizer", () => {
  const target = profile("admin", { permissions: { third_party: false, extra_existing: "retain" } });
  const before = structuredClone(target);
  const draft = { ...draftOf(target), work_orders: false };
  const patch = patchOf(owner, target, draft);
  assert.deepEqual(Object.keys(patch), ["permissions"]);
  assert.equal(patch.permissions.extra_existing, "retain");
  assert.deepEqual(sanitizers.business(patch.permissions), {
    ...auth.normalizedPermissions(target), work_orders: false,
  });
  assert.equal(patch.permissions.customer_service, true);
  assert.deepEqual(target, before);
  assert.deepEqual(draft, { ...draftOf(target), work_orders: false });
});

test("work and customer grants remain independent in both directions", () => {
  for (const [enabled, unchanged] of [["work_orders", "customer_service"], ["customer_service", "work_orders"]]) {
    const patch = patchOf(admin, viewer, { [enabled]: true });
    assert.equal(patch.permissions[enabled], true);
    assert.equal(patch.permissions[unchanged], false);
    assert.deepEqual(sanitizers.business(patch.permissions), { ...auth.normalizedPermissions(viewer), [enabled]: true });
  }
  assert.deepEqual(count(moduleOf("work_customer"), { work_orders: true, customer_service: false }), { enabled: 1, total: 2 });
});

test("management-only patch excludes business and preserves other management defaults", () => {
  const target = profile("admin", { permissions: null, management_permissions: { extra_existing: "retain" } });
  const patch = patchOf(owner, target, { refresh_data: false });
  assert.deepEqual(Object.keys(patch), ["management_permissions"]);
  assert.equal(patch.management_permissions.extra_existing, "retain");
  assert.deepEqual(sanitizers.management(patch.management_permissions), {
    manage_viewers: true, refresh_data: false, view_audit: true,
  });
  assert.equal(target.permissions, null);
});

test("combined patch includes only the two changed branches and never role, active or target identity", () => {
  const patch = patchOf(owner, admin, { work_orders: false, view_audit: false, role: "viewer", active: false });
  assert.deepEqual(Object.keys(patch).sort(), ["management_permissions", "permissions"]);
  for (const key of ["role", "active", "username", "auth_user_id", "expected_role"]) assert.equal(key in patch, false);
});

test("malformed or inherited draft values are not coerced into grants", () => {
  for (const value of ["true", "false", 1, 0, null, undefined, [], {}]) {
    assert.equal(patchOf(owner, viewer, { auto_withdraw: value }), null);
  }
  assert.equal(patchOf(owner, viewer, Object.create({ auto_withdraw: true })), null);
  assert.equal(patchOf(admin, admin, { work_orders: false, refresh_data: false }), null);
});

test("module counts use actual booleans and normalized drafts", () => {
  assert.deepEqual(modules.map((entry) => count(entry, draftOf(owner))), [
    { enabled: 1, total: 1 }, { enabled: 1, total: 1 }, { enabled: 1, total: 1 },
    { enabled: 2, total: 2 }, { enabled: 3, total: 3 },
  ]);
  assert.deepEqual(count(moduleOf("management"), draftOf(viewer)), { enabled: 0, total: 3 });
  assert.deepEqual(count(moduleOf("work_customer"), { work_orders: "true", customer_service: 1 }), { enabled: 0, total: 2 });
});
