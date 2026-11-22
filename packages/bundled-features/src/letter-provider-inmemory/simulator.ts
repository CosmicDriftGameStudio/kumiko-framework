import {
  LETTER_SHIPPING_MODES,
  type LetterAddress,
  type LetterCancelResult,
  type LetterMoney,
  type LetterProvider,
  type LetterProviderCapabilities,
  type LetterProviderStatus,
  type LetterQuote,
  type LetterRejectionCode,
  type LetterShippingMode,
  type LetterSpec,
  type LetterSubmission,
  type LetterSubmitResult,
} from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { PDFDocument } from "pdf-lib";

const CURRENCY = "EUR";
const SENDER_LINE = "Beispiel Hausverwaltung GmbH, Beispielweg 1, 54321 Beispielstadt";
const VAT_PERCENT = 19;
const BASE_CENTS = 85;
const PER_SHEET_CENTS = 12;
const COLOR_SURCHARGE_CENTS = 8;
const TRACKED_MODES: readonly LetterShippingMode[] = ["einwurf", "uebergabe", "rueckschein"];
const MODE_SURCHARGE_CENTS: Readonly<Record<LetterShippingMode, number>> = {
  standard: 0,
  einwurf: 230,
  uebergabe: 350,
  rueckschein: 480,
};

type MutableCapabilities = {
  -readonly [K in keyof LetterProviderCapabilities]: LetterProviderCapabilities[K];
};

const DEFAULT_CAPABILITIES: LetterProviderCapabilities = {
  shippingModes: LETTER_SHIPPING_MODES,
  maxSheets: 20,
  maxBytes: 10 * 1024 * 1024,
  cancelWindowSeconds: 600,
};

// One object whose fields tests overwrite in place: the plugin registered at boot keeps this reference.
export const INMEMORY_CAPABILITIES: MutableCapabilities = { ...DEFAULT_CAPABILITIES };

/** What the provider answers to `submit`. `timeout-*` throw like a lost connection; the order is
 *  then missing (`timeout-lost`) or placed anyway (`timeout-accepted`, found by `findByReference`). */
export type SubmitBehavior =
  | { readonly kind: "accept" }
  | { readonly kind: "reject"; readonly code: LetterRejectionCode; readonly message: string }
  | { readonly kind: "timeout-lost" }
  | { readonly kind: "timeout-accepted" };

/** The state an accepted order reaches once its cancel window has passed. */
export type FinalProviderState = "sent" | "on-hold" | "failed" | "returned";

export type LetterScenario = {
  readonly submit: SubmitBehavior;
  readonly finalState: FinalProviderState;
  readonly actualNet?: LetterMoney;
  readonly actualVat?: LetterMoney;
  /** Differently recognized address zone: another street than the expected one. */
  readonly misrecognizedAddress: boolean;
};

export type SimulatedOrder = {
  readonly providerJobId: string;
  readonly submission: LetterSubmission;
  readonly acceptedAt: Temporal.Instant;
  readonly canceled: boolean;
  readonly recognizedAddress: string;
  readonly trackingNumber: string | undefined;
  readonly actualNet: LetterMoney;
  readonly actualVat: LetterMoney;
  readonly finalState: FinalProviderState;
};

const NO_CALLS = { quote: 0, submit: 0, status: 0, cancel: 0, findByReference: 0, balance: 0 };

const DEFAULT_SCENARIO: LetterScenario = {
  submit: { kind: "accept" },
  finalState: "sent",
  misrecognizedAddress: false,
};

function money(amount: number): LetterMoney {
  return { amount, currency: CURRENCY };
}

function netCentsFor(spec: LetterSpec): number {
  return (
    BASE_CENTS +
    spec.sheetCount * PER_SHEET_CENTS +
    (spec.color ? spec.sheetCount * COLOR_SURCHARGE_CENTS : 0) +
    MODE_SURCHARGE_CENTS[spec.shippingMode]
  );
}

function addressZone(address: LetterAddress, misrecognized: boolean): string {
  const street = misrecognized ? "Beispielgasse" : address.street;
  const lines = [
    SENDER_LINE,
    "",
    address.name,
    ...(address.addressExtra === undefined ? [] : [address.addressExtra]),
    `${street} ${address.houseNumber}`,
    `${address.postalCode} ${address.city}`,
  ];
  return lines.join(", ");
}

async function proofPdf(order: SimulatedOrder): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  page.drawText(`Proof of delivery ${order.providerJobId}`, { x: 50, y: 750 });
  return doc.save();
}

/** In-memory print provider for tests and demos. One instance per process; tests steer it with
 *  `setScenario` and `setClock`, and read what reached it from `submissions` and `calls`. */
