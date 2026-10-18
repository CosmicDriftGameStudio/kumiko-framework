import { smtpEnvSchema } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { kmsEnvSchema } from "@cosmicdrift/kumiko-bundled-features/crypto-shredding/env";
import { s3EnvSchema } from "@cosmicdrift/kumiko-bundled-features/file-provider-s3";
import { demoAdminEnvSchema } from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import { subscriptionStripeEnvSchema } from "@cosmicdrift/kumiko-bundled-features/subscription-stripe";
import { type ComposedEnvSchema, readKumikoMeta } from "@cosmicdrift/kumiko-framework/env";
import * as z from "zod";
import { type BootOptionFields, isSeedFnList } from "./resolve-boot-options.js";
import type { ProdSeedsConfig } from "./seed-shortcuts.js";

type OptionEnvBlock = {
  readonly source: string;
  readonly shape: Readonly<Record<string, z.ZodType>>;
  /** Keys the option cannot run without, although the shared block marks
   *  them optional for apps that mount the feature differently. */
  readonly required: readonly string[];
};

const S3_REQUIRED_KEYS = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;

// `.unwrap()` drops what sits on the optional wrapper: the description and the
// kumiko meta (pulumi secret, kms), both of which the dry run reports.
function requiredField(field: z.core.$ZodType): z.core.$ZodType {
  if (!(field instanceof z.ZodOptional)) return field;
  const inner = field.unwrap();
  if (!(inner instanceof z.ZodType)) return field;
  const described = field.description ? inner.describe(field.description) : inner;
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

function seedEnvBlock(seeds: ProdSeedsConfig): OptionEnvBlock | undefined {
  const keys: string[] = [];
  const required: string[] = [];
  if (seeds.demoTenant && seeds.demoTenant.id === undefined) {
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

function collectOptionEnvBlocks(options: BootOptionFields): OptionEnvBlock[] {
  const blocks: OptionEnvBlock[] = [];
  if (options.mail?.transport === "smtp-env") {
    blocks.push({ source: "runProdApp.mail", shape: smtpEnvSchema.shape, required: ["SMTP_HOST"] });
  }
  const { fileStorage } = options;
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
      required: fileStorage.provider === "s3-env" ? S3_REQUIRED_KEYS : [],
    });
  }
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
        additions[key] = requiredField(existing ?? field);
        sources[key] ??= block.source;
      } else if (existing === undefined) {
        additions[key] = field;
        sources[key] = block.source;
      }
    }
  }
  return { schema: composed.schema.safeExtend(additions), sources };
}
