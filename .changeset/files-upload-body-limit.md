---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Upload requests are now size-checked before the body is buffered

`POST /api/files` previously ran `parseBody()` on the full multipart request before any size check, so the body was parsed in full before the configured `maxUploadSize` ever ruled it out. It now rejects requests over the configured limit (checked upfront via `Content-Length`, and while streaming for chunked bodies) with a 413 before parsing. `runProdApp` and the dev server now also derive `Bun.serve`'s request-body cap from that same `maxUploadSize`/field `maxSize` configuration instead of Bun's own 128 MiB default; `buildBunServeOptions` keeps a lower fixed fallback for direct callers, overridable via `runProdApp`'s new `maxRequestBodySize` option.

<!-- kumiko-changes
feature: framework
type: fix
title: Upload requests are now size-checked before the body is buffered
-->
