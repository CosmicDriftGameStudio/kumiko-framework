import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  AccessDeniedError,
  buildErrorLog,
  ConflictError,
  InternalError,
  isKumikoError,
  KumikoError,
  NotFoundError,
  serializeError,
  UnprocessableError,
  ValidationError,
  VersionConflictError,
  validationErrorFromZod,
} from "../index";

describe("KumikoError: abstract base", () => {
  test("sets i18nKey, details, name from subclass, and preserves cause chain", () => {
    const inner = new Error("db_offline");
    const err = new NotFoundError("order", 42, { cause: inner });

    expect(err.name).toBe("NotFoundError");
    expect(err.i18nKey).toBe("errors.notFound");
    expect(err.cause).toBe(inner);
    expect(isKumikoError(err)).toBe(true);
    expect(isKumikoError(inner)).toBe(false);
  });
});

describe("ValidationError", () => {
  test("holds field list with path, code, i18nKey", () => {
    const err = new ValidationError({
      fields: [{ path: "email", code: "invalid_type", i18nKey: "errors.validation.invalid_type" }],
    });
    expect(err.code).toBe("validation_error");
    expect(err.httpStatus).toBe(400);
    expect(err.details).toMatchObject({
      fields: [{ path: "email", code: "invalid_type" }],
    });
  });

  test("validationErrorFromZod maps issues to details.fields with params", () => {
    const schema = z.object({ name: z.string().min(3), age: z.number().int() });
    const result = schema.safeParse({ name: "x", age: "oops" });
    if (result.success) throw new Error("zod did not reject");

    const err = validationErrorFromZod(result.error);
    expect(err).toBeInstanceOf(ValidationError);

    const fields = (err.details as { fields: Array<Record<string, unknown>> }).fields;
    expect(fields).toHaveLength(2);

    const nameIssue = fields.find((f) => f["path"] === "name");
    expect(nameIssue).toMatchObject({
      code: "too_small",
      i18nKey: "errors.validation.too_small",
    });
    expect(nameIssue?.["params"]).toMatchObject({ minimum: 3 });

    const ageIssue = fields.find((f) => f["path"] === "age");
    expect(ageIssue).toMatchObject({
      code: "invalid_type",
      i18nKey: "errors.validation.invalid_type",
    });
    expect(err.cause).toBe(result.error);
  });

  test('root-level zod issue maps to path "(root)"', () => {
    const schema = z.string();
    const result = schema.safeParse(123);
    if (result.success) throw new Error("zod did not reject");
    const err = validationErrorFromZod(result.error);
    const fields = (err.details as { fields: Array<Record<string, unknown>> }).fields;
    expect(fields[0]?.["path"]).toBe("(root)");
  });
});

describe("AccessDeniedError", () => {
  test("defaults to code=access_denied, status 403", () => {
    const err = new AccessDeniedError();
    expect(err.code).toBe("access_denied");
    expect(err.httpStatus).toBe(403);
    expect(err.i18nKey).toBe("errors.access.denied");
  });
});

describe("NotFoundError", () => {
  test("with id: details carries reason + entity + id, message includes id", () => {
    const err = new NotFoundError("order", 42);
    expect(err.httpStatus).toBe(404);
    expect(err.details).toEqual({ reason: "order_not_found", entity: "order", id: "42" });
    expect(err.message).toBe("order 42 not found");
    expect(err.i18nParams).toMatchObject({ entity: "order", id: "42" });
  });

  test("without id: details carries reason + entity", () => {
    const err = new NotFoundError("handler");
    expect(err.details).toEqual({ reason: "handler_not_found", entity: "handler" });
    expect(err.message).toBe("handler not found");
    expect(err.i18nParams?.["id"]).toBeUndefined();
  });

  test("camelCase entity name becomes snake_case in the reason", () => {
    const err = new NotFoundError("billingPeriod", 7);
    expect((err.details as { reason: string }).reason).toBe("billing_period_not_found");
  });
});

