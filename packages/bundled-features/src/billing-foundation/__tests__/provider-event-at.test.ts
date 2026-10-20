import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { clampProviderEventAt, processEventSchema } from "../handlers/process-event.write.ts";

const NOW = Temporal.Instant.from("2026-10-20T10:00:00Z");

function payloadAt(providerEventAtIso: string | undefined) {
  return {
    providerName: "stripe",
    providerEventId: "evt_1",
    type: "subscription.updated",
    providerCustomerId: "cus_1",
    providerSubscriptionId: "sub_1",
    status: "active",
    tier: "pro",
    currentPeriodEndIso: "2026-11-20T10:00:00Z",
    ...(providerEventAtIso !== undefined && { providerEventAtIso }),
  } as Parameters<typeof clampProviderEventAt>[0];
}

describe("clampProviderEventAt", () => {
  test("a timestamp far in the future is capped at now plus the skew", () => {
    const clamped = clampProviderEventAt(payloadAt("2096-01-01T00:00:00Z"), NOW);
    expect(clamped.providerEventAtIso).toBe("2026-10-20T10:05:00Z");
  });

  test("a past timestamp and a missing one stay untouched", () => {
    expect(clampProviderEventAt(payloadAt("2026-10-20T09:00:00Z"), NOW).providerEventAtIso).toBe(
      "2026-10-20T09:00:00Z",
    );
    expect(clampProviderEventAt(payloadAt(undefined), NOW).providerEventAtIso).toBeUndefined();
  });
});

describe("processEventSchema providerEventAtIso", () => {
  test("rejects a value that is not an ISO datetime", () => {
    const result = processEventSchema.safeParse({
      ...payloadAt(undefined),
      providerEventAtIso: "yesterday",
    });
    expect(result.success).toBe(false);
  });
});
