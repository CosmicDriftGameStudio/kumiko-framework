import { createFileProviderS3Feature } from "../file-provider-s3/index.js";

/**
 * @deprecated Use createFileProviderS3Feature({ fromEnv: true }) from
 * `@cosmicdrift/kumiko-bundled-features/file-provider-s3`. Run `bun kumiko-upgrade --apply`.
 * Removed in the first release after 2026-10-29.
 */
export const fileProviderS3EnvFeature = createFileProviderS3Feature({ fromEnv: true });
