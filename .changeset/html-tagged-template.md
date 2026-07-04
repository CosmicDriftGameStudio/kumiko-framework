---
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
---

headless: new `html` tagged template + `raw()`/`RawHtml` — auto-escapes every interpolation, `raw()` marks prerendered markup, nested `html` fragments compose without double-escaping. Structural companion to the new HTML-escape guard (infra#201).

Hardening from the guard's first run: apex JSON-LD `<script>` block serializes `<` as `<` (no `</script>` breakout), dev-server `injectSchema` does the same for `window.__KUMIKO_SCHEMA__`; apex/page-render prerendered fragments renamed to the `*Html` convention.
