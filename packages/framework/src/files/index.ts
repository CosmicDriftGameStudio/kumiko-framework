export { createFilesFeature } from "./feature.js";
export type { FileContext, FileHandle } from "./file-handle.js";
// `createFileHandle` is an implementation detail — construct handles via
// `createFileContext(provider).ref(key)`, which is the AppContext surface.
export { createFileContext, deriveKey, storageKeyStemPrefix } from "./file-handle.js";
export { fileRefEntity } from "./file-ref-entity.js";
export { fileRefsTable } from "./file-ref-table.js";
export type {
  FileAccessDecision,
  FileAccessGuard,
  FileRef,
  FileRoutesOptions,
} from "./file-routes.js";
export {
  createFileRoutes,
  readFilesRouteOptions,
  resolveMaxUploadBodyBytes,
} from "./file-routes.js";
export type { InMemoryFileProvider } from "./in-memory-provider.js";
export { createInMemoryFileProvider } from "./in-memory-provider.js";
export { createLocalProvider } from "./local-provider.js";
export type {
  FileProviderContext,
  FileProviderPlugin,
  FileProviderResolver,
  FileProviderResolverDeps,
} from "./provider-resolver.js";
export {
  createFileProviderForTenant,
  isFileProviderPlugin,
  makeFileProviderResolver,
} from "./provider-resolver.js";
export { resolveContentType } from "./resolve-content-type.js";
export {
  fileRefStorageDelta,
  filesStorageTrackingFeature,
  tenantStorageUsageTable,
  transferTenantStorageUsage,
} from "./storage-tracking.js";
export type {
  FileContentValidationResult,
  FileMetadata,
  FileStorageProvider,
  FileValidationOptions,
  SignedUrlOptions,
  UploadMimeTypeResolution,
  WriteStreamOptions,
} from "./types.js";
export {
  assertSafeStorageKey,
  buildStorageKey,
  normalizeMimeType,
  parseMaxSize,
  resolveUploadMimeType,
  sniffMimeType,
  tenantExportPrefix,
  tenantStoragePrefixes,
  validateFile,
  validateFileContent,
} from "./types.js";
export type { ZipEntry } from "./zip-stream.js";
export { createZipStream } from "./zip-stream.js";
