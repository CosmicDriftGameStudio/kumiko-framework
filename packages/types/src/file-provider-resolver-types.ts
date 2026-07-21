import type { FileStorageProvider } from "./file-storage-provider-types";
import type { TenantId } from "./identifiers";

// A bound, per-tenant provider resolver. One instance serves all tenants
// (tenantId is the call argument) — the single spine shared by upload routes,
// ctx.files and the GDPR jobs.
export type FileProviderResolver = (tenantId: TenantId) => Promise<FileStorageProvider>;
