---
"@cosmicdrift/kumiko-bundled-features": minor
---

legal-pages: harden the server-render path against untrusted authors. Raw HTML in Markdown bodies is now escaped instead of passed through (`<script>` → `&lt;script&gt;`), link/image hrefs are scheme-restricted to http(s)/mailto/relative (`javascript:`/`data:` neutralised to `#`), and every server-rendered response carries `Content-Security-Policy: script-src 'none'; object-src 'none'; base-uri 'none'` plus `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`. Closes a latent stored-XSS in `renderMarkdownToHtml`. Markdown structure (headings, lists, links, code) is unaffected; no `default-src` is set, so inline `<style>` layouts keep working.
