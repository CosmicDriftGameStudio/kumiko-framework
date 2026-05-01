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

  describe("docsUrl getter — Self-Service-Link", () => {
    test("uses details.reason when set (NotFoundError sets entity-specific reason)", () => {
      const err = new NotFoundError("order", 42);
      expect(err.docsUrl).toBe("https://docs.kumiko.so/errors/order_not_found");
    });

    test("uses details.reason when explicitly set (ConflictError-style)", () => {
      const err = new ConflictError({ details: { reason: "stale_state" } });
      expect(err.docsUrl).toBe("https://docs.kumiko.so/errors/stale_state");
    });

    test("falls back to code when details has no reason field", () => {
      const err = new ConflictError({ details: { foo: "bar" } });
      expect(err.docsUrl).toBe("https://docs.kumiko.so/errors/conflict");
    });

    test("falls back to code when details is undefined", () => {
      const err = new ConflictError();
      expect(err.docsUrl).toBe("https://docs.kumiko.so/errors/conflict");
    });

    test("respects KUMIKO_DOCS_URL env override (Self-Hosted-Kunden)", () => {
      const original = process.env["KUMIKO_DOCS_URL"];
      process.env["KUMIKO_DOCS_URL"] = "https://docs.acme.example";
      try {
        const err = new ConflictError({ details: { reason: "stale_state" } });
        expect(err.docsUrl).toBe("https://docs.acme.example/errors/stale_state");
      } finally {
        if (original === undefined) delete process.env["KUMIKO_DOCS_URL"];
        else process.env["KUMIKO_DOCS_URL"] = original;
      }
    });

    test("serializeError exposes docsUrl in the wire response", () => {
      const err = new ConflictError({ details: { reason: "stale_state" } });
      const body = serializeError(err);
      expect(body.error.docsUrl).toBe("https://docs.kumiko.so/errors/stale_state");
    });
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

  // Zod 4 restructured issue-specific params. This matrix pins down which
  // param keys survive the bridge for each issue code — if Zod ships a new
  // param name the expected block below goes stale and this test flags it.
  test("zod 4: common issue codes forward their discriminating params", () => {
    const cases: Array<{
      label: string;
      schema: z.ZodType;
      input: unknown;
      expectedCode: string;
      expectedParams: Record<string, unknown>;
    }> = [
      {
        label: "too_small on string min",
        schema: z.string().min(3),
        input: "x",
        expectedCode: "too_small",
        expectedParams: { minimum: 3 },
      },
      {
        label: "too_big on string max",
        schema: z.string().max(2),
        input: "long",
        expectedCode: "too_big",
        expectedParams: { maximum: 2 },
      },
      {
        label: "invalid_type number vs string",
        schema: z.number(),
        input: "nope",
        expectedCode: "invalid_type",
        expectedParams: { expected: "number" },
      },
      {
        label: "invalid_format email",
        schema: z.string().email(),
        input: "not-an-email",
        expectedCode: "invalid_format",
        expectedParams: { format: "email" },
      },
      {
        label: "not_multiple_of",
        schema: z.number().multipleOf(5),
        input: 7,
        expectedCode: "not_multiple_of",
        expectedParams: { divisor: 5 },
      },
      {
        label: "unrecognized_keys on strict object",
        schema: z.strictObject({ a: z.string() }),
        input: { a: "ok", b: "extra" },
        expectedCode: "unrecognized_keys",
        expectedParams: { keys: ["b"] },
      },
      {
        label: "invalid_value on enum",
        schema: z.enum(["a", "b"]),
        input: "c",
        expectedCode: "invalid_value",
        expectedParams: { values: ["a", "b"] },
      },
    ];

    const drift: string[] = [];
    for (const c of cases) {
      const result = c.schema.safeParse(c.input);
      if (result.success) {
        drift.push(`${c.label}: zod accepted the input unexpectedly`);
        continue;
      }
      const err = validationErrorFromZod(result.error);
      type FieldShape = {
        code?: string;
        params?: Record<string, unknown>;
      };
      const fields = (err.details as { fields: FieldShape[] }).fields;
      const field = fields[0];

      if (field?.code !== c.expectedCode) {
        drift.push(`${c.label}: code was "${field?.code}", expected "${c.expectedCode}"`);
      }
      const params = field?.params;
      for (const [key, val] of Object.entries(c.expectedParams)) {
        if (params?.[key] === undefined) {
          drift.push(`${c.label}: param "${key}" missing (expected ${JSON.stringify(val)})`);
        }
      }
    }

    expect(drift).toEqual([]);
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

  test("kebab-case entity name becomes snake_case in the reason", () => {
    const err = new NotFoundError("billing-period", 7);
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

  test("InternalError exposes cause snapshot in dev (NODE_ENV !== production)", () => {
    // Dev/test path: the cause is surfaced as causeMessage / causeStack so
    // developers don't have to bolt try/catch onto every handler to learn
    // why a request 500'd. Production strips it (next test).
    const err = new InternalError({ cause: new Error("redis_pool_exhausted") });
    const body = serializeError(err, "req-xyz");
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("internal error");
    expect(body.error.details).toMatchObject({ causeMessage: "redis_pool_exhausted" });
  });

  test("InternalError hides details in production (secret-safety)", () => {
    const original = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const err = new InternalError({ cause: new Error("leak me if you can") });
      const body = serializeError(err, "req-xyz");
      expect(body.error.code).toBe("internal_error");
      expect(body.error).not.toHaveProperty("details");
      expect(body.error.message).toBe("internal error");
    } finally {
      if (original === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = original;
    }
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
