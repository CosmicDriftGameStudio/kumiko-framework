// Public API of the file-foundation bundled-feature.

export {
  createFileFoundationFeature,
  createFileProviderForTenant,
  type FileProviderContext,
  type FileProviderPlugin,
  isFileProviderPlugin,
} from "./feature.ts";
export {
  discardGeneratedFile,
  type GeneratedFileContext,
  MAX_DOCUMENT_BYTES,
  readTenantFile,
  storeGeneratedFile,
} from "./generated-files.ts";
export {
  type FileRefContent,
  FileRefTooLargeError,
  FileStorageUnavailableError,
  fileContextForTenant,
  fileContextFromResolver,
  readFileRefContent,
} from "./read-file-ref-content.ts";
export {
  makeTenantStorageProviderResolver,
  type TenantStorageResolverCtx,
} from "./storage-provider-resolver.ts";
