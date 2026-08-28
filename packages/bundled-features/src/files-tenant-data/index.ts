// GDPR tenant-destroy + orphaned-derivative backfill coverage for the `files`
// feature's `fileRef` entity (#2474). Kept apart from `files` — like
// folders-user-data does for EXT_USER_DATA — so file consumers without the
// tenant-lifecycle pipeline don't pull a hard dependency; `files` stays usable
// standalone (e.g. user-data-rights-demo mounts `files` + user-data-rights
// without tenant-lifecycle).
//
// tenant-lifecycle is the hard dependency (EXT_TENANT_DATA + EXT_STORAGE_PROVIDER
// host). `files` is OPTIONAL: if it's mounted toggleable (default=false), a hard
// r.requires would throw an "effectively disabled" boot warning even though the
// fileRef entity exists and the hooks work fine — same reasoning as
// folders-user-data's optionalRequires("folders").

import {
  defineFeature,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  sweepOrphanedDerivativesJob,
  sweepOrphanedDerivativesPayloadSchema,
} from "./handlers/sweep-orphaned-derivatives.job";
import { fileRefStorageDestroyHook, fileRefTenantDestroyHook } from "./hooks";

export function createFilesTenantDataFeature(): FeatureDefinition {
  return defineFeature("files-tenant-data", (r) => {
    r.describe(
      "GDPR coverage for the `files` feature's `fileRef` entity: tenant-destroy row purge (EXT_TENANT_DATA) and full storage-prefix binary wipe (EXT_STORAGE_PROVIDER), plus a manual backfill/GC job that sweeps derivatives orphaned by a forget/tenant-destroy that ran before #2461 wired binary cleanup into those flows. Requires `tenant-lifecycle`, optionalRequires `files`.",
    );
    r.uiHints({
      displayLabel: "Files · Tenant-Destroy & Derivative GC",
      category: "compliance",
      recommended: false,
    });
    r.requires("tenant-lifecycle");
    r.optionalRequires("files");

    r.useExtension(EXT_TENANT_DATA, "fileRef", { destroy: fileRefTenantDestroyHook });
    r.useExtension(EXT_STORAGE_PROVIDER, "fileRef", { destroyTenant: fileRefStorageDestroyHook });

    r.job(
      "sweep-orphaned-derivatives",
      {
        trigger: { manual: true },
        concurrency: "skip",
        schema: sweepOrphanedDerivativesPayloadSchema,
      },
      sweepOrphanedDerivativesJob,
    );
  });
}

export {
  sweepOrphanedDerivativesJob,
  sweepOrphanedDerivativesPayloadSchema,
} from "./handlers/sweep-orphaned-derivatives.job";
export { fileRefStorageDestroyHook, fileRefTenantDestroyHook } from "./hooks";
