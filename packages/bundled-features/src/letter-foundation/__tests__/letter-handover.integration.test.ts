// Handover, acceptance, polling, cancel after acceptance, resolve-unknown, retention and tenant
// deletion over the real stack. The hold time is 300 ms of real delay; the manual clock decides
// whether it has passed, so every test is deterministic.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createFileContext, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createTenantDb } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { capReservationsTable } from "../../cap-counter/index.ts";
import { ConfigHandlers } from "../../config/index.ts";
import { runRetentionCleanup } from "../../data-retention/run-retention-cleanup.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { runTenantDestructionSweep } from "../../tenant-lifecycle/run-tenant-destroy.ts";
import { seedDestroyingTenant } from "../../tenant-lifecycle/testing.ts";
import {
  LETTER_FAILURE_REASON,
  LETTER_STATE,
  LETTER_SUBMITTING_STALE_MS,
  LetterHandlers,
  LetterI18n,
  LetterInternalHandlers,
  LetterJobs,
  LetterQueries,
} from "../constants.ts";
import { CLERK, createLetterHarness, LIMIT_KEY, SYSTEM_ADMIN } from "./letter-harness.ts";

const HOLD_MS = 300;
const NOTE = "Checked with the provider: no order for this reference.";

// A manual job that accepts two letters at the same moment, each in its own transaction.
const acceptTogetherFeature = defineFeature("letter-accept-probe", (r) => {
  r.job({
    name: "accept-together",
    trigger: { manual: true },
    handler: async (payload, ctx) => {
      const { acceptances } = z
        .object({ acceptances: z.array(z.record(z.string(), z.unknown())) })
        .parse(payload);
      const results = await Promise.all(
        acceptances.map((acceptance) =>
          ctx.dispatch.write(LetterInternalHandlers.recordAcceptance, acceptance),
        ),
      );
      for (const result of results) {
        if (!result.isSuccess)
          throw new Error(`acceptance failed: ${JSON.stringify(result.error)}`);
      }
      return undefined;
    },
  });
});

// A nested cancel skips the cancel handler's provider phase, as a cancel does that runs after the handover job moved the letter.
const NESTED_CANCEL = "letter-cancel-probe:write:nested-cancel";
const nestedCancelFeature = defineFeature("letter-cancel-probe", (r) => {
  r.writeHandler({
    name: "nested-cancel",
    schema: z.object({ letterId: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) =>
      ctx.dispatch.write(LetterHandlers.cancel, { letterId: event.payload.letterId }),
  });
});

const harness = createLetterHarness({ handoverHoldMs: HOLD_MS }, [
  acceptTogetherFeature,
  nestedCancelFeature,
]);
const { letterInput, letterRow, claimRows, send, usage } = harness;
let stack: TestStack;

beforeAll(async () => {
  stack = await harness.setup();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.reset();
  await setLimit(100_000);
});

async function setLimit(cents: number): Promise<void> {
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: LIMIT_KEY, value: cents, scope: "tenant" },
    SYSTEM_ADMIN,
  );
}

function clock() {
  if (stack.clock === undefined) throw new Error("the stack has no manual clock");
  return stack.clock;
}

/** Approves a new letter and lets the handover job run once the hold time has passed. */
async function handOver(overrides: Parameters<typeof letterInput>[0] = {}): Promise<string> {
  const { letterId } = await send(await letterInput(overrides));
  await harness.approve(letterId);
  clock().advance({ seconds: 1 });
  await stack.drainJobs();
  return letterId;
}

async function poll(): Promise<void> {
  await stack.jobRunner?.dispatch(LetterJobs.poll, {});
  await stack.drainJobs();
}

async function statusOf(letterId: string): Promise<unknown> {
  return (await letterRow(letterId))?.["status"];
}

async function detailOf(letterId: string) {
  return stack.http.queryOk<Record<string, unknown>>(LetterQueries.detail, { id: letterId }, CLERK);
}

// File refs bound to one field of the letter, with the check that their bytes are still stored.
async function boundFiles(letterId: string, fieldName: string) {
  const db = createTenantDb({
    db: stack.db,
    tenantId: CLERK.tenantId,
    mode: "system",
    reason: "test reads the file refs bound to a letter field",
  });
  const refs = await selectMany<Record<string, unknown>>(db, fileRefsTable, {
    entityId: letterId,
    fieldName,
  });
  return refs.map((ref) => ({
    ref,
    stored: harness.fileProvider.keys().includes(String(ref["storageKey"])),
  }));
}

const NOTHING = { cost: 0, count: 0, sheets: 0, pages: 0 };

