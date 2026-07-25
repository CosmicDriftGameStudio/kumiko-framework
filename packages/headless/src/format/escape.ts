export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Superset of escapeHtml for attribute contexts: additionally escapes ' so
// single-quoted attributes cannot be broken out of.
export function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

// Shared API for app repos (publicstatus badge-SVG renders XML by hand) —
// no in-repo consumer yet, deliberately exported for cross-repo dedup.
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Strips ASCII control chars + space (codepoints 0x00-0x20 and 0x7f) — the
// same characters browsers strip before scheme detection. `.trim()` alone
// only removes leading/trailing whitespace, so a scheme like
// "java\tscript:" (tab embedded mid-scheme) survives to isSafeHref's regex
// check below, breaks its character class before the ":", falls through to
// `return true`, and the browser then normalizes it back to "javascript:"
// and executes it. Written as a char-code filter rather than a regex range
// to avoid embedding literal control characters in source.
export function stripControlChars(value: string): string {
  let result = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0x20 && code !== 0x7f) result += ch;
  }
  return result;
}

// http(s)/mailto or scheme-less (relative/anchor) allowed; javascript:,
// data:, vbscript:, etc. rejected. Shared between renderer-web's Link
// primitive and page-render's server-side markdown renderer (both take
// untrusted tenant-authored hrefs) — no sanitizer dependency needed for a
// four-line regex check.
export function isSafeHref(href: string): boolean {
  const trimmed = stripControlChars(href).toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*:/.test(trimmed)) return true;
  return /^(?:https?|mailto):/.test(trimmed);
}
