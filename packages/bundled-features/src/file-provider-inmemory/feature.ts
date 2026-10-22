// kumiko-feature-version: 1
//
// file-provider-inmemory — In-memory file provider for the file-
// foundation plugin API. Stores files in a per-tenant Map instead
// of S3/Hetzner object storage. Intended for demos, sample apps,
// and tests without a MinIO container.
//
// **What this feature provides:**
//   1. Plugin registration via `r.useExtension("fileProvider",
//      "inmemory", { build })`.
//   2. **Per-tenant storage.** Each tenant gets its own
//      InMemoryFileProvider, providing tenant isolation by design
//      without requiring a path convention.
//
// **Pattern reference:** mirrors file-provider-s3.
//
// **NOT for production.** The buffer is process memory, is lost on
// restart, and grows monotonically with every write.

import type {
  FileProviderContext,
  FileProviderPlugin,
} from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";

const FEATURE_NAME = "file-provider-inmemory";

// =============================================================================
// Per-tenant in-memory store
// =============================================================================

const providersByTenant = new Map<string, InMemoryFileProvider>();

function getOrCreateProviderForTenant(tenantId: string): InMemoryFileProvider {
  let provider = providersByTenant.get(tenantId);
  if (!provider) {
    provider = createInMemoryFileProvider();
    providersByTenant.set(tenantId, provider);
  }
  return provider;
}

/** Demo/Test-Helper: liste die Keys eines Tenant-Storage. */
export function listKeys(tenantId: string): readonly string[] {
  return providersByTenant.get(tenantId)?.keys() ?? [];
}

/** Demo/test helper: clears a tenant's storage. */
export function clearStorage(tenantId: string): void {
  providersByTenant.get(tenantId)?.clear();
}

// =============================================================================
// Feature-definition
// =============================================================================
export function createFileProviderInMemoryFeature() {
  return defineFeature(
    FEATURE_NAME,
    (r) => {
      r.describe(
        'Registers an in-process `"inmemory"` provider for `file-foundation` that stores file bytes per tenant in a module-level Map. Use `listKeys(tenantId)` and `clearStorage(tenantId)` in demo apps and tests; not for production (data is lost on restart and grows without bound).',
      );
      r.uiHints({
        displayLabel: "File Provider · In-Memory",
        category: "storage",
        recommended: false,
      });
      // No requirement for "config" or "secrets": the
      // in-memory provider has neither configuration nor secrets. Only
      // file-foundation must be present as the plugin extension point.
      r.requires({ features: ["file-foundation"] });

      const plugin: FileProviderPlugin = {
        build: async (
          _ctx: FileProviderContext,
          tenantId: string,
        ): Promise<FileStorageProvider> => {
          // Returns the per-tenant storage. Identity-stable across calls so
          // accumulated state is kept.
          return getOrCreateProviderForTenant(tenantId);
        }, // @wrapper-known semantic-alias
      };
      r.useExtension("fileProvider", "inmemory", plugin);
    },
    { dedupeOptions: {} },
  );
}
