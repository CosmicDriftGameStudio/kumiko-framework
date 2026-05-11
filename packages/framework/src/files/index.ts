export type { FileContext, FileHandle } from "./file-handle";
// `createFileHandle` is an implementation detail — construct handles via
// `createFileContext(provider).ref(key)`, which is the AppContext surface.
export { createFileContext, deriveKey } from "./file-handle";
export { fileRefsTable } from "./file-ref-table";
export type {
  FileAccessDecision,
  FileAccessGuard,
  FileRef,
  FileRoutesOptions,
  FileUploadedPayload,
} from "./file-routes";
export {
  createFileRoutes,
  FILE_UPLOADED_EVENT_TYPE,
  fileUploadedEvent,
  fileUploadedPayloadSchema,
} from "./file-routes";
export type { InMemoryFileProvider } from "./in-memory-provider";
export { createInMemoryFileProvider } from "./in-memory-provider";
export { createLocalProvider } from "./local-provider";
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
