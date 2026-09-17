---
"@cosmicdrift/kumiko-guards": patch
---

Fix Direct-Fetch Guard allowlist after egress moved to kumiko-http

The ALLOWLIST regex still pointed at the old packages/framework/src/http/egress.ts path; egress() now lives in packages/http/src/egress.ts (@cosmicdrift/kumiko-http), so the guard was about to self-flag its own allowed implementation as a raw-fetch violation.

<!-- kumiko-changes
feature: guards
type: fix
title: Fix Direct-Fetch Guard allowlist after egress moved to kumiko-http
-->
