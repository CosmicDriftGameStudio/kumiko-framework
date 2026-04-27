import { describe, expect, test } from "vitest";
import { failNotFound, failTransition, failUnprocessable } from "../write-error-info";

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
  test("baut WriteFailure mit reason + custom-details", () => {
    const f = failUnprocessable("custom_business_rule", { extra: 42 });
    expect(f.error.httpStatus).toBe(422);
    expect(f.error.details).toMatchObject({ reason: "custom_business_rule", extra: 42 });
  });
});

describe("failTransition", () => {
  test("baut WriteFailure mit reason=invalid_transition + from/to/allowed", () => {
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
    const { InternalError } = await import("../classes");
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
    const { InternalError } = await import("../classes");
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
    const { InternalError } = await import("../classes");
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
