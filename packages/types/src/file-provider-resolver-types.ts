import type { FileStorageProvider } from "./file-storage-provider-types.ts";
import type { TenantId } from "./identifiers.ts";

// Bookkeeping for upload bytes that have no fileRef row yet. `record` must be durable at once
// (not part of any handler transaction), so bytes whose commit never happens can be found again.
export type FileUploadLedger = {
  record(storageKey: string): Promise<void>;
  forget(storageKey: string): Promise<void>;
};

// A bound, per-tenant provider resolver. One instance serves all tenants
// (tenantId is the call argument) — the single spine shared by upload routes,
// ctx.files and the GDPR jobs.
export type FileProviderResolver = ((tenantId: TenantId) => Promise<FileStorageProvider>) & {
  // Absent on a resolver without database access; the upload paths then fail instead of
  // writing bytes nothing could ever sweep.
  readonly uploadLedgerFor?: (tenantId: TenantId) => FileUploadLedger;
};
