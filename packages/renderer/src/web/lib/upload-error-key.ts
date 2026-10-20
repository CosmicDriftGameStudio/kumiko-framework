import { FileUploadFailedError } from "./upload-file-ref.ts";

/** A dropzone refused a file because the field already holds `maxCount` files. */
export class FileCountLimitError extends Error {}

const SERVER_CODE_KEYS: Readonly<Record<string, string>> = {
  file_too_large: "kumiko.widget.upload.too-large",
  request_too_large: "kumiko.widget.upload.too-large",
  invalid_file_type: "kumiko.widget.upload.invalid-type",
  mime_mismatch: "kumiko.widget.upload.invalid-type",
  content_mismatch: "kumiko.widget.upload.invalid-type",
};

/** i18n key for a failed upload. The server's error string starts with a stable code before
 *  the first ":"; the text after it is English and never shown, an unknown code gets the
 *  generic key. */
export function uploadErrorKey(cause: unknown): string {
  if (cause instanceof FileCountLimitError) return "kumiko.widget.upload.max-count";
  if (cause instanceof FileUploadFailedError && cause.fromServer) {
    const code = cause.message.split(":")[0]?.trim() ?? "";
    return SERVER_CODE_KEYS[code] ?? "kumiko.widget.upload.error";
  }
  return "kumiko.widget.upload.error";
}
