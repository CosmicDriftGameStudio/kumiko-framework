---
"@cosmicdrift/kumiko-bundled-features": minor
---

The storage provider selection (`file-foundation:config:provider`) can now be written by a SystemAdmin only; a tenant admin can still read it.

<!-- kumiko-changes
feature: file-foundation
type: breaking
title: Storage provider selection is SystemAdmin-only
detail: The config key `file-foundation:config:provider` chose which storage plugin serves a tenant and was writable by TenantAdmin. Storage provider selection is platform-level, so only a SystemAdmin may write it now; a TenantAdmin write fails with 403. Reading is unchanged.
migration: Set the provider through a SystemAdmin or pin it with an app override or the `FILE_STORAGE_PROVIDER` environment variable instead of letting tenant admins write it.
affects: file-foundation
-->
