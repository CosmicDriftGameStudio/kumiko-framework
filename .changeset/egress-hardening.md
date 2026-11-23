---
"@cosmicdrift/kumiko-framework": patch
---

`egress`: more reserved IPv6 ranges are refused, and the caller's abort signal now also covers DNS resolution.

<!-- kumiko-changes
feature: framework
type: fix
title: `egress` refuses Teredo, discard, benchmarking, documentation and multicast IPv6 ranges and aborts a hanging DNS lookup with the caller's signal
detail: `external` and `tenant-supplied` (and `isPublicHost`, `resolvePublicHost`, `resolvePublicHostname`) now also refuse 2001::/32, 100::/64, 2001:2::/48, 2001:db8::/32, 3fff::/20 and ff00::/8. When the caller passes `init.signal`, an abort or timeout during the DNS lookup rejects with the signal's reason, the same error fetch throws, instead of waiting for the resolver. egress still sets no default deadline or response size limit; pass your own signal and cap the body you read.
-->
