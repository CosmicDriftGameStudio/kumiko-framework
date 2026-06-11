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
