import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { CSRF_HEADER_NAME, readCsrfToken } from "../../live/index.ts";
import { isSessionEndedError } from "../../session/session-ended.tsx";
import { buildFileUploadFormData, type FileUploadFormDataInput } from "./file-upload-form-data.ts";

export type FileRefTarget = Pick<
  FileUploadFormDataInput,
  "entityType" | "entityId" | "fieldName" | "actionForm"
>;

/** Carries the server's own `error` message when the upload endpoint sent one. */
export class FileUploadFailedError extends Error {
  constructor(
    message: string,
    readonly fromServer: boolean,
    readonly httpStatus?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function isSessionEndedUploadError(cause: unknown): boolean {
  return (
    cause instanceof FileUploadFailedError &&
    cause.code !== undefined &&
    cause.httpStatus !== undefined &&
    isSessionEndedError({ code: cause.code, httpStatus: cause.httpStatus })
  );
}

/** Posts one file to the stack's file endpoint (double-submit CSRF) and returns the new FileRef id. */
export async function uploadFileRef(file: Blob, target?: FileRefTarget): Promise<string> {
  const csrf = readCsrfToken();
  const res = await fetch("/api/files", {
    method: "POST",
    body: buildFileUploadFormData({ file, ...target }),
    ...(csrf !== undefined && { headers: { [CSRF_HEADER_NAME]: csrf } }),
  });
  const json: unknown = await res.json().catch(() => ({}));
  const id = propertyOf(json, "id");
  if (!res.ok || typeof id !== "string") {
    const message = propertyOf(json, "error");
    const code = propertyOf(json, "code");
    throw typeof message === "string"
      ? new FileUploadFailedError(
          message,
          true,
          res.status,
          typeof code === "string" ? code : undefined,
        )
      : new FileUploadFailedError(`upload failed (${res.status})`, false, res.status);
  }
  return id;
}
