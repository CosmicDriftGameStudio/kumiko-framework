import { describe, expect, test } from "bun:test";
import { UnprocessableError } from "../../errors";
import { defineTransitions, guardTransition } from "../state-machine";

describe("defineTransitions — TransitionGraph API", () => {
  const transitions = defineTransitions({
    draft: ["sent"],
    sent: ["paid", "cancelled"],
    paid: [],
    cancelled: [],
  });

  test("canTransition: erlaubte Übergänge", () => {
    expect(transitions.canTransition("draft", "sent")).toBe(true);
    expect(transitions.canTransition("sent", "paid")).toBe(true);
    expect(transitions.canTransition("sent", "cancelled")).toBe(true);
  });

  test("canTransition: verbotene Übergänge", () => {
    expect(transitions.canTransition("draft", "paid")).toBe(false);
    expect(transitions.canTransition("paid", "draft")).toBe(false);
  });

  test("canTransition: unbekannter from-State liefert false (kein Throw)", () => {
    expect(transitions.canTransition("unknown" as "draft", "sent")).toBe(false);
  });

  test("allowedFrom: liefert die erlaubten Targets", () => {
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

  // assertTransition wirft UnprocessableError mit reason="invalid_transition"
  // (HTTP 422). guardTransition ist Convenience-Wrapper mit derselben Logik —
  // beide müssen identisch verhalten.

  test("method-form: erlaubter Übergang läuft durch", () => {
    expect(() => transitions.assertTransition("draft", "sent")).not.toThrow();
  });

  test("function-form (guardTransition): identisches Verhalten", () => {
    expect(() => guardTransition(transitions, "draft", "sent")).not.toThrow();
    expect(() => guardTransition(transitions, "draft", "paid")).toThrow(UnprocessableError);
  });

  test("rejects invalid transition mit details + i18nKey", () => {
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

  test("error details: allowed-array aus der State-Machine", () => {
    try {
      transitions.assertTransition("sent", "draft");
    } catch (e) {
      expect((e as UnprocessableError).details).toMatchObject({
        allowed: ["paid", "cancelled"],
      });
    }
  });

  test("rejects transition from unknown state mit allowed=[] (leeres Array)", () => {
    try {
      transitions.assertTransition("unknown" as "draft", "sent");
    } catch (e) {
      const err = e as UnprocessableError;
      expect(err.details).toMatchObject({ from: "unknown", allowed: [] });
    }
  });

  test("identische details-shape zwischen assertTransition + failTransition", async () => {
    // Beide Pfade müssen den gleichen Detail-Block bauen — Clients
    // parsen den 422-Body uniform und dürfen kein "validTargets vs.
    // allowed"-Branch fühlen.
    const { failTransition } = await import("../../errors");
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
    // Wenn assertTransition nicht wirft (zukünftiger Bug), bleibt
    // assertDetails undefined → Diagnose unklar. Frühzeitiger Check macht
    // den Fehlerpfad eindeutig.
    expect(assertDetails).toBeDefined();
    const failResult = failTransition("draft", "paid", ["sent"]);
    const failDetails = failResult.error.details as TransitionDetails;
    // assertTransition wirft via UnprocessableError → details bekommt
    // automatisch `reason` injiziert; failTransition geht denselben
    // Pfad. Strukturelle Felder müssen 1:1 matchen.
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