describe("handover", () => {
  test("hands the letter over once and books price, piece, sheets and pages", async () => {
    const letterId = await handOver();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.accepted);
    expect(row?.["providerJobId"]).toBe("sim-1");
    expect(Number(row?.["actualNet"])).toBe(109);
    expect(row?.["cancelableUntil"]).toBeDefined();
    expect(letterSimulator.calls.submit).toBe(1);
    expect(letterSimulator.submissions[0]?.reference).toBe(letterId);
    expect(await usage()).toEqual({ cost: 109, count: 1, sheets: 2, pages: 3 });
    const claims = await claimRows(letterId);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.["status"]).toBe("submitted");
  });

  test("the letter waits out the hold time: a cancel during it never reaches the provider", async () => {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    await stack.http.writeOk(LetterHandlers.cancel, { letterId }, CLERK);
    clock().advance({ seconds: 1 });
    await stack.drainJobs();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.canceled);
    expect(letterSimulator.calls.submit).toBe(0);
    expect(await usage()).toEqual(NOTHING);
  });

  test("a document that cannot be read fails the letter before the handover and frees the reservation", async () => {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    harness.fileProvider.clear();
    clock().advance({ seconds: 1 });
    await stack.drainJobs();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.documentUnreadable);
    expect(letterSimulator.calls.submit).toBe(0);
    expect(await claimRows(letterId)).toHaveLength(0);
    expect(await usage()).toEqual(NOTHING);
  });

  test("a repeated job run neither books twice nor calls submit twice", async () => {
    const letterId = await handOver();
    await stack.jobRunner?.dispatch(LetterJobs.submit, { letterId, from: "awaiting-approval" });
    await stack.drainJobs();
    expect(letterSimulator.calls.submit).toBe(1);
    expect(await usage()).toEqual({ cost: 109, count: 1, sheets: 2, pages: 3 });
    expect(await claimRows(letterId)).toHaveLength(1);
  });

  test("a limit lowered after approval stops the letter before the provider is called", async () => {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    await setLimit(50);
    clock().advance({ seconds: 1 });
    await stack.drainJobs();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.monthlyLimit);
    expect(letterSimulator.calls.submit).toBe(0);
    expect(await usage()).toEqual(NOTHING);
    expect(await claimRows(letterId)).toHaveLength(0);
  });

  test("a rejection frees the reservation and keeps the provider's code and message", async () => {
    letterSimulator.setScenario({
      submit: { kind: "reject", code: "invalid-address", message: "Street unknown" },
    });
    const letterId = await handOver();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.rejectedByProvider);
    const detail = await detailOf(letterId);
    expect(String(detail["failureDetail"])).toContain("invalid-address");
    expect(String(detail["failureDetail"])).toContain("Street unknown");
    expect(await usage()).toEqual(NOTHING);
    expect(await claimRows(letterId)).toHaveLength(0);
  });

  test("two acceptances of the same tenant at the same moment add up", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-accepted" } });
    const first = await handOver();
    const second = await handOver();
    expect(await statusOf(first)).toBe(LETTER_STATE.submissionUnknown);
    expect(await statusOf(second)).toBe(LETTER_STATE.submissionUnknown);
    expect((await usage()).cost).toBe(218);

    const acceptances = letterSimulator.orders().map((order) => ({
      letterId: order.submission.reference,
      providerJobId: order.providerJobId,
      actualNet: order.actualNet,
      actualVat: order.actualVat,
    }));
    await stack.jobRunner?.dispatch("letter-accept-probe:job:accept-together", {
      acceptances,
      tenantId: CLERK.tenantId,
    });
    await stack.drainJobs();

    expect(await statusOf(first)).toBe(LETTER_STATE.accepted);
    expect(await statusOf(second)).toBe(LETTER_STATE.accepted);
    expect(await usage()).toEqual({ cost: 218, count: 2, sheets: 4, pages: 6 });
  });
});

