import { existsSync } from "node:fs";
import type { KmsMode, LowLevelKmsFields } from "./kms-mode.ts";

export const DEFAULT_PROD_STATIC_DIR = "./dist";

type KmsModeFields = LowLevelKmsFields & { readonly kmsMode?: KmsMode };

/** With NODE_ENV=production and neither kmsMode nor a low-level KMS field set: "optional". */
export function prodKmsModeDefault(
  options: KmsModeFields,
  envSource: Record<string, string | undefined>,
): KmsMode | undefined {
  if (envSource["NODE_ENV"] !== "production") return options.kmsMode;
  if (
    options.kmsMode !== undefined ||
    options.kms !== undefined ||
    options.blindIndexKey !== undefined ||
    options.allowPlaintextPii !== undefined
  ) {
    return options.kmsMode;
  }
  // "required" would abort apps without PII on an empty KMS env; the PII boot gate still aborts PII carriers without a KMS.
  return "optional";
}

/** With NODE_ENV=production and no staticDir: "./dist" when that folder exists. */
export function prodStaticDirDefault(
  staticDir: string | undefined,
  envSource: Record<string, string | undefined>,
  dirExists: (path: string) => boolean = existsSync,
): string | undefined {
  if (staticDir !== undefined) return staticDir;
  if (envSource["NODE_ENV"] !== "production") return undefined;
  return dirExists(DEFAULT_PROD_STATIC_DIR) ? DEFAULT_PROD_STATIC_DIR : undefined;
}
