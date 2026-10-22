// Public API of the file-foundation bundled-feature.

export {
  createFileFoundationFeature,
  createFileProviderForTenant,
  type FileProviderContext,
  type FileProviderPlugin,
  isFileProviderPlugin,
} from "./feature.ts";
export {
  type FileRefContent,
  FileRefTooLargeError,
  FileStorageUnavailableError,
  fileContextForTenant,
  fileContextFromResolver,
  readFileRefContent,
} from "./read-file-ref-content.ts";
