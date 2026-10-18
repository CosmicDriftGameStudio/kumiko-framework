---
"@cosmicdrift/kumiko-server-runtime": minor
---

runProdApp ships a CSP and L1/L2 rate limits by default

<!-- kumiko-changes
feature: security-defaults
type: feature
title: runProdApp sets a Content-Security-Policy and L1/L2 rate limits without configuration
detail: Without options, runProdApp now sends a default CSP (default-src 'self'; script-src 'self' plus the sha256 hashes of the build's inline scripts; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self') and limits requests per client IP to 600/60 s (L1) and 30/60 s on /api/auth/* (L2). kumiko build writes dist/csp-hashes.json from every HTML file it outputs; without that file the CSP has no hashes and boot warns. securityHeaders.csp takes false (off), a string (replaces the default) or { extend: { directive: [sources] } }. rateLimit: false disables both layers, partial values override only the named fields. Apps with their own CSP set the header through securityHeaders.csp as a string or move their additions to extend; apps that need neither opt out with csp: false and rateLimit: false. Behind a reverse proxy set trustedProxyHops, otherwise all clients share one rate-limit bucket. Details in docs/reference/security-defaults.md.
-->
