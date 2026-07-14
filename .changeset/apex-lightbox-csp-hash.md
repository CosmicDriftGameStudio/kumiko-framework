---
"@cosmicdrift/kumiko-headless": patch
---

apex: export `APEX_LIGHTBOX_SCRIPT_CSP_HASH` for the screenshot-lightbox's inline
`<script>` — apps enforcing a strict `script-src 'self'` CSP (no `'unsafe-inline'`/nonce)
on their apex/marketing surface had a silently broken lightbox (Chrome blocked the inline
script, no error surfaced anywhere except the browser console). A nonce isn't viable here:
apex pages are frequently pre-rendered to static HTML at build time, where there's no
per-request nonce to inject. Add the exported hash to your CSP's `script-src` directive
instead. A dedicated test ties the constant to the actual script body, so a future edit
to the script that forgets to update the hash fails CI rather than silently breaking every
strict-CSP consumer.
