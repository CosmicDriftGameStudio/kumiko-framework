// kumiko-feature-version: 1
//
// file-foundation as a Kumiko bundled feature.
//
// **What this file gives you:**
//   1. **Tenant-scoped config** — provider, bucket, region, endpoint,
//      forcePathStyle, accessKeyId. Tenant-Admin can set these in the
//      Designer; downstream handlers read via ctx.config.
//   2. **Tenant-scoped secret** — the S3 secret access key. BYOK is the
//      default model: each tenant's file storage runs in their own S3
//      account (Hetzner Object Storage, AWS S3, R2, MinIO, DigitalOcean
//      Spaces — anything S3-compatible). Cost + retention + compliance
//      stay with the tenant.
//   3. **createFileProviderForTenant(ctx, tenantId)** — bridges the
//      registry-config + secret into a ready-to-use `FileStorageProvider`
//      compatible with the framework's files-API.
//
// **Pattern-Vorbild:** mirrors `ai-foundation` and `mail-foundation` —
// public-config (host/region/bucket sichtbar) vs encrypted-secret
// (secretAccessKey).
//
// **Provider-agnostisch heute = nur S3-compat.** S3-API is the lingua
// franca: AWS S3, Cloudflare R2, Hetzner Object Storage, MinIO, Spaces
// all speak it. Native Azure Blob / GCS would land via the same provider-
// switch in `createFileProviderForTenant`.
//
// **Standalone:** Feature ist NICHT von tier-engine abhängig. Existing
// `files-provider-s3` bleibt unangetastet als App-wide-Library; wer per-
// tenant-config will mountet `file-foundation`.
//
// **Boot-Dependencies:** config + secrets, analog ai-foundation /
// mail-foundation.

import { createS3Provider } from "@kumiko/bundled-features/files-provider-s3";
import { requireDefined, requireNonEmpty } from "@kumiko/bundled-features/foundation-shared";
import { requireSecretsContext } from "@kumiko/bundled-features/secrets";
import {
  access,
  createTenantConfig,
  defineFeature,
  type HandlerContext,
} from "@kumiko/framework/engine";
import type { FileStorageProvider } from "@kumiko/framework/files";

const FEATURE_NAME = "file-foundation";

// =============================================================================
// Feature-definition
// =============================================================================

