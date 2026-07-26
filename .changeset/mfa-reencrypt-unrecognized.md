---
"@cosmicdrift/kumiko-bundled-features": patch
---

`auth-mfa` KEK reencrypt job classifies post-PII-peel values as rotate/current/unrecognized (mirrors config #1513): non-envelope rows fail loudly instead of being treated as legacy-to-rotate (#1541).
