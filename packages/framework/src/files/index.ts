export { createFilesFeature } from "./feature";
export type { FileContext, FileHandle } from "./file-handle";
// `createFileHandle` is an implementation detail — construct handles via
// `createFileContext(provider).ref(key)`, which is the AppContext surface.
export { createFileContext, deriveKey } from "./file-handle";
export { fileRefEntity } from "./file-ref-entity";
export { fileRefsTable } from "./file-ref-table";
export type {
  FileAccessDecision,
  FileAccessGuard,
  FileRef,
  FileRoutesOptions,
} from "./file-routes";
export { createFileRoutes } from "./file-routes";
export type { InMemoryFileProvider } from "./in-memory-provider";
export { createInMemoryFileProvider } from "./in-memory-provider";
export { createLocalProvider } from "./local-provider";
export type {
  FileProviderContext,
  FileProviderPlugin,
  FileProviderResolver,
  FileProviderResolverDeps,
} from "./provider-resolver";
export {
  createFileProviderForTenant,
  isFileProviderPlugin,
  makeFileProviderResolver,
} from "./provider-resolver";
export { filesStorageTrackingFeature, tenantStorageUsageTable } from "./storage-tracking";
export type {
  FileMetadata,
  FileStorageProvider,
  FileValidationOptions,
  SignedUrlOptions,
  WriteStreamOptions,
} from "./types";
export { buildStorageKey, parseMaxSize, validateFile } from "./types";
export type { ZipEntry } from "./zip-stream";
export { createZipStream } from "./zip-stream";
