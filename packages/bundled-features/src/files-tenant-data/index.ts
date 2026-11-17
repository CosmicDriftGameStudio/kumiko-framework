// Separate from `files` so file consumers without tenant-lifecycle get no hard dependency.
// `files` is only optionalRequires: a toggleable mounted `files` would otherwise raise an
// "effectively disabled" boot warning.

import {
  defineFeature,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefStorageDestroyHook, fileRefTenantDestroyHook } from "./hooks.ts";

export const FILES_TENANT_DATA_FEATURE = "files-tenant-data" as const;

export function createFilesTenantDataFeature(): FeatureDefinition {
  return defineFeature(FILES_TENANT_DATA_FEATURE, (r) => {
    r.describe(
      "GDPR coverage for the `files` feature's `fileRef` entity: tenant-destroy row purge (EXT_TENANT_DATA) and full storage-prefix binary wipe (EXT_STORAGE_PROVIDER). Requires `tenant-lifecycle`, optionalRequires `files`.",
    );
    r.uiHints({
      displayLabel: "Files · Tenant Destroy",
      category: "compliance",
      recommended: false,
    });
    r.requires({ features: ["tenant-lifecycle"] });
    r.optionalRequires({ features: ["files"] });

    r.applyExtension({ name: EXT_TENANT_DATA, entity: "fileRef", destroy: fileRefTenantDestroyHook });
    r.applyExtension({ name: EXT_STORAGE_PROVIDER, entity: "fileRef", destroyTenant: fileRefStorageDestroyHook });
  });
}

export { fileRefStorageDestroyHook, fileRefTenantDestroyHook } from "./hooks.ts";
