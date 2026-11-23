// Behaviour of the review fixes over the real stack: unknown handover keeps its estimate, an
// address mismatch cancels right after the handover, a retried handover reserves once, and
// resolve-unknown can accept a letter by the provider's order id.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany, updateMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { UnrecoverableError } from "bullmq";
import * as z from "zod";
import { capReservationsTable, currentCalendarMonthStartIso } from "../../cap-counter/index.ts";
import { ConfigHandlers } from "../../config/index.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import { unprocessable } from "../../shared/index.ts";
import { cancelLetterBeforeHandover } from "../cancel-before-handover.ts";
import {
  LETTER_APPROVED_STALE_MS,
  LETTER_FAILURE_REASON,
  LETTER_HANDOVER_GIVE_UP_MS,
  LETTER_STATE,
  LetterEvents,
  LetterHandlers,
  LetterI18n,
  LetterInternalHandlers,
  LetterJobs,
} from "../constants.ts";
import { letterSubmissionTable } from "../entity.ts";
import {
  APPROVER,
  CLERK,
  createLetterHarness,
  LIMIT_KEY,
  type ParkedRun,
  SYSTEM_ADMIN,
  TENANT,
} from "./letter-harness.ts";

const HOLD_MS = 300;
const CASE_WORKER = createTestUser({ id: 4, tenantId: TENANT, roles: ["User"] });
const NOTE = "Checked with the provider: the order exists under this id.";
const NOTHING = { cost: 0, count: 0, sheets: 0, pages: 0 };
const ONE_LETTER = { cost: 109, count: 1, sheets: 2, pages: 3 };

// Drives the internal rejection with any reason, to see which states accept it.
const REJECT_PROBE_JOB = "letter-reject-probe:job:reject";
const rejectProbeFeature = defineFeature("letter-reject-probe", (r) => {
  r.job({
    name: "reject",
    trigger: { manual: true },
    handler: async (payload, ctx) => {
      const input = z.object({ letterId: z.string(), failureReason: z.string() }).parse(payload);
      const result = await ctx.dispatch.write(LetterInternalHandlers.recordRejection, input);
      if (!result.isSuccess) throw new Error(`rejection failed: ${JSON.stringify(result.error)}`);
      return undefined;
    },
  });
});

// Stands in for an app that drops the letters of a superseded case: it holds neither the approver role nor an admin one.
const DROP_LETTER = "case-probe:write:drop-letter";
const caseProbeFeature = defineFeature("case-probe", (r) => {
  r.writeHandler({
    name: "drop-letter",
    schema: z.object({ letterId: z.string(), failAfterwards: z.boolean().default(false) }),
    access: { roles: ["User"] },
    handler: async (event, ctx) => {
      const canceled = await cancelLetterBeforeHandover(ctx, event.payload.letterId);
      if (!canceled.isSuccess) return canceled;
      if (event.payload.failAfterwards)
        return unprocessable("case_probe_failed", "case-probe.failed");
      return canceled;
    },
  });
});
const harness = createLetterHarness({ handoverHoldMs: HOLD_MS }, [
  rejectProbeFeature,
  caseProbeFeature,
]);
const { letterInput, letterRow, claimRows, send, usage, pdfBytes, seedDocument } = harness;
let stack: TestStack;

beforeAll(async () => {
  stack = await harness.setup();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.reset();
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: LIMIT_KEY, value: 100_000, scope: "tenant" },
    SYSTEM_ADMIN,
  );
});

function clock() {
  if (stack.clock === undefined) throw new Error("the stack has no manual clock");
  return stack.clock;
}

async function handOver(): Promise<string> {
  const { letterId } = await send(await letterInput());
  await harness.approve(letterId);
  clock().advance({ seconds: 1 });
  await stack.drainJobs();
  return letterId;
}

async function statusOf(letterId: string): Promise<unknown> {
  return (await letterRow(letterId))?.["status"];
}

