import { escapeHtml } from "@cosmicdrift/kumiko-headless";
import { Marked } from "marked";

// Geteilter, gehärteter Markdown→HTML-Kern für server-gerenderte Public-
// Pages (legal-pages, managed-pages). Annahme: untrusted Tenant-Authoren.
// Raw-HTML-Tokens werden als Text escaped (kein <script>/<img onerror>-
// Passthrough), und link/image-hrefs auf http(s)/mailto/relativ beschränkt
// (kein javascript:/data:). Markdown-Struktur (Headings, Listen, Links,
// Code) bleibt intakt — das neutralisiert die XSS-Vektoren ohne Sanitizer-
// Dependency. Defense-in-Depth ergänzt `securePageHeaders` (`script-src
// 'none'`). GFM aus, breaks aus — strukturierte Pages brauchen keine
// Tables/Strikethrough/Task-Lists.
const safeRenderer = new Marked({ gfm: false, breaks: false });
safeRenderer.use({
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

export function renderSafeMarkdown(markdown: string): string {
  // @cast-boundary marked.parse return-type ist `string | Promise<string>`;
  // `{ async: false }` garantiert sync (string) — Cast nur API-Vertragsfix.
  return safeRenderer.parse(markdown, { async: false }) as string;
}
