import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { Marked } from "marked";

// Markdown→HTML mit eigener `marked`-Instance. GFM aus, breaks aus —
// Legal-Pages sind strukturiert genug dass GFM-Tables/Strikethrough/
// Task-Lists nicht nötig sind. Headers + Listen + Links + Code reichen.
//
// Instance statt globaler `marked.setOptions()` damit andere Features
// die `marked` als runtime-dep nutzen ihre eigenen Optionen behalten —
// modul-level side-effect auf shared library wäre brittle bei mehreren
// Konsumenten.
//
// XSS-Härtung (Annahme: untrusted Tenant-Authoren): Raw-HTML-Tokens werden
// als Text escaped (kein <script>/<img onerror>-Passthrough), und link/image-
// hrefs auf http(s)/mailto/relativ beschränkt (kein javascript:/data:). Die
// Markdown-Struktur (Headings, Listen, Links, Code) bleibt intakt — das
// neutralisiert die XSS-Vektoren ohne Sanitizer-Dependency. Defense-in-Depth
// ergänzt der server-render-Header `script-src 'none'` (feature.ts).
const markdownRenderer = new Marked({ gfm: false, breaks: false });
markdownRenderer.use({
  walkTokens(token) {
    if ((token.type === "link" || token.type === "image") && !isSafeHref(token.href)) {
      token.href = "#";
    }
  },
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

// http(s)/mailto oder schema-los (relativ/anchor) erlaubt; javascript:, data:,
// vbscript: u.a. abgelehnt. Ein relativer href hat kein `scheme:`-Präfix.
function isSafeHref(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*:/.test(trimmed)) return true;
  return /^(?:https?|mailto):/.test(trimmed);
}

export function renderMarkdownToHtml(markdown: string): string {
  // @cast-boundary marked.parse return-type ist `string | Promise<string>`;
  // `{ async: false }` garantiert sync (string) — Cast nur API-Vertragsfix.
  return markdownRenderer.parse(markdown, { async: false }) as string;
}

// Layout-Wrapper für Legal-Pages — minimaler HTML-Skeleton mit Inline-
// CSS damit die Pages auch ohne App-Layout sauber aussehen. Apps die
// das in ihr eigenes Layout integrieren wollen, nutzen text-content's
// by-slug-query direkt und rendern selbst.
export function wrapInLayout(opts: { title: string; bodyHtml: string; lang: string }): string {
  return `<!doctype html>
<html lang="${escapeHtmlAttr(opts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px;
         margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #222; }
  h1, h2, h3 { line-height: 1.2; margin-top: 2rem; }
  h1 { font-size: 1.8rem; } h2 { font-size: 1.4rem; } h3 { font-size: 1.15rem; }
  a { color: #0066cc; }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 2rem 0; }
</style>
</head>
<body>
<main>
${opts.bodyHtml}
</main>
</body>
</html>`;
}
