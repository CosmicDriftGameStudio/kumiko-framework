import { describe, expect, test } from "vitest";
import { FrameworkError } from "../errors";
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

  test("allows valid transition", () => {
    expect(() => guardTransition(transitions, "draft", "sent")).not.toThrow();
    expect(() => guardTransition(transitions, "sent", "paid")).not.toThrow();
    expect(() => guardTransition(transitions, "sent", "cancelled")).not.toThrow();
  });

  test("rejects invalid transition", () => {
    expect(() => guardTransition(transitions, "draft", "paid")).toThrow(FrameworkError);
    expect(() => guardTransition(transitions, "draft", "paid")).toThrow(
      'Invalid transition: "draft" → "paid"',
    );
  });

  test("rejects skipping states", () => {
    expect(() => guardTransition(transitions, "draft", "cancelled")).toThrow(
      '"draft" → "cancelled"',
    );
  });

  test("rejects transition from terminal state", () => {
    expect(() => guardTransition(transitions, "paid", "draft")).toThrow('"paid" → "draft"');
  });

  test("error message includes allowed targets", () => {
    try {
      guardTransition(transitions, "sent", "draft");
    } catch (e) {
      expect((e as FrameworkError).message).toContain("paid, cancelled");
    }
  });

  test("rejects transition from unknown state", () => {
    expect(() => guardTransition(transitions, "unknown" as "draft", "sent")).toThrow(
      'Allowed from "unknown": none',
    );
  });
});
