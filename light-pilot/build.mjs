import { execFileSync } from "node:child_process";
import {
  cpSync, existsSync, lstatSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Ship a second static export only. next.config.mjs fingerprints src/ and
// admin-preview/ and writes public/dashboard-release.json in its working copy.
const pilot = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(pilot);
const mainExport = path.join(root, "out");
const child = path.join(mainExport, "light-pilot");
const ownerFile = ".m8-pilot-export";
const ownerTag = "M8 light pilot static export v1\n";
const base = process.env.PAGES_BASE_PATH ?? "";
if (base !== "" && !/^\/(?:[\w-]+\/)*[\w-]+$/.test(base)) {
  throw new Error("Expected PAGES_BASE_PATH to be an absolute site base path without a trailing slash.");
}
if (!lstatSync(mainExport).isDirectory() || !lstatSync(path.join(mainExport, "index.html")).isFile()) {
  throw new Error("Build the normal dashboard before packaging its light-pilot subdirectory.");
}
const childBase = base + "/light-pilot";
const buildCopy = mkdtempSync(path.join(tmpdir(), "m8-light-pilot-build-"));
let staged;
try {
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "next.config.mjs",
    "tsconfig.json", "next-env.d.ts", "scripts", "admin-preview", "src", "public"]) {
    const from = path.join(root, name);
    cpSync(from, path.join(buildCopy, name), {
      recursive: true,
      filter: file => !["public/light-pilot", "public/out", "public/_next"].includes(
        path.relative(root, file).split(path.sep).join("/")),
    });
  }
  const overlay = path.join(buildCopy, "src", "lib", "lightPilot");
  if (existsSync(overlay)) throw new Error("The pilot overlay would replace normal application sources.");
  cpSync(path.join(pilot, "src"), overlay, { recursive: true });
  const dependencyPath = realpathSync(path.join(root, "node_modules"));
  symlinkSync(dependencyPath, path.join(buildCopy, "node_modules"), "dir");
  const runOptions = { cwd: buildCopy, stdio: "inherit" };
  const patch = path.join(pilot, "host.patch");
  execFileSync("git", ["apply", "--check", patch], runOptions);
  execFileSync("git", ["apply", patch], runOptions);
  execFileSync(process.execPath, [path.join(dependencyPath, "next/dist/bin/next"), "build"], {
    ...runOptions, env: { ...process.env, PAGES_BASE_PATH: childBase },
  });

  const output = path.join(buildCopy, "out");
  const index = readFileSync(path.join(output, "index.html"), "utf8");
  const assetLinks = [...index.matchAll(/(?:src|href)="([^"]*\/_next\/[^"]+)"/g)].map(match => match[1]);
  if (assetLinks.length === 0 || assetLinks.some(url => !url.startsWith(childBase + "/_next/"))) {
    throw new Error("The pilot export references assets outside its own release.");
  }
  // Prepare on the output filesystem. If a retry fails, preserve the previous
  // complete child export. Never replace an unrelated subdirectory or symlink.
  staged = mkdtempSync(path.join(root, ".m8-pilot-stage-"));
  const ready = path.join(staged, "ready");
  cpSync(output, ready, { recursive: true });
  writeFileSync(path.join(ready, ownerFile), ownerTag);
  const previous = path.join(staged, "previous");
  const existing = lstatSync(child, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isDirectory() || readFileSync(path.join(child, ownerFile), "utf8") !== ownerTag) {
      throw new Error("The existing light-pilot output is not an M8 pilot export.");
    }
    renameSync(child, previous);
  }
  try {
    renameSync(ready, child);
  } catch (error) {
    if (existing) renameSync(previous, child);
    throw error;
  }
  console.log("Packaged the account-scoped dashboard at " + childBase + "/");
} finally {
  rmSync(buildCopy, { recursive: true, force: true });
  if (staged) rmSync(staged, { recursive: true, force: true });
}
