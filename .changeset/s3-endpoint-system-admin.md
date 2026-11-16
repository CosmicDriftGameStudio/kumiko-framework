---
"@cosmicdrift/kumiko-bundled-features": minor
---

The S3 endpoint and path-style config of file-provider-s3 can now only be written by a SystemAdmin.

<!-- kumiko-changes
feature: file-provider-s3
type: breaking
title: S3 endpoint and forcePathStyle are SystemAdmin-writable only
detail: The server connects to the configured S3 `endpoint` with the tenant's stored credentials and applies no host policy, so a TenantAdmin choosing the endpoint could point the server at internal hosts (SSRF). `file-provider-s3:config:endpoint` and `file-provider-s3:config:force-path-style` are now writable by SystemAdmin only (read access is unchanged). `bucket`, `region`, `accessKeyId` and the secret access key stay tenant-writable, so a tenant still brings its own bucket on the endpoint the operator chose.
migration: Set the endpoint and forcePathStyle of tenants that use a custom S3-compatible store (Hetzner, MinIO, R2) as a SystemAdmin, or seed them. Calls that write these keys as a TenantAdmin now fail with 403.
-->
