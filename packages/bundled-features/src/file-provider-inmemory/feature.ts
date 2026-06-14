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

export const fileProviderInMemoryFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    'Registers an in-process `"inmemory"` provider for `file-foundation` that stores file bytes per tenant in a module-level Map. Use `listKeys(tenantId)` and `clearStorage(tenantId)` in demo apps and tests; not for production (data is lost on restart and grows without bound).',
  );
  // Kein r.requires("config") + kein r.requires("secrets") — der
  // In-Memory-Provider hat keine Config + kein Secret. Nur die
  // file-foundation muss da sein (Plugin-extension-point).
  r.requires("file-foundation");

  const plugin: FileProviderPlugin = {
    // @wrapper-known semantic-alias
    build: async (_ctx: FileProviderContext, tenantId: string): Promise<FileStorageProvider> => {
      // Returnt den per-tenant Storage. Identitätsstabil zwischen calls
      // damit accumulated state erhalten bleibt.
      return getOrCreateProviderForTenant(tenantId);
    },
  };
  r.useExtension("fileProvider", "inmemory", plugin);
});
