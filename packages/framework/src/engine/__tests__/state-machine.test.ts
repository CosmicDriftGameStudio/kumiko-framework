import { describe, expect, test } from "vitest";
import { UnprocessableError } from "../../errors";
import { defineTransitions, guardTransition } from "../state-machine";

describe("defineTransitions", () => {
  test("creates a map from transition config", () => {
    const transitions = defineTransitions({
      draft: ["sent"],
      sent: ["paid", "cancelled"],
      paid: [],
      cancelled: [],
    });

    expect(transitions.get("draft")?.has("sent")).toBe(true);
    expect(transitions.get("sent")?.has("paid")).toBe(true);
    expect(transitions.get("sent")?.has("cancelled")).toBe(true);
    expect(transitions.get("paid")?.size).toBe(0);
  });

  test("supports non-linear transitions (backtrack)", () => {
    const transitions = defineTransitions({
      draft: ["in_progress"],
      in_progress: ["review"],
      review: ["finalized", "in_progress"],
      finalized: ["sent"],
      sent: [],
    });

    expect(transitions.get("review")?.has("in_progress")).toBe(true);
    expect(transitions.get("review")?.has("finalized")).toBe(true);
  });
});

describe("guardTransition", () => {
  const transitions = defineTransitions({
    draft: ["sent"],
    sent: ["paid", "cancelled"],
    paid: [],
    cancelled: [],
  });

  // guardTransition throws an UnprocessableError with reason="invalid_transition"
  // so the HTTP layer maps it to 422 and the client can key off details.reason /
  // details.from / details.to. The human-readable arrow text lives in
  // details.message for log and error-toast rendering.

  test("allows valid transition", () => {
    expect(() => guardTransition(transitions, "draft", "sent")).not.toThrow();
    expect(() => guardTransition(transitions, "sent", "paid")).not.toThrow();
    expect(() => guardTransition(transitions, "sent", "cancelled")).not.toThrow();
  });

  test("rejects invalid transition as UnprocessableError", () => {
    expect(() => guardTransition(transitions, "draft", "paid")).toThrow(UnprocessableError);
    try {
      guardTransition(transitions, "draft", "paid");
    } catch (e) {
      const err = e as UnprocessableError;
      expect(err.code).toBe("unprocessable");
      expect(err.httpStatus).toBe(422);
      expect(err.details).toMatchObject({
        reason: "invalid_transition",
        from: "draft",
        to: "paid",
      });
      expect((err.details as { message: string }).message).toContain('"draft" → "paid"');
    }
  });

  test("rejects skipping states", () => {
    try {
      guardTransition(transitions, "draft", "cancelled");
    } catch (e) {
      expect((e as UnprocessableError).details).toMatchObject({ from: "draft", to: "cancelled" });
    }
  });

  test("rejects transition from terminal state", () => {
    try {
      guardTransition(transitions, "paid", "draft");
    } catch (e) {
      expect((e as UnprocessableError).details).toMatchObject({ from: "paid", to: "draft" });
    }
  });

  test("error details include allowed targets", () => {
    try {
      guardTransition(transitions, "sent", "draft");
    } catch (e) {
      expect((e as UnprocessableError).details).toMatchObject({ validTargets: "paid, cancelled" });
    }
  });

  test("rejects transition from unknown state", () => {
    try {
      guardTransition(transitions, "unknown" as "draft", "sent");
    } catch (e) {
      const err = e as UnprocessableError;
      expect(err.details).toMatchObject({ from: "unknown", validTargets: "none" });
    }
  });
});