describe("ConflictError + VersionConflictError", () => {
  test("VersionConflictError narrows code, keeps status 409, exposes version details", () => {
    const err = new VersionConflictError({
      entityId: 42,
      expectedVersion: 3,
      currentVersion: 5,
    });
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe("version_conflict");
    expect(err.httpStatus).toBe(409);
    expect(err.details).toMatchObject({ expectedVersion: 3, currentVersion: 5, entityId: 42 });
  });

  test("generic ConflictError accepts custom details", () => {
    const err = new ConflictError({
      i18nKey: "errors.deleteRestricted",
      details: { reason: "delete_restricted", blockingEntity: "order_item" },
    });
    expect(err.code).toBe("conflict");
    expect(err.httpStatus).toBe(409);
    expect(err.details).toMatchObject({ reason: "delete_restricted" });
  });
});

describe("UnprocessableError", () => {
  test("reason lands in details, code stays unprocessable", () => {
    const err = new UnprocessableError("order.already_cancelled", {
      i18nKey: "orders.errors.alreadyCancelled",
      i18nParams: { orderId: 7 },
      details: { orderId: 7 },
    });
    expect(err.code).toBe("unprocessable");
    expect(err.httpStatus).toBe(422);
    expect(err.details).toMatchObject({ reason: "order.already_cancelled", orderId: 7 });
    expect(err.i18nKey).toBe("orders.errors.alreadyCancelled");
  });
});

describe("InternalError", () => {
  test("defaults to code=internal_error, status 500, no client-facing details", () => {
    const cause = new TypeError("cannot read property 'x'");
    const err = new InternalError({ cause });
    expect(err.code).toBe("internal_error");
    expect(err.httpStatus).toBe(500);
    expect(err.i18nKey).toBe("errors.internal");
    expect(err.cause).toBe(cause);
  });
});

describe("serializeError", () => {
  test("exposes code, i18nKey, message, details, requestId, timestamp", () => {
    const err = new NotFoundError("order", 42);
    const body = serializeError(err, "req-abc");
    expect(body.error).toMatchObject({
      code: "not_found",
      i18nKey: "errors.notFound",
      message: "order 42 not found",
      details: { reason: "order_not_found", entity: "order", id: "42" },
      requestId: "req-abc",
    });
    expect(body.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("InternalError hides details from client body (secret-safety)", () => {
    const err = new InternalError({ cause: new Error("leak me if you can") });
    const body = serializeError(err, "req-xyz");
    expect(body.error.code).toBe("internal_error");
    expect(body.error).not.toHaveProperty("details");
    expect(body.error.message).toBe("internal error");
  });

  test("omits requestId field when not provided", () => {
    const body = serializeError(new AccessDeniedError());
    expect(body.error).not.toHaveProperty("requestId");
  });
});

describe("buildErrorLog", () => {
  test("includes cause chain and stack for forensics (not exposed to client)", () => {
    const inner = new Error("redis_connection_refused");
    const wrap = new InternalError({ cause: inner });
    const log = buildErrorLog(wrap);
    expect(log).toMatchObject({
      name: "InternalError",
      code: "internal_error",
      httpStatus: 500,
      cause: { name: "Error", message: "redis_connection_refused" },
    });
    expect(log.stack).toContain("InternalError");
  });

  test("non-Error causes are represented as NonError entry", () => {
    const wrap = new KumikoErrorStub({ cause: "literal-string-thrown" as unknown as Error });
    const log = buildErrorLog(wrap);
    expect(log.cause).toMatchObject({ name: "NonError", message: "literal-string-thrown" });
  });
});

// Minimal concrete KumikoError used only for the non-Error cause test above —
// avoids creating a dedicated class in production code just to cover the
// serializeCause fallback path.
class KumikoErrorStub extends KumikoError {
  readonly code = "stub";
  readonly httpStatus = 500;
  constructor(opts: { cause: Error }) {
    super({ message: "stub", i18nKey: "stub", cause: opts.cause });
  }
}
