import { describe, expect, test } from "bun:test";
import { hasOtherOpenProviderCancel } from "../consumer-protection/termination-open-cancels.ts";
import {
  CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
  CONTRACT_TERMINATION_REVOKED_EVENT_QN,
} from "../events.ts";

function requested(requestId: string, providerCancel: "period-end" | "immediately" | "none") {
  return {
    type: CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
    payload: {
      requestId,
      declarationType: "termination",
      terminationKind: "ordinary",
      channel: "public",
      receivedAtIso: "2026-10-01T00:00:00Z",
      effectiveAtIso: null,
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
    expect(hasOtherOpenProviderCancel([requested("a", "period-end")], "a")).toBe(false);
  });

  test("is true when another declaration still cancels at the provider", () => {
    const events = [requested("a", "period-end"), requested("b", "period-end")];
    expect(hasOtherOpenProviderCancel(events, "a")).toBe(true);
  });

  test("ignores another declaration that was revoked or never cancelled at the provider", () => {
    const events = [
      requested("a", "period-end"),
      requested("b", "period-end"),
      revoked("b"),
      requested("c", "none"),
    ];
    expect(hasOtherOpenProviderCancel(events, "a")).toBe(false);
  });
});
