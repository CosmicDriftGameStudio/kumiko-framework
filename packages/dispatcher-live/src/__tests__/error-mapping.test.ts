import { describe, expect, test } from "bun:test";
import { buildAbortError, buildNetworkError, mapServerError } from "../error-mapping";

describe("mapServerError", () => {
  test("maps a minimal error envelope 1:1", () => {
    const mapped = mapServerError({
      code: "not_found",
      httpStatus: 404,
      i18nKey: "errors.notFound",
      message: "entity foo not found",
    });

    expect(mapped).toEqual({
      code: "not_found",
      httpStatus: 404,
      i18nKey: "errors.notFound",
      message: "entity foo not found",
    });
  });

  test("preserves i18nParams and requestId when present", () => {
    const mapped = mapServerError({
      code: "not_found",
      httpStatus: 404,
      i18nKey: "errors.notFound",
      message: "not found",
      i18nParams: { entity: "order", id: "42" },
      requestId: "req-abc",
      timestamp: "2026-04-22T10:00:00Z", // intentionally dropped
    });

    expect(mapped.i18nParams).toEqual({ entity: "order", id: "42" });
    expect(mapped.requestId).toBe("req-abc");
    expect("timestamp" in mapped).toBe(false);
  });

  test("maps validation-error with fields array, preserving path/code/i18nKey/params", () => {
    const mapped = mapServerError({
      code: "validation_error",
      httpStatus: 400,
      i18nKey: "errors.validation.failed",
      message: "Validation failed",
      details: {
        fields: [
          {
            path: "title",
            code: "too_small",
            i18nKey: "errors.validation.too_small",
            params: { minimum: 3 },
          },
          {
            path: "tasks.0.title",
            code: "invalid_type",
            i18nKey: "errors.validation.invalid_type",
          },
        ],
      },
    });

    const fields = mapped.details?.fields;
    expect(fields).toHaveLength(2);
    expect(fields?.[0]).toEqual({
      path: "title",
      code: "too_small",
      i18nKey: "errors.validation.too_small",
      params: { minimum: 3 },
    });
    expect(fields?.[1]).toEqual({
      path: "tasks.0.title",
      code: "invalid_type",
      i18nKey: "errors.validation.invalid_type",
    });
  });

  test("skips malformed field entries — stricter than the server, by design", () => {
    // A defensive parse: if a future server emits an extra intermediate
    // wrapper or garbled JSON, we drop the malformed entry instead of
    // rendering undefined fields in the UI. Der Code warnt bei jedem
    // Drop (ops-visible Contract-Bruch) — im Test stummschalten UND
    // gleichzeitig prüfen: jeder der drei Malformed-Inputs muss genau
    // einen warn() ausgelöst haben. Das macht das "silence" im Test-
    // Output zur Assertion, nicht zu einem Sweep-under-the-rug.
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const mapped = mapServerError({
        code: "validation_error",
        httpStatus: 400,
        i18nKey: "errors.validation.failed",
        message: "x",
        details: {
          fields: [
            { path: "ok", code: "bad", i18nKey: "k" },
            { path: "missing-code" }, // malformed
            null,
            "not-even-an-object",
          ],
        },
      });

      expect(mapped.details?.fields).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledTimes(3);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("passes through non-validation details unchanged", () => {
    // Rate-limit, version-conflict etc. carry their own structured
    // payload under details — we don't know the shape, don't transform.
    const mapped = mapServerError({
      code: "version_conflict",
      httpStatus: 409,
      i18nKey: "errors.versionConflict",
      message: "stale write",
      details: { expected: 5, actual: 7 },
    });

    expect(mapped.details).toEqual({ expected: 5, actual: 7 });
  });

  test("omits details entirely when server sent none", () => {
    const mapped = mapServerError({
      code: "internal",
      httpStatus: 500,
      i18nKey: "errors.internal",
      message: "boom",
    });
    expect("details" in mapped).toBe(false);
  });
});

describe("buildNetworkError", () => {
  test("code + httpStatus=0 signal 'never reached server'", () => {
    const err = buildNetworkError(new Error("ECONNREFUSED"));
    expect(err.code).toBe("network_error");
    expect(err.httpStatus).toBe(0);
    expect(err.message).toBe("ECONNREFUSED");
  });

  test("handles non-Error causes gracefully", () => {
    const err = buildNetworkError("string reason");
    expect(err.message).toBe("string reason");

    const fromNull = buildNetworkError(null);
    expect(fromNull.message).toBe("network error"); // fallback
  });
});

describe("buildAbortError", () => {
  test("distinct code 'aborted' for user-triggered cancel", () => {
    const err = buildAbortError();
    expect(err.code).toBe("aborted");
    expect(err.httpStatus).toBe(0);
  });
});
