---
"@cosmicdrift/kumiko-framework": patch
---

Scaleway is listed as an active sub-processor for Key Manager and transactional email.

<!-- kumiko-changes
feature: framework
type: fix
title: Scaleway Key Manager and Transactional Email listed as active sub-processor
detail: The `KUMIKO_SUB_PROCESSORS` entry "Platform key custody (Key Manager) and Transactional Email Delivery" moves from `status: "planned"` to `"active"` (`addedAt` 2026-11-01), so `getActiveSubProcessors()` and the generated privacy texts name it. Transactional mail of the Kumiko apps now goes through Scaleway TEM; the Brevo entry stays until that account is closed, because Brevo still holds the logs of mail it sent.
-->
