// kumiko-feature-version: 1
//
// file-provider-s3 — concrete S3-implementation for the
// file-foundation plugin-API.
//
// **Was diese Feature liefert:**
//   1. Provider-spezifische Tenant-Config (bucket/region/endpoint/
//      forcePathStyle/accessKeyId) und Secret (s3.secretAccessKey).
//      Self-contained — file-foundation kennt diese nicht.
//   2. Plugin-Registration via `r.useExtension("fileProvider", "s3",
//      { build })`. file-foundation's Factory findet den Plugin via
//      registry.
//   3. build(ctx, tenantId) liest config + secret, ruft `createS3Provider`
//      aus files-provider-s3 auf. Der EINZIGE Cross-Feature-Import
//      des Plugins — bewusst lokal gehalten.
//
// **Pattern-Vorbild:** mirrors mail-transport-smtp.
//
// **Boot-Dependencies:** config + secrets + file-foundation.

import type { FileProviderPlugin } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createS3Provider } from "@cosmicdrift/kumiko-bundled-features/files-provider-s3";
import {
  requireDefined,
  requireNonEmpty,
} from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  access,
  createTenantConfig,
  defineFeature,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";

const FEATURE_NAME = "file-provider-s3";

// =============================================================================
// Feature-definition
// =============================================================================

export const fileProviderS3Feature = defineFeature(FEATURE_NAME, (r) => {
  r.requires("config");
  r.requires("secrets");
  r.requires("file-foundation");

  const secretAccessKey = r.secret("s3.secretAccessKey", {
    label: { de: "S3 Secret Access Key", en: "S3 Secret Access Key" },
    hint: {
      de: "Privater Teil des S3-Schlüsselpaares. Bei Hetzner Object Storage 'Secret Key', bei AWS S3 'Secret Access Key'.",
      en: "Private half of the S3 key pair. Hetzner calls it 'Secret Key', AWS calls it 'Secret Access Key'.",
    },
    redact: (plaintext) => {
      if (plaintext.length < 8) return "•".repeat(plaintext.length);
      return `${plaintext.slice(0, 4)}...${plaintext.slice(-4)}`;
    },
    scope: "tenant",
  });

  const configKeys = r.config({
    keys: {
      bucket: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      region: createTenantConfig("text", {
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
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
    },
  });

  // Plugin-Registration. entityName "s3" ist was tenants in
  // file-foundation's `provider` config-key setzen.
  const plugin: FileProviderPlugin = {
    build: async (ctx: HandlerContext, tenantId: string) => buildS3Provider(ctx, tenantId),
  };
  r.useExtension("fileProvider", "s3", plugin);

  return { configKeys, secretAccessKey };
});

/** Typed handle for the S3 secret-access-key. */
export const S3_SECRET_ACCESS_KEY = fileProviderS3Feature.exports.secretAccessKey;

// =============================================================================
// Internal: build the FileStorageProvider from tenant config + secret
// =============================================================================

async function buildS3Provider(
  ctx: HandlerContext,
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
    await ctxConfig(fileProviderS3Feature.exports.configKeys.bucket),
    FEATURE_NAME,
    "bucket",
    FILE_HINT,
  );
  const region = requireNonEmpty(
    await ctxConfig(fileProviderS3Feature.exports.configKeys.region),
    FEATURE_NAME,
    "region",
    FILE_HINT,
  );
  const endpointRaw = requireDefined(
    await ctxConfig(fileProviderS3Feature.exports.configKeys.endpoint),
    FEATURE_NAME,
    "endpoint",
  ) as string;
  const endpoint = endpointRaw.length > 0 ? endpointRaw : undefined;
  const forcePathStyle = requireDefined(
    await ctxConfig(fileProviderS3Feature.exports.configKeys.forcePathStyle),
    FEATURE_NAME,
    "forcePathStyle",
  ) as boolean;
  const accessKeyId = requireNonEmpty(
    await ctxConfig(fileProviderS3Feature.exports.configKeys.accessKeyId),
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

async function readSecretAccessKey(ctx: HandlerContext, tenantId: string): Promise<string> {
  const secrets = requireSecretsContext(ctx, FEATURE_NAME);
  const branded = await secrets.get(tenantId, S3_SECRET_ACCESS_KEY);
  if (!branded) {
    throw new Error(
      `${FEATURE_NAME}: ${S3_SECRET_ACCESS_KEY.name} not set for tenant ${tenantId} — Tenant-Admin must set it via /api/write/secrets:write:set`,
    );
  }
  return branded.reveal();
}
