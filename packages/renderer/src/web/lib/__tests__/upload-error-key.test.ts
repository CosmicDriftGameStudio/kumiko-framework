import { describe, expect, test } from "bun:test";
import { FileCountLimitError, uploadErrorKey } from "../upload-error-key.ts";
import { FileUploadFailedError } from "../upload-file-ref.ts";

const fromServer = (message: string) => new FileUploadFailedError(message, true);

describe("uploadErrorKey", () => {
  test("maps the server's error code, never its English text", () => {
    expect(uploadErrorKey(fromServer("file_too_large: 12 MB exceeds 10 MB"))).toBe(
      "kumiko.widget.upload.too-large",
    );
    expect(uploadErrorKey(fromServer("request_too_large: request body exceeds"))).toBe(
      "kumiko.widget.upload.too-large",
    );
    for (const code of ["invalid_file_type", "mime_mismatch", "content_mismatch"]) {
      expect(uploadErrorKey(fromServer(`${code}: whatever`))).toBe(
        "kumiko.widget.upload.invalid-type",
      );
    }
  });

  test("an unknown server code, a network failure and a status-only failure get the generic key", () => {
    expect(uploadErrorKey(fromServer("forbidden: no access to this form"))).toBe(
      "kumiko.widget.upload.error",
    );
    expect(uploadErrorKey(new TypeError("Failed to fetch"))).toBe("kumiko.widget.upload.error");
    expect(uploadErrorKey(new FileUploadFailedError("upload failed (500)", false))).toBe(
      "kumiko.widget.upload.error",
    );
  });

  test("a refused extra file maps to the max-count key", () => {
    expect(uploadErrorKey(new FileCountLimitError())).toBe("kumiko.widget.upload.max-count");
  });
});
