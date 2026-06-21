// kumiko-feature-version: 1
//
// file-provider-s3-env — S3 file provider configured entirely from
// process.env. ONE shared bucket for ALL tenants: wire it by setting the
// `S3_*` env vars + mounting — no per-tenant admin seeding and no
// `secrets`-feature dependency.
//
// **vs file-provider-s3:** the config-based `"s3"` provider owns per-tenant
// config keys + an encrypted `s3.secretAccessKey` secret (per-tenant
// buckets, admin-seeded). This `"s3-env"` provider reads one credential set
// from env and serves every tenant from one bucket — the
// Hetzner-Object-Storage / single-bucket deploy case. Tenant isolation
// still holds: file keys are tenant-prefixed (export ZIPs:
// `<tenantId>/exports/<jobId>.zip`) or globally-unique UUIDs (fileRefs).
//
// **Pattern-Vorbild:** mirrors file-provider-inmemory (zero admin seeding,
// only the file-foundation plugin-point required).
//
// **Env vars** (read by createS3ProviderFromEnv, prefix `S3_`):
//   required — S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY
//   optional — S3_ENDPOINT (S3-compat stores incl. Hetzner Object Storage),
//              S3_FORCE_PATH_STYLE
// Missing required vars throw on the FIRST file op (inside the export cron).
// The user-data-rights boot guard surfaces that at boot instead.

import type {
  FileProviderContext,
  FileProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createS3ProviderFromEnv } from "@cosmicdrift/kumiko-bundled-features/files-provider-s3";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";

const FEATURE_NAME = "file-provider-s3-env";

export const fileProviderS3EnvFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    'Registers an `"s3-env"` provider for `file-foundation` that reads one S3 credential set from `process.env` (`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`, optional `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`) and serves every tenant from one shared bucket — no per-tenant config or secret seeding. Use this for single-bucket S3-compatible deploys (e.g. Hetzner Object Storage); use `file-provider-s3` instead when each tenant needs its own bucket/credentials.',
  );
  r.uiHints({
    displayLabel: "File Provider · S3 (env)",
    category: "storage",
    recommended: false,
  });
  // No r.requires("config") / r.requires("secrets") — credentials come from
  // env, not the per-tenant config + secrets store. Only the file-foundation
  // plugin-extension-point must be mounted.
  r.requires("file-foundation");

  const plugin: FileProviderPlugin = {
    // tenantId ignored: one shared bucket serves all tenants (isolation via
    // tenant-prefixed / UUID keys). Built fresh per call like file-provider-s3;
    // the S3 client opens no connection at construction.
    build: async (_ctx: FileProviderContext, _tenantId: string): Promise<FileStorageProvider> =>
      createS3ProviderFromEnv(), // @wrapper-known semantic-alias
  };
  r.useExtension("fileProvider", "s3-env", plugin);
});