export const fileFoundationFeature = defineFeature("file-foundation", (r) => {
  r.requires("config");
  r.requires("secrets");

  const secretAccessKey = r.secret("s3.secretAccessKey", {
    label: { de: "S3 Secret Access Key", en: "S3 Secret Access Key" },
    hint: {
      de: "Privater Teil des S3-Schlüsselpaares. Bei Hetzner Object Storage 'Secret Key', bei AWS S3 'Secret Access Key'.",
      en: "Private half of the S3 key pair. Hetzner calls it 'Secret Key', AWS calls it 'Secret Access Key'.",
    },
    // S3 secret keys are typically 40 chars (AWS) or similar opaque
    // strings — generic short-prefix redaction.
    redact: (plaintext) => {
      if (plaintext.length < 8) return "•".repeat(plaintext.length);
      return `${plaintext.slice(0, 4)}...${plaintext.slice(-4)}`;
    },
    scope: "tenant",
  });

  const configKeys = r.config({
    keys: {
      // Provider-selector. Sprint 2 = "s3" only (covers all S3-compat
      // backends — AWS, R2, Hetzner, MinIO, Spaces). Native Azure Blob /
      // GCS would land via the same FileStorageProvider interface.
      provider: createTenantConfig("select", {
        default: "s3",
        options: ["s3"],
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin", "User"),
      }),
      // Bucket name.
      bucket: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      // Region. AWS uses "eu-central-1" / "us-east-1" / etc. Hetzner
      // Object Storage uses "fsn1" / "nbg1" / "hel1". R2 uses "auto".
      region: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      // Custom endpoint URL — required for non-AWS providers. AWS S3 leaves
      // this empty (default endpoint inferred from region).
      endpoint: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      // forcePathStyle: true = path-style URLs (endpoint/bucket/key —
      // required for MinIO + most non-AWS), false = virtual-host-style
      // (bucket.endpoint — AWS default). When endpoint is set we default
      // path-style; explicit override via this key.
      forcePathStyle: createTenantConfig("boolean", {
        default: false,
        write: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      // Access-key id (public part of the credentials pair). Sensitive
      // enough to keep behind admin-only access, but not encrypted —
      // it's the user-facing identifier in cloud-provider consoles.
      accessKeyId: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
    },
  });

  return {
    /** Config-key-handles — typed reads via `ctx.config(...)` in
     *  consumer handlers. */
    configKeys,
    /** Secret-handle for the S3 secret access key. Use with
     *  `requireSecretsContext(ctx, ...).get(tenantId, secretAccessKey)`. */
    secretAccessKey,
  };
});

// =============================================================================
// Public re-export (typed handle for the S3 secret-access-key secret)
// =============================================================================

/** Typed handle for the S3 secret-access-key. */
export const S3_SECRET_ACCESS_KEY = fileFoundationFeature.exports.secretAccessKey;

// =============================================================================
// Provider-factory — the actual reason this file exists
// =============================================================================

/**
 * Async constructor: read tenant S3 config + secret-access-key from `ctx`,
 * build a `FileStorageProvider` matching the tenant's selected provider.
 *
 * **Pattern-Vorbild:** mirrors `createProviderForTenant` from
 * `ai-foundation` and `createTransportForTenant` from `mail-foundation`.
 * Re-reads config + secret per call so config edits are immediately
 * effective. Caching the provider per-tenant would require an
 * invalidation hook; per-call construction is cheap (S3Client is just
 * object-allocation, no network).
 *
 * **Returns the `FileStorageProvider` interface** — compatible with the
 * framework's files API. A handler can hand the result straight into
 * any code that already takes a FileStorageProvider.
 *
 * **Caller pattern:**
 *   const storage = await createFileProviderForTenant(ctx, event.user.tenantId);
 *   await storage.write(key, data, mimeType);
 */
export async function createFileProviderForTenant(
  ctx: HandlerContext,
  tenantId: string,
  handlerName = "file-foundation:provider-factory",
): Promise<FileStorageProvider> {
  const ctxConfig = ctx.config;
  if (!ctxConfig) {
    throw new Error(
      "file-foundation: ctx.config is missing — feature requires the config-feature mounted in the registry",
    );
  }

  const provider = requireDefined(
    await ctxConfig(fileFoundationFeature.exports.configKeys.provider),
    FEATURE_NAME,
    "provider",
  ) as string;
  const FILE_HINT = "Set via tenant-admin UI or seed-handler before reading or writing files.";
  const bucket = requireNonEmpty(
    await ctxConfig(fileFoundationFeature.exports.configKeys.bucket),
    FEATURE_NAME,
    "bucket",
    FILE_HINT,
  );
  const region = requireNonEmpty(
    await ctxConfig(fileFoundationFeature.exports.configKeys.region),
    FEATURE_NAME,
    "region",
    FILE_HINT,
  );
  const endpointRaw = requireDefined(
    await ctxConfig(fileFoundationFeature.exports.configKeys.endpoint),
    FEATURE_NAME,
    "endpoint",
  ) as string;
  const endpoint = endpointRaw.length > 0 ? endpointRaw : undefined;
  const forcePathStyle = requireDefined(
    await ctxConfig(fileFoundationFeature.exports.configKeys.forcePathStyle),
    FEATURE_NAME,
    "forcePathStyle",
  ) as boolean;
  const accessKeyId = requireNonEmpty(
    await ctxConfig(fileFoundationFeature.exports.configKeys.accessKeyId),
    FEATURE_NAME,
    "accessKeyId",
    FILE_HINT,
  );

  const secretAccessKey = await readSecretAccessKey(ctx, tenantId, handlerName);

  switch (provider) {
    case "s3":
      return createS3Provider({
        bucket,
        region,
        accessKeyId,
        secretAccessKey,
        ...(endpoint !== undefined && { endpoint }),
        forcePathStyle,
      });
    default:
      throw new Error(`file-foundation: provider "${provider}" not implemented (only "s3" today)`);
  }
}

// =============================================================================
// Internal helpers
// =============================================================================

async function readSecretAccessKey(
  ctx: HandlerContext,
  tenantId: string,
  handlerName: string,
): Promise<string> {
  const secrets = requireSecretsContext(ctx, handlerName);
  const branded = await secrets.get(tenantId, S3_SECRET_ACCESS_KEY);
  if (!branded) {
    throw new Error(
      `file-foundation: ${S3_SECRET_ACCESS_KEY.name} not set for tenant ${tenantId} — Tenant-Admin must set it via /api/write/secrets:write:set`,
    );
  }
  return branded.reveal();
}
