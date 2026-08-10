---
"@cosmicdrift/kumiko-bundled-features": minor
---

`form-draft` now hard-deletes drafts past a configurable retention window via a daily cron job (`form-draft:job:cleanup`, config key `form-draft:config:retention-days`, SystemAdmin-writable, default 30 days). System-scoped rather than per-tenant: draft rows are ephemeral pre-submit scratch state, not a compliance policy that varies by tenant.
