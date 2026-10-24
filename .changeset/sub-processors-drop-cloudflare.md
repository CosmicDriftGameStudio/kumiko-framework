---
"@cosmicdrift/kumiko-framework": patch
---

Cloudflare is removed from the platform sub-processor list.

<!-- kumiko-changes
feature: compliance
type: fix
title: Cloudflare is no longer listed as a sub-processor
detail: DNS moved to Hetzner, so Cloudflare, Inc. no longer processes data for the platform. The entry is gone from KUMIKO_SUB_PROCESSORS, which means it is missing from /api/compliance/sub-processors and from the sub-processor RSS feed.
-->
