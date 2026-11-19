import type { KmsMode, LowLevelKmsFields } from "./kms-mode.ts";

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

/** The one KMS decision of an app for bin/main.ts and `schema apply`: with NODE_ENV=production its
 *  `kmsMode` from kumiko.config.ts, "required" when unset; otherwise undefined, so the caller wires
 *  whatever KMS env is present. */
export function productionKmsMode(
  appKmsMode: KmsMode | undefined,
  envSource: Record<string, string | undefined>,
): KmsMode | undefined {
  if (envSource["NODE_ENV"] !== "production") return undefined;
  return appKmsMode ?? "required";
}
