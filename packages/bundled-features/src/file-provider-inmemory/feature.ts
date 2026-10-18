// kumiko-feature-version: 1
//
// file-provider-inmemory — In-Memory-FileProvider für die file-
// foundation Plugin-API. Speichert Files in einem per-Tenant-Map
// statt in S3/Hetzner-Object-Storage. Für Demos, Sample-Apps und
// Tests ohne MinIO-Container.
//
// **Was diese Feature liefert:**
//   1. Plugin-Registration via `r.useExtension("fileProvider",
//      "inmemory", { build })`.
//   2. **Pro-Tenant Storage.** Jeder Tenant kriegt einen eigenen
//      InMemoryFileProvider — Tenant-Isolation by-design, keine
//      Pfad-Konvention nötig.
//
// **Pattern-Vorbild:** mirrors file-provider-s3.
//
// **NICHT für Production.** Buffer ist Process-Memory, geht beim
// Restart verloren + wächst monoton mit jedem write.

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

/** Demo/Test-Helper: leere den Tenant-Storage. */
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
      // Kein requires auf "config" oder "secrets" — der
      // In-Memory-Provider hat keine Config + kein Secret. Nur die
      // file-foundation muss da sein (Plugin-extension-point).
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
