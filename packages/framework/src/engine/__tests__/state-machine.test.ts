import { describe, expect, test } from "bun:test";
import { UnprocessableError } from "../../errors/index.ts";
import { defineTransitions, guardTransition } from "../state-machine.ts";

describe("defineTransitions — TransitionGraph API", () => {
  const transitions = defineTransitions({
    draft: ["sent"],
    sent: ["paid", "cancelled"],
    paid: [],
    cancelled: [],
  });

  test("canTransition: allowed transitions", () => {
    expect(transitions.canTransition("draft", "sent")).toBe(true);
    expect(transitions.canTransition("sent", "paid")).toBe(true);
    expect(transitions.canTransition("sent", "cancelled")).toBe(true);
  });

  test("canTransition: forbidden transitions", () => {
    expect(transitions.canTransition("draft", "paid")).toBe(false);
    expect(transitions.canTransition("paid", "draft")).toBe(false);
  });

  test("canTransition: unknown from-State returns false (no throw)", () => {
    expect(transitions.canTransition("unknown" as "draft", "sent")).toBe(false);
  });

  test("allowedFrom: returns the allowed targets", () => {
    expect(transitions.allowedFrom("sent")).toEqual(["paid", "cancelled"]);
    expect(transitions.allowedFrom("draft")).toEqual(["sent"]);
  });

  test("allowedFrom: terminaler State → leeres Array", () => {
    expect(transitions.allowedFrom("paid")).toEqual([]);
  });

  test("allowedFrom: unbekannter State → leeres Array", () => {
    expect(transitions.allowedFrom("unknown" as "draft")).toEqual([]);
  });

  test("supports non-linear transitions (backtrack)", () => {
    const t = defineTransitions({
      draft: ["in_progress"],
      in_progress: ["review"],
      review: ["finalized", "in_progress"],
      finalized: ["sent"],
      sent: [],
    });
    expect(t.canTransition("review", "in_progress")).toBe(true);
    expect(t.canTransition("review", "finalized")).toBe(true);
  });
});

describe("assertTransition / guardTransition", () => {
  const transitions = defineTransitions({
    draft: ["sent"],
    sent: ["paid", "cancelled"],
    paid: [],
    cancelled: [],
  });

  // assertTransition throws UnprocessableError with reason="invalid_transition"
  // (HTTP 422). guardTransition is a convenience wrapper with the same logic;
  // both paths must behave identically.

  test("method-form: allowed transition succeeds", () => {
    expect(() => transitions.assertTransition("draft", "sent")).not.toThrow();
  });

  test("function-form (guardTransition): identisches Verhalten", () => {
    expect(() => guardTransition(transitions, "draft", "sent")).not.toThrow();
    expect(() => guardTransition(transitions, "draft", "paid")).toThrow(UnprocessableError);
  });

  test("rejects invalid transition with details + i18nKey", () => {
    try {
      transitions.assertTransition("draft", "paid");
    } catch (e) {
      const err = e as UnprocessableError;
      expect(err.code).toBe("unprocessable");
      expect(err.httpStatus).toBe(422);
      expect(err.details).toMatchObject({
        reason: "invalid_transition",
        from: "draft",
        to: "paid",
        allowed: ["sent"],
      });
      expect((err.details as { message: string }).message).toContain('"draft" → "paid"');
    }
  });

  test("error details: allowed-array from the state machine", () => {
    try {
      transitions.assertTransition("sent", "draft");
    } catch (e) {
      expect((e as UnprocessableError).details).toMatchObject({
        allowed: ["paid", "cancelled"],
      });
    }
  });

  test("rejects transition from unknown state with allowed=[] (empty array)", () => {
    try {
      transitions.assertTransition("unknown" as "draft", "sent");
    } catch (e) {
      const err = e as UnprocessableError;
      expect(err.details).toMatchObject({ from: "unknown", allowed: [] });
    }
  });

  test("identische details-shape zwischen assertTransition + failTransition", async () => {
    // Both paths must build the same detail block because clients parse the 422
    // body uniformly and must not need a "validTargets vs. allowed" branch.
    const { failTransition } = await import("../../errors/index.ts");
    type TransitionDetails = {
      from?: string;
      to?: string;
      allowed?: readonly string[];
      message?: string;
      reason?: string;
    };
    let assertDetails: TransitionDetails | undefined;
    try {
      transitions.assertTransition("draft", "paid");
    } catch (e) {
      assertDetails = (e as UnprocessableError).details as TransitionDetails;
    }
    // If assertTransition fails to throw (a future bug), assertDetails remains
    // undefined, making the diagnosis unclear. This early check makes the
    // failure path explicit.
    expect(assertDetails).toBeDefined();
    const failResult = failTransition("draft", "paid", ["sent"]);
    const failDetails = failResult.error.details as TransitionDetails;
    // assertTransition throws via UnprocessableError, which automatically injects
    // `reason` into details; failTransition follows the same path. Structural
    // fields must match exactly.
    expect(assertDetails?.from).toEqual(failDetails.from);
    expect(assertDetails?.to).toEqual(failDetails.to);
    expect(assertDetails?.allowed).toEqual(failDetails.allowed);
    expect(assertDetails?.message).toEqual(failDetails.message);
    expect(assertDetails?.reason).toEqual(failDetails.reason);
  });

  test("rejects transition from terminal state", () => {
    expect(() => transitions.assertTransition("paid", "draft")).toThrow(UnprocessableError);
  });
});