describe("a handover without an answer", () => {
  test("a later findByReference hit accepts the letter without a second submit", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-accepted" } });
    const letterId = await handOver();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submissionUnknown);
    expect((await usage()).cost).toBe(109);

    await poll();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.accepted);
    expect(row?.["providerJobId"]).toBe("sim-1");
    expect(letterSimulator.calls.submit).toBe(1);
    expect(letterSimulator.calls.findByReference).toBe(1);
    expect(await usage()).toEqual({ cost: 109, count: 1, sheets: 2, pages: 3 });
  });

  test("without a hit the letter stays unknown, nothing is sent again, a person closes it", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-lost" } });
    const letterId = await handOver();
    await poll();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submissionUnknown);
    expect(letterSimulator.calls.submit).toBe(1);
    expect((await usage()).cost).toBe(109);

    const denied = await stack.http.writeErr(
      LetterHandlers.resolveUnknown,
      { letterId, note: NOTE },
      CLERK,
    );
    expect(denied.httpStatus).toBe(403);
    const noNote = await stack.http.writeErr(
      LetterHandlers.resolveUnknown,
      { letterId, note: "  " },
      SYSTEM_ADMIN,
    );
    expect(noNote.httpStatus).toBeGreaterThanOrEqual(400);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submissionUnknown);

    await stack.http.writeOk(LetterHandlers.resolveUnknown, { letterId, note: NOTE }, SYSTEM_ADMIN);
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.resolvedByOperator);
    expect((await detailOf(letterId))["resolutionNote"]).toBe(NOTE);
    expect(await usage()).toEqual(NOTHING);
    expect(await claimRows(letterId)).toHaveLength(0);

    const events = await selectMany<Record<string, unknown>>(stack.db, eventsTable, {});
    const dump = JSON.stringify(events, (_key, value) =>
      typeof value === "bigint" ? String(value) : value,
    );
    expect(dump).not.toContain(NOTE);

    const again = await stack.http.writeErr(
      LetterHandlers.resolveUnknown,
      { letterId, note: NOTE },
      SYSTEM_ADMIN,
    );
    expect(again.i18nKey).toBe(LetterI18n.notSubmissionUnknown);
  });
});

describe("an unknown handover the provider rejected", () => {
  test("the poll fails the letter, books the estimate back and removes the claim", async () => {
    letterSimulator.setScenario({
      submit: { kind: "timeout-lost" },
      lookupRejection: { code: "invalid-address", message: "Street unknown" },
    });
    const letterId = await handOver();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submissionUnknown);
    expect((await usage()).cost).toBe(109);

    await poll();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.rejectedByProvider);
    expect(await usage()).toEqual(NOTHING);
    expect(await claimRows(letterId)).toHaveLength(0);
    expect(letterSimulator.calls.submit).toBe(1);
  });
});

describe("a handover that never finished", () => {
  // A negative price makes the acceptance fail after the letter is in `submitting`; the retried run leaves it there.
  async function stuckInSubmitting(): Promise<string> {
    letterSimulator.setScenario({ actualNet: { amount: -1, currency: "EUR" } });
    const letterId = await handOver();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submitting);
    expect(letterSimulator.calls.submit).toBe(1);
    return letterId;
  }

  test("the poll marks it unknown once it is stale and books the estimate", async () => {
    const letterId = await stuckInSubmitting();
    clock().advance({ milliseconds: LETTER_SUBMITTING_STALE_MS - 1_000 });
    await poll();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submitting);

    clock().advance({ seconds: 2 });
    await poll();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.submissionUnknown);
    expect((await claimRows(letterId))[0]?.["status"]).toBe("estimate-booked");
    expect(letterSimulator.calls.submit).toBe(1);
  });
});

describe("a late acceptance of an unknown handover", () => {
  test("books the actual price and the units once, next to a later letter", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-accepted" } });
    const late = await handOver();
    expect(await statusOf(late)).toBe(LETTER_STATE.submissionUnknown);
    expect((await usage()).cost).toBe(109);
    expect(
      await selectMany(stack.db, capReservationsTable, { tenantId: CLERK.tenantId }),
    ).toHaveLength(0);

    letterSimulator.setScenario({ submit: { kind: "accept" } });
    const other = await handOver();
    expect(await statusOf(other)).toBe(LETTER_STATE.accepted);
    // The unknown letter's estimate is a firm booking, so it counts next to the later letter.
    expect(await usage()).toEqual({ cost: 218, count: 1, sheets: 2, pages: 3 });

    await poll();
    expect(await statusOf(late)).toBe(LETTER_STATE.accepted);
    expect(await usage()).toEqual({ cost: 218, count: 2, sheets: 4, pages: 6 });
    expect(
      await selectMany(stack.db, capReservationsTable, { tenantId: CLERK.tenantId }),
    ).toHaveLength(0);
    expect(letterSimulator.calls.submit).toBe(2);
  });
});

describe("the envelope", () => {
  test("a flat letter reaches the provider's quote and its submit", async () => {
    const letterId = await handOver({ envelope: "flat" });
    expect((await letterRow(letterId))?.["envelope"]).toBe("flat");
    expect(letterSimulator.quotedSpecs.length).toBeGreaterThan(0);
    for (const spec of letterSimulator.quotedSpecs) expect(spec.envelope).toBe("flat");
    expect(letterSimulator.submissions[0]?.spec.envelope).toBe("flat");
  });
});