async function reservations(): Promise<readonly unknown[]> {
  return selectMany(stack.db, capReservationsTable, { tenantId: CLERK.tenantId });
}

/** Approves a letter and starts its handover run, which stops where `park` holds it. */
async function holdRun(park: () => ParkedRun) {
  const { letterId } = await send(await letterInput());
  await harness.approve(letterId);
  // Armed after the approval, which reads the document and the limit itself.
  const parked = park();
  clock().advance({ seconds: 1 });
  const drained = stack.drainJobs();
  await parked.reached;
  return { letterId, parked, drained };
}

describe("an unknown handover keeps its estimate", () => {
  test("the estimate becomes a firm booking and no reservation is left to expire", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-accepted" } });
    const letterId = await handOver();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submissionUnknown);
    expect((await usage()).cost).toBe(109);
    expect(
      await selectMany(stack.db, capReservationsTable, { tenantId: CLERK.tenantId }),
    ).toHaveLength(0);
    expect((await claimRows(letterId))[0]?.["status"]).toBe("estimate-booked");
  });

  test("accepted by hand with the order id: the estimate is replaced by the actual price", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-accepted" } });
    const letterId = await handOver();
    await stack.http.writeOk(
      LetterHandlers.resolveUnknown,
      { letterId, note: NOTE, providerJobId: "sim-1" },
      SYSTEM_ADMIN,
    );
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.accepted);
    expect(row?.["providerJobId"]).toBe("sim-1");
    expect(await usage()).toEqual(ONE_LETTER);
  });

  test("an order id that does not belong to this letter is refused and nothing changes", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-accepted" } });
    const first = await handOver();
    const second = await handOver();
    const unknownId = await stack.http.writeErr(
      LetterHandlers.resolveUnknown,
      { letterId: first, note: NOTE, providerJobId: "sim-99" },
      SYSTEM_ADMIN,
    );
    expect(unknownId.i18nKey).toBe(LetterI18n.providerJobMismatch);
    const otherLetters = await stack.http.writeErr(
      LetterHandlers.resolveUnknown,
      { letterId: first, note: NOTE, providerJobId: "sim-2" },
      SYSTEM_ADMIN,
    );
    expect(otherLetters.i18nKey).toBe(LetterI18n.providerJobMismatch);
    expect(await statusOf(first)).toBe(LETTER_STATE.submissionUnknown);
    expect(await statusOf(second)).toBe(LETTER_STATE.submissionUnknown);
    expect((await usage()).cost).toBe(218);
  });

  test("closing it by hand gives the booked estimate back", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-lost" } });
    const letterId = await handOver();
    await stack.http.writeOk(LetterHandlers.resolveUnknown, { letterId, note: NOTE }, SYSTEM_ADMIN);
    expect(await usage()).toEqual(NOTHING);
    expect(await claimRows(letterId)).toHaveLength(0);
  });
});

describe("the handover job", () => {
  test("a failed run is retried and neither reserves nor submits twice", async () => {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    const read = harness.fileProvider.read.bind(harness.fileProvider);
    let failures = 1;
    harness.fileProvider.read = async (key) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("storage unavailable");
      }
      return read(key);
    };
    try {
      clock().advance({ seconds: 1 });
      await stack.drainJobs();
    } finally {
      harness.fileProvider.read = read;
    }
    expect(failures).toBe(0);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.submit).toBe(1);
    expect(await usage()).toEqual(ONE_LETTER);
    expect(await claimRows(letterId)).toHaveLength(1);
  });

  test("a wrong recognized address cancels the letter right after the handover, without a poll", async () => {
    letterSimulator.setScenario({ misrecognizedAddress: true });
    const letterId = await handOver();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.canceled);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.addressMismatch);
    expect(letterSimulator.calls.cancel).toBe(1);
    expect(letterSimulator.calls.status).toBe(0);
    expect(await usage()).toEqual(NOTHING);
  });
});

