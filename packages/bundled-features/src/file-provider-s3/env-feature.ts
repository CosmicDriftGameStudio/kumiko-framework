// One bucket for all tenants from `<prefix>*` env vars, no per-tenant seeding; tenant isolation comes
// from tenant-prefixed or UUID keys. Missing vars throw on the first file op (the user-data-rights
// boot guard reports them earlier).

import type {
  FileProviderContext,
  FileProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";
import type * as z from "zod";
import { s3EnvSchema } from "./env-schema.ts";
import { createS3ProviderFromEnv } from "./lib/env-helper.ts";

export function defineS3EnvProviderFeature<TShape extends z.ZodRawShape>(spec: {
  readonly featureName: string;
  readonly providerKey: string;
  readonly envPrefix: string;
  readonly envSchema: z.ZodObject<TShape>;
  readonly description: string;
  readonly displayLabel: string;
  readonly dedupeOptions: Readonly<Record<string, string>>;
}) {
  const feature = defineFeature(
    spec.featureName,
    (r) => {
      r.describe(spec.description);
      r.uiHints({
        displayLabel: spec.displayLabel,
        category: "storage",
        recommended: false,
      });
      r.requires({ features: ["file-foundation"] });
      r.envSchema(spec.envSchema);

      const plugin: FileProviderPlugin = {
        build: async (_ctx: FileProviderContext, _tenantId: string): Promise<FileStorageProvider> =>
          createS3ProviderFromEnv(spec.envPrefix),
      };
      r.useExtension("fileProvider", spec.providerKey, plugin);
    },
    { dedupeOptions: spec.dedupeOptions },
  );
  return featureWithEnvSchema(feature, spec.envSchema);
}

export function createFileProviderS3EnvFeature() {
  return defineS3EnvProviderFeature({
    featureName: "file-provider-s3-env",
    providerKey: "s3-env",
    envPrefix: "S3_",
    envSchema: s3EnvSchema,
    description:
      'Registers an `"s3-env"` provider for `file-foundation` that reads one S3 credential set from `process.env` (`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`, optional `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`) and serves every tenant from one shared bucket — no per-tenant config or secret seeding. Use this for single-bucket S3-compatible deploys (e.g. Hetzner Object Storage); use `file-provider-s3` instead when each tenant needs its own bucket/credentials.',
    displayLabel: "File Provider · S3 (env)",
    dedupeOptions: {},
  });
}
