---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-renderer": patch
---

The demo-mode payload type and schema live in `@cosmicdrift/kumiko-types/demo-mode-types`, and `useDemoMode()` from `@cosmicdrift/kumiko-renderer/web` reads it.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Shared demo-mode payload and a useDemoMode hook for the browser
detail: Apps with the demoMode boot option mirrored the payload type of GET /demo-mode and cast the response. `@cosmicdrift/kumiko-types/demo-mode-types` now holds DEMO_MODE_PATH, DemoModePayload and demoModePayloadSchema, server-runtime re-exports DemoModePayload, and `useDemoMode()` from `@cosmicdrift/kumiko-renderer/web` fetches the route once per page, validates the answer and returns null while loading or when the server runs without demo mode.
-->
