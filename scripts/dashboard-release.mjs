import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Public code fingerprint only. No environment values, timestamps, private
// source documents, Git metadata or user data enter the manifest.
export function writeDashboardRelease(root) {
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const name = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && /\.(?:[cm]?js|jsx|ts|tsx|css|json)$/.test(entry.name)) files.push(name);
    }
  };
  visit("src");
  visit("admin-preview");
  files.push("package.json", "pnpm-lock.yaml", "next.config.mjs", "scripts/dashboard-release.mjs", "admin-preview/build-restoration.py");
  const hash = createHash("sha256");
  for (const name of files.sort()) {
    const bytes = readFileSync(path.join(root, name));
    hash.update(name + "\0" + bytes.length + "\0");
    hash.update(bytes);
  }
  const revision = hash.digest("hex");
  mkdirSync(path.join(root, "public"), { recursive: true });
  writeFileSync(path.join(root, "public/dashboard-release.json"), JSON.stringify({ version: 1, revision }) + "\n");
  return revision;
}
