---
"@cosmicdrift/kumiko-http": patch
---

`isBlockedIp` now recognizes more encodings of already-blocked addresses instead of only the two-trailing-group compressed form: the deprecated IPv4-compatible IPv6 form (`::a.b.c.d`), the IPv4-translated form (`::ffff:0:a.b.c.d`), and the NAT64 local-use prefix (`64:ff9b:1::/48`) each with their embedded IPv4 checked against the same range table, plus the `192.0.0.0/24` and `198.18.0.0/15` reserved IPv4 ranges. Embedded-IPv4 detection is now compression-agnostic (expands to the full 8-group form before matching), which also fixes a case the previous two-group regex missed: an embedded IPv4 with a leading zero octet, e.g. `64:ff9b::0.0.0.1`, canonicalizes to a single trailing hex group and was not being blocked.

<!-- kumiko-changes
feature: http
type: fix
title: isBlockedIp closes embedded-IPv4 and reserved-range gaps in the egress guard
detail: |
  Adds detection for IPv4-compatible IPv6 (`::a.b.c.d`, RFC 4291), IPv4-
  translated IPv6 (`::ffff:0:a.b.c.d`, RFC 8215), and the NAT64 local-use
  prefix `64:ff9b:1::/48` (RFC 8215) — each checked against the existing
  IPv4 blocklist for its embedded address. Adds the `192.0.0.0/24` and
  `198.18.0.0/15` reserved IPv4 ranges. Replaces the previous regex-based
  embedded-IPv4 matching (which required exactly two trailing hex groups)
  with a full 8-group expansion, fixing a false negative for embedded
  IPv4 addresses with a leading zero octet that compress to fewer groups.
migration: |
  No API change. Some addresses that previously resolved through
  `resolvePublicHost`/`resolvePublicHostname`/`isPublicHost` as "not
  blocked" are now correctly rejected as blocked. This only narrows what
  is treated as a public egress target.
-->
