import { describe, expect, test } from "bun:test";
import { InternalError, NotFoundError } from "../classes";
import {
  failNotFound,
  failTransition,
  failUnprocessable,
  reraiseAsKumikoError,
  toWriteErrorInfo,
} from "../write-error-info";

describe("failNotFound", () => {
  test("baut WriteFailure mit reason=not_found + entity-id-details", () => {
    const f = failNotFound("invoice", "inv-1");
    expect(f.isSuccess).toBe(false);
    expect(f.error.code).toBe("not_found");
    expect(f.error.httpStatus).toBe(404);
    expect(f.error.details).toMatchObject({ reason: "invoice_not_found", id: "inv-1" });
  });
});

describe("failUnprocessable", () => {
  test("builds WriteFailure with reason + custom details", () => {
    const f = failUnprocessable("custom_business_rule", { extra: 42 });
    expect(f.error.httpStatus).toBe(422);
    expect(f.error.details).toMatchObject({ reason: "custom_business_rule", extra: 42 });
  });

  test("positional reason survives a conflicting details.reason from the caller", () => {
    // @ts-expect-error callers must not pass details.reason; positional arg wins at runtime
    const f = failUnprocessable("custom_business_rule", { reason: "raw cause text", extra: 42 });
    expect(f.error.details).toEqual({ reason: "custom_business_rule", extra: 42 });
  });

  test("details may carry extras but reason comes only from the positional arg", () => {
    const f = failUnprocessable("custom_business_rule", { extra: 42, causeNote: "use opts.cause" });
    expect(f.error.details).toEqual({
      reason: "custom_business_rule",
      extra: 42,
      causeNote: "use opts.cause",
    });
  });
});

describe("failTransition", () => {
  test("builds WriteFailure with reason=invalid_transition + from/to/allowed", () => {
    const f = failTransition("draft", "paid", ["sent"]);
    expect(f.isSuccess).toBe(false);
    expect(f.error.code).toBe("unprocessable");
    expect(f.error.httpStatus).toBe(422);
    expect(f.error.i18nKey).toBe("errors.invalidTransition");
    expect(f.error.details).toMatchObject({
      reason: "invalid_transition",
      from: "draft",
      to: "paid",
      allowed: ["sent"],
    });
  });

  test("baut sichtbare message mit allowed-Liste", () => {
    const f = failTransition("draft", "paid", ["sent", "cancelled"]);
    const details = f.error.details as { message: string };
    expect(details.message).toContain('"draft" → "paid"');
    expect(details.message).toContain("sent, cancelled");
  });

  test("leeres allowed → message zeigt 'none' (Terminal-State)", () => {
    const f = failTransition("paid", "draft", []);
    const details = f.error.details as { message: string; allowed: readonly string[] };
    expect(details.allowed).toEqual([]);
    expect(details.message).toContain("none");
  });
});

// toWriteErrorInfo dev-cause-snapshot pinnt: ein InternalError mit
// cause überlebt den Roundtrip durch WriteErrorInfo (war vorher kein
// Cause-Feld → reraise → "internal error" ohne Diagnose). Pfad ist
// NODE_ENV-conditional, deshalb lokal toggeln und nach Test wieder
// restoren — Cross-Test-Pollution wäre teuer (andere Suites pinnen
// Production-Pfad).
describe("toWriteErrorInfo — dev cause-snapshot", () => {
  test("InternalError mit cause exposed cause-Snapshot in details (dev)", async () => {
    const { toWriteErrorInfo } = await import("../write-error-info");
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    try {
      const cause = new TypeError("nope");
      const err = new InternalError({ cause });
      const info = toWriteErrorInfo(err);
      const details = info.details as
        | { causeName?: string; causeMessage?: string; causeStack?: string }
        | undefined;
      expect(details?.causeName).toBe("TypeError");
      expect(details?.causeMessage).toBe("nope");
      expect(details?.causeStack).toContain("TypeError");
    } finally {
      process.env["NODE_ENV"] = previous;
    }
  });

  test("Production: InternalError lässt details undefined (kein Stack-Leak)", async () => {
    const { toWriteErrorInfo } = await import("../write-error-info");
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const err = new InternalError({ cause: new TypeError("nope") });
      const info = toWriteErrorInfo(err);
      expect(info.details).toBeUndefined();
    } finally {
      process.env["NODE_ENV"] = previous;
    }
  });

  test("InternalError MIT bereits gesetztem details → Author-details gewinnt (kein Overwrite)", async () => {
    const { toWriteErrorInfo } = await import("../write-error-info");
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "development";
    try {
      const err = new InternalError({
        cause: new Error("hidden"),
        details: { explicit: "from author" },
      });
      const info = toWriteErrorInfo(err);
      expect(info.details).toEqual({ explicit: "from author" });
    } finally {
      process.env["NODE_ENV"] = previous;
    }
  });
});

// The cause must reach routes.ts's logServerFault via reraiseAsKumikoError,
// but never the wire body or the idempotency cache (both serialize the info).
describe("toWriteErrorInfo / reraiseAsKumikoError — cause round-trip", () => {
  test("cause survives toWriteErrorInfo → reraiseAsKumikoError without appearing on the info object", () => {
    const boom = new Error("connection was closed");
    const info = toWriteErrorInfo(new InternalError({ cause: boom }));
    expect(reraiseAsKumikoError(info).cause).toBe(boom);
    expect(Object.keys(info)).not.toContain("cause");
  });

  test("production: cause still reaches reraise even though details/message stay sanitized", () => {
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const boom = new Error("connection was closed");
      const info = toWriteErrorInfo(new InternalError({ cause: boom }));
      expect(info.details).toBeUndefined();
      const serialized = JSON.stringify(info);
      expect(serialized).not.toContain("connection was closed");
      expect(serialized).not.toContain("cause");
      expect(reraiseAsKumikoError(info).cause).toBe(boom);
    } finally {
      if (previous === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previous;
    }
  });

  test("KumikoError without a cause → reraised error has no cause", () => {
    const info = toWriteErrorInfo(new NotFoundError("invoice", "inv-1"));
    expect(reraiseAsKumikoError(info).cause).toBeUndefined();
  });

  test("a plain object with the same shape (simulated idempotency-cache replay) carries no cause", () => {
    const info = toWriteErrorInfo(new InternalError({ cause: new Error("connection was closed") }));
    const replayed = { ...info };
    expect(reraiseAsKumikoError(replayed).cause).toBeUndefined();
  });
});