describe("cancel before the handover", () => {
  test("a cancel while the run holds its claim and reservation gives both back", async () => {
    const { letterId, parked, drained } = await holdRun(() => harness.parkNextDocumentRead());
    expect(await claimRows(letterId)).toHaveLength(1);
    expect(await reservations()).toHaveLength(1);

    await stack.http.writeOk(LetterHandlers.cancel, { letterId }, CLERK);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.canceled);
    expect(await claimRows(letterId)).toHaveLength(0);
    expect(await reservations()).toHaveLength(0);

    parked.resume("fail");
    await drained;
    expect(await usage()).toEqual(NOTHING);
    expect(await reservations()).toHaveLength(0);
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("a cancel that lands between the claim and the reservation leaves nothing behind", async () => {
    const { letterId, parked, drained } = await holdRun(() => harness.parkNextLimitRead());
    expect(await claimRows(letterId)).toHaveLength(1);

    await stack.http.writeOk(LetterHandlers.cancel, { letterId }, CLERK);
    expect(await claimRows(letterId)).toHaveLength(0);

    // The run reserves for a letter that is canceled by now and must give that back itself.
    parked.resume("continue");
    await drained;
    expect(await statusOf(letterId)).toBe(LETTER_STATE.canceled);
    expect(await claimRows(letterId)).toHaveLength(0);
    expect(await reservations()).toHaveLength(0);
    expect(await usage()).toEqual(NOTHING);
    expect(letterSimulator.calls.submit).toBe(0);
  });
});

describe("a handover run that stopped after taking its reservation", () => {
  test("a reservation that expired meanwhile is replaced, the letter is handed over once", async () => {
    const { letterId, parked, drained } = await holdRun(() => harness.parkNextDocumentRead());
    // The TTL runs on the database clock, so the row is aged by hand.
    await updateMany(
      stack.db,
      capReservationsTable,
      { expiresAt: Temporal.Now.instant().subtract({ minutes: 1 }) },
      { tenantId: CLERK.tenantId },
    );

    parked.resume("fail");
    await drained;
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.submit).toBe(1);
    expect(await usage()).toEqual(ONE_LETTER);
    expect(await reservations()).toHaveLength(0);
    expect(await claimRows(letterId)).toHaveLength(1);
  });

  test("a run that stopped after reserving finds the id stored at its claim and replaces the reservation", async () => {
    const { letterId, parked, drained } = await holdRun(() => harness.parkNextDocumentRead());
    expect(await reservations()).toHaveLength(1);

    parked.resume("fail");
    await drained;
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.submit).toBe(1);
    expect(await usage()).toEqual(ONE_LETTER);
    expect(await reservations()).toHaveLength(0);
  });

  test("a run that stopped before reserving leaves an id without a reservation, which the next run replaces", async () => {
    const { letterId, parked, drained } = await holdRun(() => harness.parkNextLimitRead());
    await updateMany(
      stack.db,
      letterSubmissionTable,
      {
        reservationId: crypto.randomUUID(),
        periodStart: currentCalendarMonthStartIso(clock().now()),
      },
      { letterId },
    );

    parked.resume("continue");
    await drained;
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.submit).toBe(1);
    expect(await usage()).toEqual(ONE_LETTER);
    expect(await reservations()).toHaveLength(0);
    expect(await claimRows(letterId)).toHaveLength(1);
  });

  test("the retry reserves again, so a limit lowered meanwhile fails the letter", async () => {
    const { letterId, parked, drained } = await holdRun(() => harness.parkNextDocumentRead());
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: LIMIT_KEY, value: 50, scope: "tenant" },
      SYSTEM_ADMIN,
    );

    parked.resume("fail");
    await drained;
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.monthlyLimit);
    expect(letterSimulator.calls.submit).toBe(0);
    expect(await claimRows(letterId)).toHaveLength(0);
    expect(await reservations()).toHaveLength(0);
    expect(await usage()).toEqual(NOTHING);
  });
});

