// Public API of the file-foundation bundled-feature.

export {
  createFileProviderForTenant,
  type FileProviderContext,
  type FileProviderPlugin,
  fileFoundationFeature,
  isFileProviderPlugin,
} from "./feature.js";
export {
  type FileRefContent,
  FileRefTooLargeError,
  fileContextForTenant,
  fileContextFromResolver,
  readFileRefContent,
} from "./read-file-ref-content.js";
