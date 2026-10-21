// kumiko-feature-version: 1
//
// file-provider-s3 — concrete S3 implementation for the
// file-foundation plugin API.
//
// **What this feature provides:**
//   1. Provider-specific tenant config (bucket/region/endpoint/
//      forcePathStyle/accessKeyId) and secret (s3.secretAccessKey).
//      Self-contained — file-foundation does not know about these.
//   2. Plugin registration via `r.useExtension("fileProvider", "s3",
//      { build })`. file-foundation's factory finds the plugin through
//      the registry.
//   3. build(ctx, tenantId) reads the config and secret, then calls
//      `createS3Provider` from ./lib. This is the plugin's only
//      cross-feature import, intentionally kept local.
//
// **Pattern reference:** mirrors mail-transport-smtp.
//
// **Boot dependencies:** config + secrets + file-foundation.

import type {
  FileProviderContext,
  FileProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import {
  requireDefined,
  requireNonEmpty,
  requireSecretSet,
} from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";
import { createFileProviderS3EnvFeature } from "./env-feature.ts";
import { createS3Provider } from "./lib/s3-provider.ts";

const FEATURE_NAME = "file-provider-s3";

// =============================================================================
// Feature-definition
// =============================================================================
function createTenantConfigFileProviderS3Feature() {
  return defineFeature(
    FEATURE_NAME,
    (r) => {
      r.describe(
        'Registers itself as the `"s3"` provider for `file-foundation` and owns the per-tenant config keys (`bucket`, `region`, `endpoint`, `forcePathStyle`, `accessKeyId`) and the encrypted `s3.secretAccessKey` secret. Compatible with any S3-compatible object store (AWS S3, Hetzner Object Storage); set credentials via the admin UI or a seed handler before the first file operation.',
      );
      r.uiHints({
        displayLabel: "File Provider · S3",
        category: "storage",
        recommended: false,
      });
      r.requires({ features: ["config"] });
      r.requires({ features: ["secrets"] });
      r.requires({ features: ["file-foundation"] });

      const secretAccessKey = r.secret("s3.secretAccessKey", {
        label: { en: "S3 secret access key" },
        hint: {
          en: "Private half of the S3 key pair. Hetzner calls it 'Secret Key', AWS calls it 'Secret Access Key'.",
        },
        redact: (plaintext) => {
          if (plaintext.length < 8) return "•".repeat(plaintext.length);
          return `${plaintext.slice(0, 4)}...${plaintext.slice(-4)}`;
        },
        scope: "tenant",
        // required: true ↔ the missing-secret throw in readSecretAccessKey — keep in sync.
        required: true,
      });

      // required: true ↔ the requireNonEmpty calls in buildS3Provider — keep in sync.
      const configKeys = r.config({
        keys: {
          bucket: createTenantConfig("text", {
            required: true,
            default: "",
            write: access.roles("TenantAdmin", "SystemAdmin"),
            read: access.roles("TenantAdmin", "SystemAdmin"),
          }),
          region: createTenantConfig("text", {
            required: true,
            default: "",
            write: access.roles("TenantAdmin", "SystemAdmin"),
            read: access.roles("TenantAdmin", "SystemAdmin"),
          }),
          endpoint: createTenantConfig("text", {
            default: "",
            write: access.roles("TenantAdmin", "SystemAdmin"),
            read: access.roles("TenantAdmin", "SystemAdmin"),
          }),
          forcePathStyle: createTenantConfig("boolean", {
            default: false,
            write: access.roles("TenantAdmin", "SystemAdmin"),
          }),
          accessKeyId: createTenantConfig("text", {
            required: true,
            default: "",
            write: access.roles("TenantAdmin", "SystemAdmin"),
            read: access.roles("TenantAdmin", "SystemAdmin"),
          }),
        },
      });

      // Plugin registration. The entityName "s3" is what tenants set in
      //      // file-foundation's `provider` config key.
      const plugin: FileProviderPlugin = {
        build: async (ctx: FileProviderContext, tenantId: string) => buildS3Provider(ctx, tenantId), // @wrapper-known semantic-alias
      };
      r.useExtension("fileProvider", "s3", plugin);

      return { configKeys, secretAccessKey };
    },
    { dedupeOptions: {} },
  );
}

export type FileProviderS3FeatureOptions = {
  /** Read one shared credential set from the `S3_*` env vars (provider key "s3-env", feature name "file-provider-s3-env") instead of per-tenant config and secret. */
  readonly fromEnv?: boolean;
};

export function createFileProviderS3Feature(options: {
  readonly fromEnv: true;
}): ReturnType<typeof createFileProviderS3EnvFeature>;
export function createFileProviderS3Feature(options?: {
  readonly fromEnv?: false;
}): ReturnType<typeof createTenantConfigFileProviderS3Feature>;
export function createFileProviderS3Feature(
  options: FileProviderS3FeatureOptions,
):
  | ReturnType<typeof createFileProviderS3EnvFeature>
  | ReturnType<typeof createTenantConfigFileProviderS3Feature>;
export function createFileProviderS3Feature(options: FileProviderS3FeatureOptions = {}) {
  return options.fromEnv === true
    ? createFileProviderS3EnvFeature()
    : createTenantConfigFileProviderS3Feature();
}

// Typed config/secret handles are identical across instances, so one module-level instance serves them.
const tenantConfigFeature = createTenantConfigFileProviderS3Feature();

/** Typed handle for the S3 secret-access-key. */
export const S3_SECRET_ACCESS_KEY = tenantConfigFeature.exports.secretAccessKey;

// =============================================================================
// Internal: build the FileStorageProvider from tenant config + secret
// =============================================================================

async function buildS3Provider(
  ctx: FileProviderContext,
  tenantId: string,
): Promise<FileStorageProvider> {
  const ctxConfig = ctx.config;
  if (!ctxConfig) {
    throw new Error(
      `${FEATURE_NAME}: ctx.config is missing — feature requires the config-feature mounted in the registry`,
    );
  }

  const FILE_HINT = "Set via tenant-admin UI or seed-handler before reading or writing files.";
  const bucket = requireNonEmpty(
    await ctxConfig(tenantConfigFeature.exports.configKeys.bucket),
    FEATURE_NAME,
    "bucket",
    FILE_HINT,
  );
  const region = requireNonEmpty(
    await ctxConfig(tenantConfigFeature.exports.configKeys.region),
    FEATURE_NAME,
    "region",
    FILE_HINT,
  );
  const endpointRaw = requireDefined(
    await ctxConfig(tenantConfigFeature.exports.configKeys.endpoint),
    FEATURE_NAME,
    "endpoint",
  ) as string; // @cast-boundary engine-payload
  const endpoint = endpointRaw.length > 0 ? endpointRaw : undefined;
  const forcePathStyle = requireDefined(
    await ctxConfig(tenantConfigFeature.exports.configKeys.forcePathStyle),
    FEATURE_NAME,
    "forcePathStyle",
  ) as boolean; // @cast-boundary engine-payload
  const accessKeyId = requireNonEmpty(
    await ctxConfig(tenantConfigFeature.exports.configKeys.accessKeyId),
    FEATURE_NAME,
    "accessKeyId",
    FILE_HINT,
  );

  const secretAccessKey = await readSecretAccessKey(ctx, tenantId);

  return createS3Provider({
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    ...(endpoint !== undefined && { endpoint }),
    forcePathStyle,
  });
}

async function readSecretAccessKey(ctx: FileProviderContext, tenantId: string): Promise<string> {
  const secrets = requireSecretsContext(ctx, FEATURE_NAME);
  const branded = await secrets.get(tenantId, S3_SECRET_ACCESS_KEY);
  return requireSecretSet(branded, FEATURE_NAME, S3_SECRET_ACCESS_KEY.name).reveal();
}
