import { KumikoError } from "@cosmicdrift/kumiko-framework/errors";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";

export const FILE_STORAGE_WRITE_FAILED_CODE = "file_storage_write_failed";

// Own code on purpose: the supervisor treats validation/unprocessable as a poison mail and
// quarantines it, but a storage outage says nothing about the mail.
export class FileStorageWriteFailedError extends KumikoError {
  readonly code = FILE_STORAGE_WRITE_FAILED_CODE;
  readonly httpStatus = 503;

  constructor(cause?: Error) {
    super({
      message: "inbound mail content could not be written to file storage",
      i18nKey: "errors.internal",
      ...(cause && { cause }),
    });
  }
}

export function isFileStorageWriteFailure(error: unknown): boolean {
  return errorCodeOf(error) === FILE_STORAGE_WRITE_FAILED_CODE;
}
