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

import type { FileProviderPlugin } from "@kumiko/bundled-features/file-foundation";
import { defineFeature, type HandlerContext } from "@kumiko/framework/engine";
import {
  createInMemoryFileProvider,
  type FileStorageProvider,
  type InMemoryFileProvider,
} from "@kumiko/framework/files";

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
  // Kein r.requires("config") + kein r.requires("secrets") — der
  // In-Memory-Provider hat keine Config + kein Secret. Nur die
  // file-foundation muss da sein (Plugin-extension-point).
  r.requires("file-foundation");

  const plugin: FileProviderPlugin = {
    build: async (_ctx: HandlerContext, tenantId: string): Promise<FileStorageProvider> => {
      // Returnt den per-tenant Storage. Identitätsstabil zwischen calls
      // damit accumulated state erhalten bleibt.
      return getOrCreateProviderForTenant(tenantId);
    },
  };
  r.useExtension("fileProvider", "inmemory", plugin);
});