describe("polling the provider", () => {
  test("a sent letter gets tracking, its proof as a file and no mismatch flag", async () => {
    const letterId = await handOver({ shippingMode: "einwurf" });
    clock().advance({ minutes: 11 });
    await poll();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.sent);
    expect(row?.["trackingNumber"]).toBe("SIM00000001");
    expect(row?.["trackingStatus"]).toBe("Delivered");
    expect(row?.["addressMismatch"]).toBe(false);
    expect(row?.["sentAt"]).toBeDefined();
    expect(Array.isArray(row?.["proofFileRefIds"]) ? row["proofFileRefIds"] : []).toHaveLength(1);
    const proofs = await boundFiles(letterId, "proofFileRefIds");
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.stored).toBe(true);
    expect((await usage("einwurf")).count).toBe(1);
    expect(await claimRows(letterId)).toHaveLength(0);
  });

  test("a wrong recognized address inside the cancel window: the poll cancels what the handover could not", async () => {
    letterSimulator.setScenario({ misrecognizedAddress: true });
    letterSimulator.setCancelRefusal("window_closed");
    const letterId = await handOver();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.cancel).toBe(1);

    letterSimulator.setCancelRefusal(undefined);
    await poll();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.canceled);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.addressMismatch);
    expect(letterSimulator.calls.cancel).toBe(2);
    expect(await usage()).toEqual(NOTHING);
  });

  test("a wrong recognized address that the handover could not cancel and the window has closed on: only the flag is set", async () => {
    letterSimulator.setScenario({ misrecognizedAddress: true });
    letterSimulator.setCancelRefusal("window_closed");
    const letterId = await handOver();
    letterSimulator.setCancelRefusal(undefined);
    clock().advance({ minutes: 11 });
    await poll();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.sent);
    expect(row?.["addressMismatch"]).toBe(true);
    expect(letterSimulator.calls.cancel).toBe(1);
    expect((await usage()).count).toBe(1);
  });

  test("a wrong recognized address after the window only sets the flag", async () => {
    // Without a cancel window the letter is past it from the start, so the handover job cannot cancel either.
    letterSimulator.setCapabilities({ cancelWindowSeconds: null });
    letterSimulator.setScenario({ misrecognizedAddress: true });
    const letterId = await handOver();
    clock().advance({ minutes: 11 });
    await poll();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.sent);
    expect(row?.["addressMismatch"]).toBe(true);
    expect(letterSimulator.calls.cancel).toBe(0);
    expect((await usage()).count).toBe(1);
  });

  test("an order the provider no longer knows fails the letter and books everything back", async () => {
    const letterId = await handOver();
    const providerJobId = String((await letterRow(letterId))?.["providerJobId"]);
    await letterSimulator.provider.cancel?.(providerJobId);
    await poll();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.notFoundAtProvider);
    expect(await usage()).toEqual(NOTHING);
  });

  test("a letter the provider failed books everything back", async () => {
    letterSimulator.setScenario({ finalState: "failed" });
    const letterId = await handOver();
    clock().advance({ minutes: 11 });
    await poll();
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.failedAtProvider);
    expect(await usage()).toEqual(NOTHING);
  });

  test("a letter that comes back after it was sent is marked returned and books nothing back", async () => {
    const letterId = await handOver();
    clock().advance({ minutes: 11 });
    await poll();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.sent);
    const booked = { cost: 109, count: 1, sheets: 2, pages: 3 };
    expect(await usage()).toEqual(booked);

    letterSimulator.returnOrder(String((await letterRow(letterId))?.["providerJobId"]));
    await poll();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.returned);
    expect(await usage()).toEqual(booked);
  });

  test("a sent letter is no longer polled 14 days after it was sent", async () => {
    const letterId = await handOver();
    clock().advance({ minutes: 11 });
    await poll();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.sent);
    const before = letterSimulator.calls.status;
    clock().advance({ hours: 15 * 24 });
    await poll();
    expect(letterSimulator.calls.status).toBe(before);
  });
});