describe("a rejection from the wrong state", () => {
  async function reject(letterId: string, failureReason: string): Promise<void> {
    // No event delivery: the approved letter's own submit job must stay out of it.
    await harness.runJobWithoutEventDelivery(REJECT_PROBE_JOB, {
      letterId,
      failureReason,
      tenantId: CLERK.tenantId,
    });
  }

  test("a reason from before the handover is ignored once the provider has the letter", async () => {
    const letterId = await handOver();
    await reject(letterId, LETTER_FAILURE_REASON.monthlyLimit);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(await usage()).toEqual(ONE_LETTER);
    expect(await claimRows(letterId)).toHaveLength(1);
  });

  test("reasons from before the handover are ignored for an unknown handover", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-accepted" } });
    const letterId = await handOver();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submissionUnknown);
    for (const reason of [
      LETTER_FAILURE_REASON.monthlyLimit,
      LETTER_FAILURE_REASON.documentUnreadable,
    ]) {
      await reject(letterId, reason);
      expect(await statusOf(letterId)).toBe(LETTER_STATE.submissionUnknown);
      expect((await usage()).cost).toBe(109);
      expect(await claimRows(letterId)).toHaveLength(1);
    }
  });

  test("a rejection by the provider is ignored while the letter is still approved", async () => {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    await reject(letterId, LETTER_FAILURE_REASON.rejectedByProvider);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.approved);
  });

  test("a rejection by the provider settles the claim of an unknown handover", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-accepted" } });
    const letterId = await handOver();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submissionUnknown);
    await reject(letterId, LETTER_FAILURE_REASON.rejectedByProvider);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.failed);
    expect(await usage()).toEqual(NOTHING);
    expect(await claimRows(letterId)).toHaveLength(0);
  });
});

describe("document size", () => {
  test("oversized parts stop the approval before a later part is read", async () => {
    const big = await pdfBytes(3);
    letterSimulator.setCapabilities({ maxBytes: big.length + 10 });
    const { letterId } = await send(
      await letterInput({
        fileRefIds: [
          await seedDocument(big),
          await seedDocument(big),
          await seedDocument(new Uint8Array([1, 2, 3])),
        ],
      }),
    );
    const refused = await stack.http.writeErr(LetterHandlers.approve, { letterId }, APPROVER);
    expect(refused.i18nKey).toBe(LetterI18n.documentRejected);
  });
});

describe("a letter that stays in approved", () => {
  async function approveWithoutDraining(): Promise<string> {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    return letterId;
  }

  async function restartRequests(): Promise<number> {
    const events = await selectMany<Record<string, unknown>>(stack.db, eventsTable, {});
    return events.filter((event) => event["type"] === LetterEvents.handoverRestartRequested).length;
  }

  // The approved event's run ends for good before the handover (an unrecoverable read error skips the
  // retries): the letter stays in `approved` with its claim, and the event is consumed.
  async function approveWithFailedRun(): Promise<string> {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    const read = harness.fileProvider.read.bind(harness.fileProvider);
    harness.fileProvider.read = async () => {
      throw new UnrecoverableError("storage unavailable");
    };
    try {
      clock().advance({ seconds: 1 });
      await expect(stack.drainJobs()).rejects.toThrow("storage unavailable");
    } finally {
      harness.fileProvider.read = read;
    }
    expect(await statusOf(letterId)).toBe(LETTER_STATE.approved);
    expect(letterSimulator.calls.submit).toBe(0);
    return letterId;
  }

  test("past the give-up time the poll fails the letter and gives its claim and reservation back", async () => {
    const letterId = await approveWithFailedRun();
    expect(await claimRows(letterId)).toHaveLength(1);
    expect(await reservations()).toHaveLength(1);

    clock().advance({ milliseconds: HOLD_MS + LETTER_HANDOVER_GIVE_UP_MS + 1_000 });
    await harness.runJobWithoutEventDelivery(LetterJobs.poll);
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.handoverStalled);
    expect(await restartRequests()).toBe(0);
    expect(await reservations()).toHaveLength(0);
    expect(await claimRows(letterId)).toHaveLength(0);
    expect(await usage()).toEqual(NOTHING);
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("the poll asks for a restart once the hold time and 30 minutes have passed; the submit job hands it over", async () => {
    const letterId = await approveWithFailedRun();

    clock().advance({ milliseconds: HOLD_MS + LETTER_APPROVED_STALE_MS + 1_000 });
    await harness.runJobWithoutEventDelivery(LetterJobs.poll);
    expect(await restartRequests()).toBe(1);
    expect(letterSimulator.calls.submit).toBe(0);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.approved);

    await stack.drainJobs();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.submit).toBe(1);
    expect(await usage()).toEqual(ONE_LETTER);
    expect(await reservations()).toHaveLength(0);
    expect(await claimRows(letterId)).toHaveLength(1);
  });

  test("a letter one second short of the limit gets no restart request, one just past it does", async () => {
    await approveWithoutDraining();
    clock().advance({ milliseconds: HOLD_MS + LETTER_APPROVED_STALE_MS - 1_000 });
    await harness.runJobWithoutEventDelivery(LetterJobs.poll);
    expect(await restartRequests()).toBe(0);

    clock().advance({ seconds: 2 });
    await harness.runJobWithoutEventDelivery(LetterJobs.poll);
    expect(await restartRequests()).toBe(1);
  });
});

