---
"@cosmicdrift/kumiko-framework": patch
---

Signature routes accept `binaryBody: { maxBytes }` for raw uploads outside /api.

<!-- kumiko-changes
feature: api
type: improvement
title: Signature routes can take a raw binary body
detail: A signature route declared through `binaryBodySignatureRoute` with `binaryBody: { maxBytes }` is not read before `verify()`, which receives the request without `rawBody`; the handler reads the bytes from `c.req` itself, so non-UTF-8 content stays intact. The route replaces the server-wide `maxRequestBytes` with its own cap (413 above it). Only allowed outside `/api/`; `maxBytes` must be a safe integer of at least 1. Existing signature routes are unchanged.
affects: extraRoutes, binaryBodySignatureRoute, SignatureExtraRoute
-->