export function createLetterSimulator() {
  let scenario: LetterScenario = DEFAULT_SCENARIO;
  let clock: () => Temporal.Instant = () => Temporal.Now.instant();
  let nextJobNumber = 1;
  const orders = new Map<string, SimulatedOrder>();
  const jobIdByReference = new Map<string, string>();
  const calls = { ...NO_CALLS };

  function placeOrder(submission: LetterSubmission): SimulatedOrder {
    const known = jobIdByReference.get(submission.reference);
    const existing = known === undefined ? undefined : orders.get(known);
    if (existing !== undefined) return existing;
    const net = netCentsFor(submission.spec);
    const providerJobId = `sim-${nextJobNumber++}`;
    const order: SimulatedOrder = {
      providerJobId,
      submission,
      acceptedAt: clock(),
      canceled: false,
      recognizedAddress: addressZone(submission.expectedRecipient, scenario.misrecognizedAddress),
      trackingNumber: TRACKED_MODES.includes(submission.spec.shippingMode)
        ? `SIM${providerJobId.replace("sim-", "").padStart(8, "0")}`
        : undefined,
      actualNet: scenario.actualNet ?? money(net),
      actualVat: scenario.actualVat ?? money(Math.round((net * VAT_PERCENT) / 100)),
      finalState: scenario.finalState,
    };
    orders.set(providerJobId, order);
    jobIdByReference.set(submission.reference, providerJobId);
    return order;
  }

  function acceptanceOf(order: SimulatedOrder): LetterSubmitResult {
    const windowSeconds = INMEMORY_CAPABILITIES.cancelWindowSeconds;
    return {
      kind: "accepted",
      providerJobId: order.providerJobId,
      actualNet: order.actualNet,
      actualVat: order.actualVat,
      recognizedAddress: order.recognizedAddress,
      ...(windowSeconds !== null && {
        cancelableUntil: order.acceptedAt.add({ seconds: windowSeconds }),
      }),
      ...(order.trackingNumber !== undefined && { trackingNumber: order.trackingNumber }),
    };
  }

  function isWithinCancelWindow(order: SimulatedOrder): boolean {
    const windowSeconds = INMEMORY_CAPABILITIES.cancelWindowSeconds;
    if (windowSeconds === null) return false;
    return Temporal.Instant.compare(clock(), order.acceptedAt.add({ seconds: windowSeconds })) <= 0;
  }

  const provider: LetterProvider = {
    async quote(spec): Promise<LetterQuote> {
      calls.quote += 1;
      return { net: money(netCentsFor(spec)), priceSource: "simulated" };
    },
    async submit(submission): Promise<LetterSubmitResult> {
      calls.submit += 1;
      const { submit } = scenario;
      if (submit.kind === "reject") {
        return { kind: "rejected", code: submit.code, message: submit.message };
      }
      if (submit.kind === "timeout-lost") throw new Error("letter provider timed out");
      const order = placeOrder(submission);
      if (submit.kind === "timeout-accepted") throw new Error("letter provider timed out");
      return acceptanceOf(order);
    },
    async status(providerJobId): Promise<LetterProviderStatus> {
      calls.status += 1;
      const order = orders.get(providerJobId);
      if (order === undefined || order.canceled) return { state: "not-found" };
      const base = {
        recognizedAddress: order.recognizedAddress,
        ...(order.trackingNumber !== undefined && { trackingNumber: order.trackingNumber }),
      };
      if (isWithinCancelWindow(order)) return { ...base, state: "queued" };
      if (order.finalState !== "sent") return { ...base, state: order.finalState };
      return {
        ...base,
        state: "sent",
        ...(order.trackingNumber !== undefined && {
          trackingStatus: "Delivered",
          proofs: [
            { fileName: `proof-${order.providerJobId}.pdf`, content: await proofPdf(order) },
          ],
        }),
      };
    },
    async cancel(providerJobId): Promise<LetterCancelResult> {
      calls.cancel += 1;
      const order = orders.get(providerJobId);
      if (order === undefined || order.canceled) return { kind: "refused", reason: "unknown_job" };
      if (!isWithinCancelWindow(order)) return { kind: "refused", reason: "window_closed" };
      orders.set(providerJobId, { ...order, canceled: true });
      return { kind: "canceled" };
    },
    async findByReference(reference): Promise<LetterSubmitResult | null> {
      calls.findByReference += 1;
      const jobId = jobIdByReference.get(reference);
      const order = jobId === undefined ? undefined : orders.get(jobId);
      return order === undefined || order.canceled ? null : acceptanceOf(order);
    },
    async balance(): Promise<LetterMoney> {
      calls.balance += 1;
      return money(10_000);
    },
  };

  return {
    provider,
    calls,
    get submissions(): readonly LetterSubmission[] {
      return [...orders.values()].map((order) => order.submission);
    },
    orders: (): readonly SimulatedOrder[] => [...orders.values()],
    setScenario(next: Partial<LetterScenario>): void {
      scenario = { ...DEFAULT_SCENARIO, ...next };
    },
    setCapabilities(next: Partial<LetterProviderCapabilities>): void {
      Object.assign(INMEMORY_CAPABILITIES, next);
    },
    setClock(next: () => Temporal.Instant): void {
      clock = next;
    },
    reset(): void {
      scenario = DEFAULT_SCENARIO;
      clock = () => Temporal.Now.instant();
      Object.assign(INMEMORY_CAPABILITIES, DEFAULT_CAPABILITIES);
      nextJobNumber = 1;
      orders.clear();
      jobIdByReference.clear();
      Object.assign(calls, NO_CALLS);
    },
  };
}

export const letterSimulator = createLetterSimulator();
