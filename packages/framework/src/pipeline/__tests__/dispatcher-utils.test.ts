import { describe, expect, test } from "bun:test";
import { createSystemUser } from "../../engine/system-user";
import { InternalError } from "../../errors";
import {
  describeShape,
  dispatcherSpanAttributes,
  extractNestedSpecs,
  isFailedWriteResult,
  isLifecycleResult,
  isWriteResultShape,
  prefixValidationPath,
  resolveType,
  wrapToKumiko,
} from "../dispatcher-utils";

describe("isFailedWriteResult", () => {
  test("narrows failed write results", () => {
    const result = { isSuccess: false as const, error: { code: "validation_error" } };
    expect(isFailedWriteResult(result)).toBe(true);
    expect(isFailedWriteResult({ isSuccess: true, data: {} })).toBe(false);
  });
});

describe("isWriteResultShape / isLifecycleResult", () => {
  test("detects write-result envelope", () => {
    expect(isWriteResultShape({ isSuccess: true, data: 1 })).toBe(true);
    expect(isWriteResultShape({ kind: "created" })).toBe(false);
  });

  test("detects lifecycle results", () => {
    expect(isLifecycleResult({ kind: "deleted" })).toBe(true);
    expect(isLifecycleResult(null)).toBe(false);
  });
});

describe("describeShape", () => {
  test("summarizes unknown values", () => {
    expect(describeShape(null)).toBe("null");
    expect(describeShape("x")).toBe("string");
    expect(describeShape({ a: 1, b: 2 })).toContain("object with keys");
  });
});

describe("dispatcherSpanAttributes", () => {
  test("includes handler, operation, user, tenant, optional feature", () => {
    const user = createSystemUser("tenant-1");
    const attrs = dispatcherSpanAttributes("feat:query:task:list", "query", user, "feat");
    expect(attrs).toMatchObject({
      "kumiko.handler": "feat:query:task:list",
      "kumiko.operation": "query",
      "kumiko.feature": "feat",
    });
  });
});

describe("prefixValidationPath", () => {
  test("prefixes validation field paths", () => {
    const info = {
      code: "validation_error",
      httpStatus: 400,
      i18nKey: "errors.validation.failed",
      message: "Validation failed",
      details: {
        fields: [{ path: "title", code: "too_small", i18nKey: "errors.validation.too_small" }],
      },
    };
    const prefixed = prefixValidationPath(info, "tasks.0");
    const fields = (prefixed.details as { fields: { path: string }[] }).fields;
    expect(fields[0]?.path).toBe("tasks.0.title");
  });

  test("leaves non-validation errors unchanged", () => {
    const info = {
      code: "not_found",
      httpStatus: 404,
      i18nKey: "errors.notFound",
      message: "missing",
    };
    expect(prefixValidationPath(info, "x")).toBe(info);
  });
});

describe("resolveType", () => {
  test("unwraps HandlerRef objects", () => {
    expect(resolveType({ name: "feat:write:task:create" })).toBe("feat:write:task:create");
    expect(resolveType("feat:query:task:list")).toBe("feat:query:task:list");
  });
});

describe("wrapToKumiko", () => {
  test("passes through KumikoError instances", () => {
    const err = new InternalError();
    expect(wrapToKumiko(err)).toBe(err);
  });

  test("wraps generic Error as InternalError", () => {
    const wrapped = wrapToKumiko(new TypeError("boom"));
    expect(wrapped.code).toBe("internal_error");
    expect(wrapped.cause).toBeInstanceOf(TypeError);
  });
});

describe("extractNestedSpecs", () => {
  test("returns null for non-create handlers", () => {
    expect(extractNestedSpecs("feat:write:task:update", { tasks: [] }, {} as never)).toBeNull();
  });
});
