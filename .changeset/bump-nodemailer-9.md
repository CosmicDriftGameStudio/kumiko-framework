---
"@cosmicdrift/kumiko-bundled-features": patch
---

Bump `nodemailer` 8 → 9.0.1 to clear GHSA-p6gq-j5cr-w38f (HIGH): the
message-level `raw` option bypassed `disableFileAccess`/`disableUrlAccess`,
enabling arbitrary file read and SSRF in the delivered message. The SMTP
transport only uses `createTransport` + `sendMail` with structured fields
(never `raw`), so the public API is unchanged — this is a defense-in-depth
upgrade. 9.0.1 also clears the 8.0.9 advisories GHSA-268h-hp4c-crq3 and
GHSA-wqvq-jvpq-h66f.
