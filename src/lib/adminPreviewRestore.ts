import { oldAdapter, newModules, restoredCss } from "./adminPreviewRestore.generated";

// The marker identifies the patch format. Full byte equality of both enclosed
// blocks identifies the approved revision; a marker alone never permits reuse.
const PREFIX = "HENSEM_APPROVED_ADMIN_RESTORE:";
const SCRIPT_START = `/* ${PREFIX}v1:SCRIPT:BEGIN */`;
const SCRIPT_END = `/* ${PREFIX}v1:SCRIPT:END */`;
const STYLE_START = `/* ${PREFIX}v1:STYLE:BEGIN */`;
const STYLE_END = `/* ${PREFIX}v1:STYLE:END */`;

function fail(): never {
  throw new Error("新版后台文档版本不匹配，无法安全还原，请重新加载或联系管理员。");
}

function count(text: string, value: string): number {
  let result = 0, position = 0;
  while ((position = text.indexOf(value, position)) !== -1) {
    result++; position += value.length;
  }
  return result;
}

function insideInlineScript(html: string, start: number, length: number): boolean {
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scripts.exec(html))) {
    const contentStart = match.index + match[0].indexOf(">") + 1;
    if (start >= contentStart && start + length <= contentStart + match[2].length) {
      return !/\bsrc\s*=/i.test(match[1]);
    }
  }
  return false;
}

function firstStyle(html: string): { start: number; end: number } {
  const match = /<style\b[^>]*>([\s\S]*?)(<\/style\s*>)/i.exec(html);
  if (!match) return fail();
  return { start: match.index + match[0].indexOf(">") + 1,
    end: match.index + match[0].length - match[2].length };
}

/** Call only after the host has obtained the authorized detailed-admin HTML.
 * This pure code substitution neither fetches data nor changes access rights.
 * Unknown, partially patched, or duplicate versions are rejected atomically.
 */
export function restoreApprovedAdmin(html: string): string {
  if (typeof html !== "string" || !oldAdapter || !newModules || !restoredCss
      || oldAdapter === newModules || newModules.includes(oldAdapter)
      || /<\/script/i.test(newModules) || /<\/style/i.test(restoredCss)
      || [oldAdapter, newModules, restoredCss].some(value => value.includes(PREFIX))) return fail();

  const script = `${SCRIPT_START}\n${newModules}\n${SCRIPT_END}`;
  const css = `\n${STYLE_START}\n${restoredCss}\n${STYLE_END}\n`;
  const style = firstStyle(html);

  if (html.includes(PREFIX)) {
    if (count(html, PREFIX) !== 4 || count(html, script) !== 1 || count(html, css) !== 1
        || count(html, oldAdapter) !== 0) return fail();
    const scriptAt = html.indexOf(script), cssAt = html.indexOf(css);
    if (!insideInlineScript(html, scriptAt, script.length)
        || cssAt < style.start || cssAt + css.length !== style.end) return fail();
    return html;
  }

  if (count(html, oldAdapter) !== 1) return fail();
  const adapterAt = html.indexOf(oldAdapter);
  if (!insideInlineScript(html, adapterAt, oldAdapter.length) || style.end >= adapterAt) return fail();
  // Slicing preserves every other byte, including replacement metacharacters
  // in code strings, source snapshots, original styles, and sibling scripts.
  const replaced = html.slice(0, adapterAt) + script + html.slice(adapterAt + oldAdapter.length);
  return replaced.slice(0, style.end) + css + replaced.slice(style.end);
}
