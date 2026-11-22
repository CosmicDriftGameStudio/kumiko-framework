import { beforeEach, describe, expect, test } from "bun:test";
import {
  type LetterAddress,
  type LetterSubmission,
  recognizedAddressMatches,
} from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { createLetterSimulator } from "../simulator.ts";

const RECIPIENT: LetterAddress = {
  name: "Erika Mustermann",
  street: "Musterstraße",
  houseNumber: "12",
  postalCode: "12345",
  city: "Musterstadt",
};

function submission(
  reference: string,
  shippingMode: LetterSubmission["spec"]["shippingMode"] = "standard",
): LetterSubmission {
  return {
    reference,
    pdf: new Uint8Array([1]),
    spec: {
      pageCount: 3,
      sheetCount: 2,
      shippingMode,
      envelope: "folded",
      color: false,
      duplex: true,
    },
    expectedRecipient: RECIPIENT,
  };
}

const T0 = Temporal.Instant.from("2026-11-22T10:00:00Z");
let sim = createLetterSimulator();
let now = T0;

beforeEach(() => {
  sim = createLetterSimulator();
  now = T0;
  sim.setClock(() => now);
});

async function acceptedJobId(reference: string, mode?: LetterSubmission["spec"]["shippingMode"]) {
  const result = await sim.provider.submit(submission(reference, mode));
  if (result.kind !== "accepted") throw new Error("expected acceptance");
  return result.providerJobId;
}

describe("letter simulator", () => {
  test("accepts, prices by sheets and mode, and reports the recognized address with sender line", async () => {
    const quote = await sim.provider.quote(submission("a").spec);
    expect(quote).toEqual({
      net: { amount: 85 + 2 * 12, currency: "EUR" },
      priceSource: "simulated",
    });
    const result = await sim.provider.submit(submission("a"));
    if (result.kind !== "accepted") throw new Error("expected acceptance");
    expect(result.actualNet).toEqual(quote.net);
    expect(result.actualVat.amount).toBe(Math.round((quote.net.amount * 19) / 100));
    expect(result.recognizedAddress).toContain("Beispiel Hausverwaltung GmbH");
    expect(recognizedAddressMatches(RECIPIENT, result.recognizedAddress ?? "")).toBe(true);
    expect(result.cancelableUntil?.toString()).toBe("2026-11-22T10:10:00Z");
  });

  test("a misrecognized address no longer matches", async () => {
    sim.setScenario({ misrecognizedAddress: true });
    const result = await sim.provider.submit(submission("a"));
    if (result.kind !== "accepted") throw new Error("expected acceptance");
    expect(recognizedAddressMatches(RECIPIENT, result.recognizedAddress ?? "")).toBe(false);
  });

  test("rejects with the configured code and keeps no order", async () => {
    sim.setScenario({ submit: { kind: "reject", code: "invalid-address", message: "bad" } });
    expect(await sim.provider.submit(submission("a"))).toEqual({
      kind: "rejected",
      code: "invalid-address",
      message: "bad",
    });
    expect(sim.orders()).toHaveLength(0);
  });

  test("a lost timeout places no order, an accepted one is found by reference", async () => {
    sim.setScenario({ submit: { kind: "timeout-lost" } });
    await expect(sim.provider.submit(submission("lost"))).rejects.toThrow("timed out");
    expect(await sim.provider.findByReference?.("lost")).toBeNull();

    sim.setScenario({ submit: { kind: "timeout-accepted" } });
    await expect(sim.provider.submit(submission("kept"))).rejects.toThrow("timed out");
    const found = await sim.provider.findByReference?.("kept");
    expect(found?.kind).toBe("accepted");
    sim.setScenario({});
    const again = await sim.provider.submit(submission("kept"));
    expect(JSON.stringify(again)).toBe(JSON.stringify(found));
    expect(sim.orders()).toHaveLength(1);
  });

  test("status is queued inside the cancel window, then the final state", async () => {
    sim.setScenario({ finalState: "on-hold" });
    const jobId = await acceptedJobId("a");
    expect((await sim.provider.status(jobId)).state).toBe("queued");
    now = T0.add({ minutes: 11 });
    expect((await sim.provider.status(jobId)).state).toBe("on-hold");
  });

  test("tracked modes get a tracking number and proof once sent; standard gets none", async () => {
    const tracked = await acceptedJobId("t", "einwurf");
    const plain = await acceptedJobId("p");
    now = T0.add({ minutes: 11 });
    const trackedStatus = await sim.provider.status(tracked);
    expect(trackedStatus.state).toBe("sent");
    expect(trackedStatus.trackingNumber).toMatch(/^SIM/);
    expect(trackedStatus.proofs).toHaveLength(1);
    const plainStatus = await sim.provider.status(plain);
    expect(plainStatus.trackingNumber).toBeUndefined();
    expect(plainStatus.proofs).toBeUndefined();
  });

  test("cancel works inside the window, is refused after it, and the order is then unknown", async () => {
    const jobId = await acceptedJobId("a");
    expect(await sim.provider.cancel?.(jobId)).toEqual({ kind: "canceled" });
    expect((await sim.provider.status(jobId)).state).toBe("not-found");
    expect(await sim.provider.cancel?.(jobId)).toEqual({ kind: "refused", reason: "unknown_job" });

    const late = await acceptedJobId("b");
    now = T0.add({ minutes: 11 });
    expect(await sim.provider.cancel?.(late)).toEqual({ kind: "refused", reason: "window_closed" });
    expect((await sim.provider.status("sim-999")).state).toBe("not-found");
  });

  test("a scenario can change the price and the capabilities; reset restores both", async () => {
    sim.setScenario({ actualNet: { amount: 500, currency: "EUR" } });
    const result = await sim.provider.submit(submission("a"));
    if (result.kind !== "accepted") throw new Error("expected acceptance");
    expect(result.actualNet.amount).toBe(500);
    sim.setCapabilities({ cancelWindowSeconds: null });
    const noWindow = await sim.provider.submit(submission("b"));
    expect(noWindow.kind === "accepted" && noWindow.cancelableUntil).toBeFalsy();
    sim.reset();
    expect(sim.orders()).toHaveLength(0);
    expect(sim.calls.submit).toBe(0);
    expect((await sim.provider.balance?.())?.amount).toBe(10_000);
  });
});
