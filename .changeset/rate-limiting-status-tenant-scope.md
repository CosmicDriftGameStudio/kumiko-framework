---
"@cosmicdrift/kumiko-bundled-features": minor
---

`rate-limiting:query:status` scopes the caller-supplied bucket key to the caller's tenant (fw#3076)

The handler took an arbitrary bucket key and peeked it, so a tenant Admin who knew or guessed another tenant's key could read that bucket's counter. The key is now matched segment-exact against the caller: `tenant:`/`tenant+handler:` must carry the caller's own tenant id, `user:`/`user+handler:` the caller's own user id. Everything else — other tenants, other users, the global `ip:`, `l1:` and `l2:` middleware buckets, malformed keys — is `access_denied` (`bucket_outside_tenant`) unless the caller is SystemAdmin, whose access is unchanged. The check runs before the resolver-wiring check, so a denied caller learns nothing about the mount either.

<!-- kumiko-changes
feature: rate-limiting
type: breaking
title: `rate-limiting:query:status` only peeks buckets of the calling tenant (fw#3076)
migration: |
  Only affects non-SystemAdmin callers of `rate-limiting:query:status`. A tenant
  Admin keeps `tenant:<own>`, `tenant+handler:<own>:<handler>`, `user:<self>` and
  `user+handler:<self>:<handler>`. Two reads it had before now need SystemAdmin:
  another user's bucket inside the same tenant (the tenant is not part of a
  `user:` key, so it cannot be verified without a membership lookup) and the
  global `ip:`/`l1:`/`l2:` buckets, which are not tenant-owned. Ops tooling that
  peeks those from a tenant Admin session has to run as SystemAdmin.
-->
