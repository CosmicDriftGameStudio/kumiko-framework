import { escapeHtml, isSafeHref } from "@cosmicdrift/kumiko-headless";
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

export function renderSafeMarkdown(markdown: string): string {
  // @cast-boundary marked.parse return-type ist `string | Promise<string>`;
  // `{ async: false }` garantiert sync (string) — Cast nur API-Vertragsfix.
  return safeRenderer.parse(markdown, { async: false }) as string;
}
