---
"@cosmicdrift/kumiko-framework": patch
---

Client-supplied `X-Request-ID` / `X-Correlation-ID` headers are now validated against `/^[A-Za-z0-9._:-]{1,128}$/` before use. An oversized or malformed value is replaced with a freshly generated id instead of flowing unvalidated into append-only event-store metadata, where it would have been permanently stored, replayed on every rebuild, and included in GDPR exports.