describe("cancelLetterBeforeHandover from another feature", () => {
  const canceledEvents = async () =>
    (await selectMany<Record<string, unknown>>(stack.db, eventsTable, {})).filter(
      (event) => event["type"] === LetterEvents.canceled,
    ).length;
  const drop = (letterId: string) =>
    stack.http.writeOk<{ canceled: boolean }>(DROP_LETTER, { letterId }, CASE_WORKER);

  test("cancels a waiting letter without the approver or an admin role and writes the event", async () => {
    const { letterId } = await send(await letterInput());
    expect((await drop(letterId)).canceled).toBe(true);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.canceled);
    expect(await canceledEvents()).toBe(1);
  });

  test("cancels an approved letter that holds a claim and gives the claim back", async () => {
    const { letterId, parked, drained } = await holdRun(() => harness.parkNextDocumentRead());
    expect(await claimRows(letterId)).toHaveLength(1);

    expect((await drop(letterId)).canceled).toBe(true);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.canceled);
    expect(await claimRows(letterId)).toHaveLength(0);
    expect(await reservations()).toHaveLength(0);

    parked.resume("fail");
    await drained;
  });

  test("leaves a letter that was handed over alone", async () => {
    const letterId = await handOver();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect((await drop(letterId)).canceled).toBe(false);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
  });

  test("an unknown letter is not found", async () => {
    const result = await stack.http.writeErr(
      DROP_LETTER,
      { letterId: crypto.randomUUID() },
      CASE_WORKER,
    );
    expect(result.httpStatus).toBe(404);
  });

  test("the cancel is rolled back when the calling handler fails afterwards", async () => {
    const { letterId } = await send(await letterInput());
    const result = await stack.http.writeErr(
      DROP_LETTER,
      { letterId, failAfterwards: true },
      CASE_WORKER,
    );
    expect(result.httpStatus).toBe(422);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.awaitingApproval);
    expect(await canceledEvents()).toBe(0);
  });

  test("the handler itself is not reachable over HTTP, whatever the role", async () => {
    const { letterId } = await send(await letterInput());
    for (const user of [CLERK, APPROVER, CASE_WORKER]) {
      const refused = await stack.http.writeErr(
        LetterInternalHandlers.cancelBeforeHandover,
        { letterId },
        user,
      );
      expect(refused.httpStatus).toBe(404);
    }
    expect(await statusOf(letterId)).toBe(LETTER_STATE.awaitingApproval);
  });
});
