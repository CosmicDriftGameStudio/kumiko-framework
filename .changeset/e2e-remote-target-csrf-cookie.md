---
"@cosmicdrift/kumiko-testing": minor
---

`defineAppE2eConfig` can target a running instance, and `csrfFetch` reads the https csrf cookie

Set `KUMIKO_E2E_REMOTE_BASE_URL` (http or https URL) and the template starts no web server and uses that URL as `baseURL`; `KUMIKO_E2E_STORAGE_STATE` adds a recorded Playwright session file. Timeouts, viewport and device scale factor stay with the template, so a `*.real.spec.ts` runs unchanged against staging or prod. A storage state without a remote base URL, or a URL that is not http(s), fails with a clear message.

`csrfHeaderFromCookies` and `csrfFetch` now find the csrf cookie under both `__Host-kumiko_csrf` (https) and `kumiko_csrf` (http), prefixed first. Against an https target they used to answer 403 `csrf_token_mismatch`.

<!-- kumiko-changes
feature: testing
type: improvement
title: defineAppE2eConfig runs against a remote instance via KUMIKO_E2E_REMOTE_BASE_URL; csrfFetch handles the __Host- csrf cookie
detail: KUMIKO_E2E_STORAGE_STATE supplies a recorded session. Without the remote env nothing changes.
-->
