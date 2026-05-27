---
"@cosmicdrift/kumiko-bundled-features": patch
---

Replace the AWS SDK S3 client with Bun's native `Bun.S3Client` in the `files-provider-s3` storage provider. Drops the `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, and `@aws-sdk/s3-request-presigner` runtime dependencies. Public API (`createS3Provider`, `createS3ProviderFromEnv`, `resolveForcePathStyle`) is unchanged; multipart streaming, presigned download URLs with content-disposition, and path-style/virtual-host auto-detection are preserved and verified against MinIO.
