---
"@cosmicdrift/kumiko-headless": patch
---

apex: re-export APEX_LIGHTBOX_SCRIPT_CSP_HASH from the apex barrel (`@cosmicdrift/kumiko-headless/apex`) —
it was only exported from the internal `./lightbox` module in the previous patch, so
`import { APEX_LIGHTBOX_SCRIPT_CSP_HASH } from "@cosmicdrift/kumiko-headless/apex"` (the
only public subpath) failed to resolve it.
