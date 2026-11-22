const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const file = path.join(__dirname, "..", "public", "light-pilot", "index.html");
const script = fs.readFileSync(file, "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
const origin = "https://data-center.workdesk-hub.workers.dev";

test("bookmarks lead to the ordinary dashboard on the same origin with their existing report", () => {
  for (const suffix of ["light-pilot", "light-pilot/", "light-pilot/index.html"]) {
    for (const context of ["", "#admin/workorders", "?a=1#admin/auto_withdraw", "?next=https://elsewhere.invalid/#admin/access"]) {
      const redirected = [];
      const location = { href: origin + "/hensem-data-center/" + suffix + context, replace: url => redirected.push(url) };
      vm.runInNewContext(script, { URL, location });
      assert.deepEqual(redirected, [origin + "/hensem-data-center/" + context]);
    }
  }
});
