---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

CI: switch publish to npm-CLI with OIDC Trusted Publishing + provenance.
No source changes — verifies the new publish path produces a verified-
provenance attestation on npmjs.com instead of token-based publish.
