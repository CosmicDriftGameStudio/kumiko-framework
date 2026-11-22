// Behaviour of the review fixes over the real stack: unknown handover keeps its estimate, an
// address mismatch cancels right after the handover, a retried handover reserves once, and
// resolve-unknown can accept a letter by the provider's order id.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createTenantDb } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { capReservationsTable } from "../../cap-counter/index.ts";
import { ConfigHandlers } from "../../config/index.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import {
  LETTER_APPROVED_STALE_MS,
  LETTER_FAILURE_REASON,
  LETTER_STATE,
  LetterHandlers,
  LetterI18n,
  LetterJobs,
} from "../constants.ts";
import { letterSubmissionTable } from "../entity.ts";
import {
  APPROVER,
  CLERK,
  createLetterHarness,
  LIMIT_KEY,
  SYSTEM_ADMIN,
  TENANT,
} from "./letter-harness.ts";

const HOLD_MS = 300;
const NOTE = "Checked with the provider: the order exists under this id.";
const NOTHING = { cost: 0, count: 0, sheets: 0, pages: 0 };
const ONE_LETTER = { cost: 109, count: 1, sheets: 2, pages: 3 };

const harness = createLetterHarness({ handoverHoldMs: HOLD_MS });
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
  test("a claim left by a handover run that stopped is removed with the cancel", async () => {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    const db = createTenantDb({
      db: stack.db,
      tenantId: TENANT,
      mode: "system",
      reason: "test seeds the claim a stopped handover run leaves",
    });
    await insertOne(db, letterSubmissionTable, {
      id: crypto.randomUUID(),
      idempotencyKey: `claim-${letterId}`,
      letterId,
      status: "claimed",
      claimedAt: clock().now().toString(),
    });
    expect(await claimRows(letterId)).toHaveLength(1);
    await stack.http.writeOk(LetterHandlers.cancel, { letterId }, CLERK);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.canceled);
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

  async function poll(): Promise<void> {
    await stack.jobRunner?.dispatch(LetterJobs.poll, {});
    await stack.drainJobs();
  }

  // The job is not drained, so it never ran: the letter is in the state a letter is in after its retries ran out.
  test("the poll restarts the handover once the hold time and 30 minutes have passed", async () => {
    const letterId = await approveWithoutDraining();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.approved);

    clock().advance({ milliseconds: HOLD_MS + LETTER_APPROVED_STALE_MS + 1_000 });
    await poll();

    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.submit).toBe(1);
    expect(await usage()).toEqual(ONE_LETTER);
    expect(await claimRows(letterId)).toHaveLength(1);
  });

  test("a letter that was approved a short while ago is left to its own job", async () => {
    const letterId = await approveWithoutDraining();
    clock().advance({ minutes: 10 });
    await stack.jobRunner?.dispatch(LetterJobs.poll, {});
    expect(letterSimulator.calls.submit).toBe(0);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.approved);
  });
});
