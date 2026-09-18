const HEAD_TAGS_MARKER = "<!-- kumiko-page-head -->";
const TITLE_TAG_RE = /<title\b[^>]*>[\s\S]*?<\/title>/i;

// Idempotent by marker (repeated calls, e.g. hostDispatch + default path
// both hitting the same request, never double-inject) and safe on a
// head-less document (nothing to splice into). `tagsHtml` is pre-rendered
// HTML from a caller (renderApexHeadTags) — this function only owns
// placement + the original <title> removal, not escaping.
export function injectPageHead(html: string, tagsHtml: string): string {
  if (html.includes(HEAD_TAGS_MARKER)) return html;
  if (!html.includes("</head>")) return html;
  const withoutTitle = html.replace(TITLE_TAG_RE, "");
  return withoutTitle.replace("</head>", () => `${HEAD_TAGS_MARKER}\n${tagsHtml}\n</head>`);
}
