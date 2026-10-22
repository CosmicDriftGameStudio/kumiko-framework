import { smtpEnvSchema } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { kmsEnvSchema } from "@cosmicdrift/kumiko-bundled-features/crypto-shredding/env";
import {
  createS3EnvSchema,
  s3EnvSchema,
} from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
import { demoAdminEnvSchema } from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import { subscriptionStripeEnvSchema } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { type ComposedEnvSchema, readKumikoMeta } from "@cosmicdrift/kumiko-framework/env";
import * as z from "zod";
import { isNamedS3FileProvider, s3KeysOf } from "./file-storage-option.ts";
import { type BootOptionFields, isSeedFnList } from "./resolve-boot-options.ts";
import type { ProdSeedsConfig } from "./seed-shortcuts.ts";

type OptionEnvBlock = {
  readonly source: string;
  readonly shape: Readonly<Record<string, z.ZodType>>;
  /** Keys the option cannot run without, although the shared block marks
   *  them optional for apps that mount the feature differently. */
  readonly required: readonly string[];
  /** Replaces a field's description in this block, e.g. when the shared text contradicts the option. */
  readonly descriptions?: Readonly<Record<string, string>>;
};

const SMTP_HOST_REQUIRED_DESCRIPTION = 'SMTP host; required with mail transport "smtp-env".';

const S3_REQUIRED_KEYS = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;

// `.unwrap()` drops what sits on the optional wrapper: the description and the
// kumiko meta (pulumi secret, kms), both of which the dry run reports.
function requiredField(field: z.core.$ZodType, description?: string): z.core.$ZodType {
  if (!(field instanceof z.ZodOptional)) return field;
  const inner = field.unwrap();
  if (!(inner instanceof z.ZodType)) return field;
  const text = description ?? field.description;
  const described = text ? inner.describe(text) : inner;
  const meta = readKumikoMeta(field);
  return Object.keys(meta).length > 0 ? described.meta({ kumiko: meta }) : described;
}

function pickShape(
  shape: Readonly<Record<string, z.ZodType>>,
  keys: readonly string[],
): Record<string, z.ZodType> {
  const picked: Record<string, z.ZodType> = {};
  for (const key of keys) {
    const field = shape[key];
    if (field) picked[key] = field;
  }
  return picked;
}

function sysadminTenantNeedsEnvId(seeds: ProdSeedsConfig): boolean {
  const { sysadminFromEnv } = seeds;
  return (
    typeof sysadminFromEnv === "object" &&
    sysadminFromEnv.tenant !== undefined &&
    sysadminFromEnv.tenant.id === undefined
  );
}

function seedEnvBlock(seeds: ProdSeedsConfig): OptionEnvBlock | undefined {
  const keys: string[] = [];
  const required: string[] = [];
  const demoTenantNeedsEnvId = seeds.demoTenant !== undefined && seeds.demoTenant.id === undefined;
  if (demoTenantNeedsEnvId || sysadminTenantNeedsEnvId(seeds)) {
    keys.push("DEMO_TENANT_ID");
    required.push("DEMO_TENANT_ID");
  }
  if (seeds.demoAdminFromEnv) {
    keys.push("DEMO_ADMIN_EMAIL", "DEMO_ADMIN_PASSWORD");
    required.push("DEMO_ADMIN_EMAIL", "DEMO_ADMIN_PASSWORD");
  }
  if (seeds.sysadminFromEnv) {
    keys.push("DEMO_SYSADMIN_EMAIL", "DEMO_SYSADMIN_PASSWORD");
    required.push("DEMO_SYSADMIN_EMAIL", "DEMO_SYSADMIN_PASSWORD");
  }
  if (keys.length === 0) return undefined;
  return { source: "runProdApp.seeds", shape: pickShape(demoAdminEnvSchema.shape, keys), required };
}

function fileStorageEnvBlocks(fileStorage: BootOptionFields["fileStorage"]): OptionEnvBlock[] {
  const blocks: OptionEnvBlock[] = [];
  if (
    fileStorage &&
    (fileStorage.provider === "s3-env" ||
      fileStorage.provider === "auto" ||
      fileStorage.providers?.includes("s3-env"))
  ) {
    // auto may fall back to in-memory outside production, so its keys stay
    // optional here; resolveFileStorageOption rejects a partial set.
    blocks.push({
      source: "runProdApp.fileStorage",
      shape: s3EnvSchema.shape,
      required:
        fileStorage.provider === "s3-env" || fileStorage.providers?.includes("s3-env")
          ? S3_REQUIRED_KEYS
          : [],
    });
  }
  for (const provider of fileStorage?.providers ?? []) {
    if (!isNamedS3FileProvider(provider)) continue;
    blocks.push({
      source: `runProdApp.fileStorage.${provider.name}`,
      shape: createS3EnvSchema({ prefix: provider.envPrefix }).shape,
      required: provider.lazy ? [] : s3KeysOf(provider.envPrefix),
    });
  }
  return blocks;
}

function collectOptionEnvBlocks(options: BootOptionFields): OptionEnvBlock[] {
  const blocks: OptionEnvBlock[] = [];
  if (options.mail?.transport === "smtp-env") {
    blocks.push({
      source: "runProdApp.mail",
      shape: smtpEnvSchema.shape,
      required: ["SMTP_HOST"],
      descriptions: { SMTP_HOST: SMTP_HOST_REQUIRED_DESCRIPTION },
    });
  }
  blocks.push(...fileStorageEnvBlocks(options.fileStorage));
  // The trio stays optional even under "required": each KMS slot may arrive
  // as its *_CIPHERTEXT twin instead, which resolveKmsMode checks after decryption.
  if (options.kmsMode === "required" || options.kmsMode === "optional") {
    blocks.push({ source: "runProdApp.kmsMode", shape: kmsEnvSchema.shape, required: [] });
  }
  if (options.billing) {
    blocks.push({
      source: "runProdApp.billing",
      shape: subscriptionStripeEnvSchema.shape,
      required: [],
    });
  }
  if (options.seeds && !isSeedFnList(options.seeds)) {
    const block = seedEnvBlock(options.seeds);
    if (block) blocks.push(block);
  }
  return blocks;
}

/** Adds the env blocks the boot options read to the app's composed schema, so
 *  the dry run and the env validation cover them without the app composing
 *  them itself. A key the app already declares keeps the app's field unless
 *  the option needs it set; then the stricter, required field wins. */
export function withBootOptionEnvBlocks(
  composed: ComposedEnvSchema,
  options: BootOptionFields,
): ComposedEnvSchema {
  const blocks = collectOptionEnvBlocks(options);
  if (blocks.length === 0) return composed;
  const declared = composed.schema.shape;
  const additions: Record<string, z.core.$ZodType> = {};
  const sources: Record<string, string> = { ...composed.sources };
  for (const block of blocks) {
    const required = new Set(block.required);
    for (const [key, field] of Object.entries(block.shape)) {
      const existing = additions[key] ?? declared[key];
      if (required.has(key)) {
        additions[key] = requiredField(existing ?? field, block.descriptions?.[key]);
        sources[key] ??= block.source;
      } else if (existing === undefined) {
        additions[key] = field;
        sources[key] = block.source;
      }
    }
  }
  return { schema: composed.schema.safeExtend(additions), sources };
}
