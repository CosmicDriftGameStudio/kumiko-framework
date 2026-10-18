export type {
  CreatedFileRef,
  CreateFileRefContext,
  CreateFileRefInput,
  UploadedFileBytes,
  UploadFileBytesContext,
} from "./create-file-ref-from-bytes.ts";
export {
  createFileRefFromBytes,
  createFileRefFromUploadedBytes,
  uploadFileBytesBeforeTransaction,
} from "./create-file-ref-from-bytes.ts";
export { createFilesFeature, FILES_FEATURE } from "./feature.ts";
export type { FileContext, FileHandle } from "./file-handle.ts";
// `createFileHandle` is an implementation detail — construct handles via
// `createFileContext(provider).ref(key)`, which is the AppContext surface.
export { createFileContext, deriveKey, storageKeyStemPrefix } from "./file-handle.ts";
export { fileRefEntity } from "./file-ref-entity.ts";
export { fileRefsTable } from "./file-ref-table.ts";
export type {
  FileAccessDecision,
  FileAccessGuard,
  FileRef,
  FileRoutesOptions,
} from "./file-routes.ts";
export {
  createFileRoutes,
  readFilesRouteOptions,
  resolveMaxUploadBodyBytes,
} from "./file-routes.ts";
export type { InMemoryFileProvider } from "./in-memory-provider.ts";
export { createInMemoryFileProvider } from "./in-memory-provider.ts";
export { createLocalProvider } from "./local-provider.ts";
export type {
  FileProviderContext,
  FileProviderPlugin,
  FileProviderResolver,
  FileProviderResolverDeps,
} from "./provider-resolver.ts";
export {
  createFileProviderForTenant,
  isFileProviderPlugin,
  makeFileProviderResolver,
} from "./provider-resolver.ts";
export { resolveContentType } from "./resolve-content-type.ts";
export {
  fileRefStorageDelta,
  filesStorageTrackingFeature,
  tenantStorageUsageTable,
  transferTenantStorageUsage,
} from "./storage-tracking.ts";
export type {
  FileContentValidationResult,
  FileMetadata,
  FileStorageProvider,
  FileValidationOptions,
  SignedUrlOptions,
  UploadMimeTypeResolution,
  WriteStreamOptions,
} from "./types.ts";
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
} from "./types.ts";
export type { ZipEntry } from "./zip-stream.ts";
export { createZipStream } from "./zip-stream.ts";
