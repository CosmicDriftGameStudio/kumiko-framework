---
"@cosmicdrift/kumiko-bundled-features": patch
---

Fix `files-provider-s3` `writeStream` to trust Bun's S3-Writer for part boundaries instead of manually tracking `buffered` and calling `writer.flush()` at `STREAM_PART_SIZE`. The manual flush could commit a non-final part below the 5 MiB minimum, which AWS S3 and Cloudflare R2 reject with `EntityTooSmall` on `CompleteMultipartUpload` (the integration test runs against MinIO which doesn't enforce the minimum, so the failure mode was invisible there). Adds a multipart `writeStream` round-trip to the integration suite.
