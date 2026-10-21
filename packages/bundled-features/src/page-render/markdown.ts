import { escapeHtml, isSafeHref } from "@cosmicdrift/kumiko-renderer/headless";
import { Marked } from "marked";

// Shared, hardened Markdown→HTML core for server-rendered public
// pages (legal-pages, managed-pages). Assumption: untrusted tenant authors.
// Raw HTML tokens are escaped as text (no <script>/<img onerror>-
// passthrough), and link/image hrefs are restricted to http(s)/mailto/relative
// (no javascript:/data:). Markdown structure (headings, lists, links,
// code) remains intact—this neutralizes XSS vectors without a sanitizer
// dependency. Defense in depth complements `securePageHeaders` (`script-src
// 'none'`). GFM and breaks are disabled—structured pages do not need
// tables/strikethrough/task lists.
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
  // @cast-boundary third-party-type-gap marked.parse return type is `string | Promise<string>`;
  // `{ async: false }` guarantees synchronous output (string)—the cast only fixes the API contract.
  return safeRenderer.parse(markdown, { async: false }) as string;
}
