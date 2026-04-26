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
