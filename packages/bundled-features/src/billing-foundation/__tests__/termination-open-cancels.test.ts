import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { hasOtherOpenProviderCancel } from "../consumer-protection/termination-open-cancels.ts";
import {
  CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
  CONTRACT_TERMINATION_REVOKED_EVENT_QN,
} from "../events.ts";

const NOW = Temporal.Instant.from("2026-10-03T00:00:00Z");

function requested(
  requestId: string,
  providerCancel: "period-end" | "immediately" | "none",
  effectiveAtIso: string | null = null,
) {
  return {
    type: CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
    payload: {
      requestId,
      declarationType: "termination",
      terminationKind: "ordinary",
      channel: "public",
      receivedAtIso: "2026-10-01T00:00:00Z",
      effectiveAtIso,
      providerCancel,
    },
  };
}

function revoked(requestId: string) {
  return {
    type: CONTRACT_TERMINATION_REVOKED_EVENT_QN,
    payload: { requestId, revokedAtIso: "2026-10-02T00:00:00Z" },
  };
}

describe("hasOtherOpenProviderCancel", () => {
  test("is false when the only cancel is the revoked declaration itself", () => {
    expect(hasOtherOpenProviderCancel([requested("a", "period-end")], "a", NOW)).toBe(false);
  });

  test("is true when another declaration still cancels at the provider", () => {
    const events = [requested("a", "period-end"), requested("b", "period-end")];
    expect(hasOtherOpenProviderCancel(events, "a", NOW)).toBe(true);
  });

  test("ignores another declaration that was revoked or never cancelled at the provider", () => {
    const events = [
      requested("a", "period-end"),
      requested("b", "period-end"),
      revoked("b"),
      requested("c", "none"),
    ];
    expect(hasOtherOpenProviderCancel(events, "a", NOW)).toBe(false);
  });

  test("ignores a cancel of an earlier contract that already took effect", () => {
    const events = [
      requested("old", "period-end", "2025-12-31T00:00:00Z"),
      requested("new", "period-end", "2026-12-31T00:00:00Z"),
    ];
    expect(hasOtherOpenProviderCancel(events, "new", NOW)).toBe(false);
  });
});
