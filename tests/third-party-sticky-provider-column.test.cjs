const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { root } = require("./load-typescript.cjs");

test("国家汇总隐藏国家列并固定统一三方列", () => {
  const component = fs.readFileSync(path.join(root, "src/components/ThirdPartyVolumeDashboard.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  const countryPage = component.slice(component.indexOf("function CountryVolumeSinglePage"), component.indexOf("function ChangeBadge"));

  assert.match(countryPage, /columns=\{\["统一三方"\]\}/);
  assert.match(countryPage, /columnIndexes=\{\[1\]\}/);
  assert.match(countryPage, /stickyFirstColumn/);
  assert.doesNotMatch(countryPage, /columns=\{\["国家", "统一三方"\]\}/);
  assert.match(styles, /volume-summary-table-wrap\.sticky-first-dimension[\s\S]*position: sticky;[\s\S]*left: 0;/);
});