describe("cancel after acceptance", () => {
  test("inside the window the provider cancels and the counters go back", async () => {
    const letterId = await handOver();
    await stack.http.writeOk(LetterHandlers.cancel, { letterId }, CLERK);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.canceled);
    expect(letterSimulator.calls.cancel).toBe(1);
    expect(await usage()).toEqual(NOTHING);
  });

  test.each([
    ["window_closed", LetterI18n.cancelWindowClosed],
    ["already_processed", LetterI18n.cancelAlreadyProcessed],
    ["unknown_job", LetterI18n.cancelUnknownJob],
  ] as const)("a provider refusal %s becomes its own readable error", async (reason, i18nKey) => {
    const letterId = await handOver();
    letterSimulator.setCancelRefusal(reason);
    const refused = await stack.http.writeErr(LetterHandlers.cancel, { letterId }, CLERK);
    expect(refused.httpStatus).toBe(422);
    expect(refused.i18nKey).toBe(i18nKey);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(await usage()).toEqual({ cost: 109, count: 1, sheets: 2, pages: 3 });
  });

  test("a cancel that never asked the provider does not cancel a letter at the provider", async () => {
    const letterId = await handOver();
    const refused = await stack.http.writeErr(NESTED_CANCEL, { letterId }, CLERK);
    expect(refused.httpStatus).toBe(422);
    expect(refused.i18nKey).toBe(LetterI18n.stateChanged);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.cancel).toBe(0);
    expect(await usage()).toEqual({ cost: 109, count: 1, sheets: 2, pages: 3 });
  });

  test("after the window the cancel is refused with a readable reason", async () => {
    const letterId = await handOver();
    clock().advance({ minutes: 11 });
    const refused = await stack.http.writeErr(LetterHandlers.cancel, { letterId }, CLERK);
    expect(refused.httpStatus).toBe(422);
    expect(refused.i18nKey).toBe(LetterI18n.cancelAfterAcceptanceUnavailable);
    expect(await statusOf(letterId)).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.cancel).toBe(0);
  });
});

describe("personal data in events", () => {
  test("no event carries the address or the name after the handover", async () => {
    await handOver();
    clock().advance({ minutes: 11 });
    await poll();
    const events = await selectMany<Record<string, unknown>>(stack.db, eventsTable, {});
    const dump = JSON.stringify(events, (_key, value) =>
      typeof value === "bigint" ? String(value) : value,
    );
    for (const secret of ["Erika", "Mustermann", "Musterstraße", "Musterstadt", "12345"]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe("retention and tenant deletion", () => {
  test("after the retention period the letter, its PDF and its proofs are gone; source documents stay", async () => {
    const input = await letterInput({ shippingMode: "einwurf" });
    const { letterId } = await send(input);
    await harness.approve(letterId);
    clock().advance({ seconds: 1 });
    await stack.drainJobs();
    clock().advance({ minutes: 11 });
    await poll();
    expect(await statusOf(letterId)).toBe(LETTER_STATE.sent);

    expect(await claimRows()).toHaveLength(0);

    const mergedBefore = await boundFiles(letterId, "mergedFileRefId");
    const proofsBefore = await boundFiles(letterId, "proofFileRefIds");
    expect(mergedBefore.map((file) => file.stored)).toEqual([true]);
    expect(proofsBefore.map((file) => file.stored)).toEqual([true]);

    const farFuture = clock()
      .now()
      .add({ hours: 24 * 365 * 8 });
    const result = await runRetentionCleanup({
      db: stack.db,
      registry: stack.registry,
      tenantId: CLERK.tenantId,
      preloadedTenantPreset: null,
      now: farFuture,
      files: createFileContext(() => Promise.resolve(harness.fileProvider)),
    });
    expect(result.hardDeleted).toBeGreaterThanOrEqual(1);
    expect(await letterRow(letterId)).toBeUndefined();
    expect(await boundFiles(letterId, "mergedFileRefId")).toHaveLength(0);
    expect(await boundFiles(letterId, "proofFileRefIds")).toHaveLength(0);
    const keysAfter = harness.fileProvider.keys();
    for (const file of [...mergedBefore, ...proofsBefore]) {
      expect(keysAfter).not.toContain(String(file.ref["storageKey"]));
    }
    expect(keysAfter.some((key) => key.includes("/letters/doc-"))).toBe(true);
  });

  test("deleting the tenant removes its letters and claims", async () => {
    await harness.seedTenant();
    const letterId = await handOver();
    expect(await claimRows(letterId)).toHaveLength(1);
    await seedDestroyingTenant(stack, CLERK.tenantId);
    const farFuture = Temporal.Now.instant().add({ hours: 24 * 3650 });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await runTenantDestructionSweep({ db: stack.db, registry: stack.registry, now: farFuture });
      const tenants = await selectMany<Record<string, unknown>>(stack.db, tenantTable, {
        id: CLERK.tenantId,
      });
      const status = String(tenants[0]?.["status"]);
      if (status === "destroyed" || status === "destroyFailed") {
        expect(status).toBe("destroyed");
        break;
      }
    }
    expect(await letterRow(letterId)).toBeUndefined();
    expect(await claimRows()).toHaveLength(0);
  });
});
