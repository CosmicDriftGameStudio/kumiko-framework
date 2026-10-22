// Re-export from the shared page-rendering core (managed pages use
// the same hardened renderer and default layout). Keep these names stable
// for legal-pages' public API (index.ts exports renderMarkdownToHtml and
// wrapInLayout).

export { wrapInLayout } from "../page-render/layout.ts";
export { renderSafeMarkdown as renderMarkdownToHtml } from "../page-render/markdown.ts";
