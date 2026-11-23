// A letter is prepared (merged PDF, page and sheet count, price) right after it was sent, before anyone approves it.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTenantDb } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import {
  LETTER_PREPARE_STALE_MS,
  LETTER_STATE,
  type LetterApprovalMode,
  LetterErrors,
  LetterHandlers,
  LetterI18n,
  LetterJobs,
  LetterQueries,
} from "../constants.ts";
import {
  APPROVER,
  CLERK,
  createLetterHarness,
  SEND,
  SYSTEM_ADMIN,
  TENANT,
} from "./letter-harness.ts";

// No hold time: an automatically approved letter is handed over at once instead of the drain waiting for it.
const harness = createLetterHarness({ handoverHoldMs: 0 });
const { letterInput, letterRow, pdfBytes, seedDocument, send, setLimit } = harness;
let stack: TestStack;

// 3 pages duplex are 2 sheets: 85 + 2 * 12 cents at the simulator.
const LETTER_PRICE = 109;

beforeAll(async () => {
  stack = await harness.setup();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.reset();
});

async function sendAndPrepare(
  overrides: Parameters<typeof letterInput>[0] = {},
  approval: LetterApprovalMode = "manual",
) {
  const { letterId } = await send(await letterInput(overrides), CLERK, approval);
  await stack.drainJobs();
  return letterId;
}

async function storedFileCount(): Promise<number> {
  const db = createTenantDb({
    db: stack.db,
    tenantId: TENANT,
    mode: "system",
    reason: "test counts the stored files",
  });
  return (await selectMany<Record<string, unknown>>(db, fileRefsTable, {})).length;
}

describe("preparation after send", () => {
  test("a waiting letter carries the merged document, counts and price once the created event is delivered", async () => {
    const letterId = await sendAndPrepare();

    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    expect(row?.["mergedFileRefId"]).toBeTruthy();
    expect(row?.["pageCount"]).toBe(3);
    expect(row?.["sheetCount"]).toBe(2);
    expect(Number(row?.["quotedNet"])).toBe(LETTER_PRICE);
    expect(row?.["preparationIssue"] ?? null).toBeNull();
    expect(row?.["approvalMode"]).toBe("manual");
  });

  test("the preview reads the stored values and does not ask the provider again", async () => {
    const letterId = await sendAndPrepare();
    expect(letterSimulator.calls.quote).toBe(1);

    const preview = await stack.http.queryOk<{
      totalNet: { amount: number };
      mergedFileRefId?: string;
      preparationIssue?: string;
    }>(LetterQueries.preview, { letterId }, APPROVER);

    expect(preview.totalNet.amount).toBe(LETTER_PRICE);
    expect(preview.mergedFileRefId).toBe(String((await letterRow(letterId))?.["mergedFileRefId"]));
    expect(preview.preparationIssue).toBeUndefined();
    expect(letterSimulator.calls.quote).toBe(1);
  });

  test("approving a prepared letter neither prices nor uploads again", async () => {
    await setLimit(100_000);
    const letterId = await sendAndPrepare();
    const filesBefore = await storedFileCount();
    const mergedBefore = (await letterRow(letterId))?.["mergedFileRefId"];

    await harness.approve(letterId);

    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.approved);
    expect(row?.["approvedBy"]).toBe(APPROVER.id);
    expect(row?.["mergedFileRefId"]).toBe(mergedBefore);
    expect(letterSimulator.calls.quote).toBe(1);
    expect(await storedFileCount()).toBe(filesBefore);
  });

  test("a document fault is stored as the preparation issue and approval reports the real error", async () => {
    letterSimulator.setCapabilities({ maxSheets: 1 });
    const letterId = await sendAndPrepare({
      fileRefIds: [await seedDocument(await pdfBytes(5))],
    });

    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    expect(row?.["preparationIssue"]).toBe(LetterErrors.tooManySheets);
    expect(row?.["mergedFileRefId"] ?? null).toBeNull();

    const error = await stack.http.writeErr(LetterHandlers.approve, { letterId }, APPROVER);
    expect(error.i18nKey).toBe(LetterI18n.tooManySheets);
  });
});

describe("automatic approval", () => {
  test("a prepared letter is approved without an approver, in the sender's name", async () => {
    await setLimit(100_000);
    const letterId = await sendAndPrepare({}, "auto");

    const row = await letterRow(letterId);
    expect(row?.["status"]).not.toBe(LETTER_STATE.awaitingApproval);
    expect(row?.["approvedAt"]).toBeTruthy();
    expect(row?.["approvedBy"]).toBe(CLERK.id);
    expect(row?.["approvalMode"]).toBe("auto");
  });

  test("a limit that does not cover the letter keeps it waiting until someone approves it", async () => {
    await setLimit(50);
    const letterId = await sendAndPrepare({}, "auto");

    const waiting = await letterRow(letterId);
    expect(waiting?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    expect(waiting?.["preparationIssue"]).toBe(LetterErrors.monthlyLimitNotCovered);
    expect(Number(waiting?.["quotedNet"])).toBe(LETTER_PRICE);

    await setLimit(100_000);
    await harness.approve(letterId);

    const approved = await letterRow(letterId);
    expect(approved?.["status"]).toBe(LETTER_STATE.approved);
    expect(approved?.["approvedBy"]).toBe(APPROVER.id);
    expect(approved?.["preparationIssue"] ?? null).toBeNull();
  });

  test("an approval sent in the payload of an app handler is ignored", async () => {
    await setLimit(100_000);
    const input = { ...(await letterInput()), approval: "auto" };
    const { letterId } = await stack.http.writeOk<{ letterId: string }>(SEND, input, CLERK);
    await stack.drainJobs();

    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    expect(row?.["approvalMode"]).toBe("manual");
  });

  test("a document fault stops automatic approval", async () => {
    await setLimit(100_000);
    letterSimulator.setCapabilities({ maxSheets: 1 });
    const letterId = await sendAndPrepare(
      { fileRefIds: [await seedDocument(await pdfBytes(5))] },
      "auto",
    );

    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    expect(row?.["preparationIssue"]).toBe(LetterErrors.tooManySheets);
  });
});

describe("a letter the prepare job never reached", () => {
  test("the poll prepares it once it is older than the stale time, and not before", async () => {
    const { letterId } = await send(await letterInput(), CLERK);
    const clock = () => {
      if (stack.clock === undefined) throw new Error("the stack has no clock");
      return stack.clock;
    };

    // insertedAt is the real time of the send event, so the stack clock is set relative to it.
    const sentAt = Temporal.Now.instant();
    clock().set(sentAt.add({ milliseconds: LETTER_PREPARE_STALE_MS - 60_000 }));
    await harness.runJobWithoutEventDelivery(LetterJobs.poll);
    expect((await letterRow(letterId))?.["mergedFileRefId"]).toBeFalsy();

    clock().set(sentAt.add({ milliseconds: LETTER_PREPARE_STALE_MS + 60_000 }));
    await harness.runJobWithoutEventDelivery(LetterJobs.poll);
    const row = await letterRow(letterId);
    expect(row?.["mergedFileRefId"]).toBeTruthy();
    expect(Number(row?.["quotedNet"])).toBe(LETTER_PRICE);
  });
});

describe("approve many", () => {
  test("approves all letters in one go", async () => {
    await setLimit(100_000);
    const letterIds = [await sendAndPrepare(), await sendAndPrepare(), await sendAndPrepare()];

    const result = await stack.http.writeOk<{ approved: number }>(
      LetterHandlers.approveMany,
      { letterIds },
      APPROVER,
    );

    expect(result.approved).toBe(3);
    for (const letterId of letterIds) {
      const row = await letterRow(letterId);
      expect(row?.["status"]).toBe(LETTER_STATE.approved);
      expect(row?.["approvedBy"]).toBe(APPROVER.id);
    }
  });

  test("a limit that covers one letter but not all of them approves none", async () => {
    await setLimit(LETTER_PRICE + 10);
    const letterIds = [await sendAndPrepare(), await sendAndPrepare()];

    const error = await stack.http.writeErr(LetterHandlers.approveMany, { letterIds }, APPROVER);

    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe(LetterI18n.monthlyLimitNotCovered);
    expect(propertyOf(error.details, "priceCents")).toBe(2 * LETTER_PRICE);
    for (const letterId of letterIds) {
      expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    }
  });

  test("a letter that is not prepared stops the whole selection", async () => {
    await setLimit(100_000);
    const prepared = await sendAndPrepare();
    const { letterId: unprepared } = await send(await letterInput(), CLERK);

    const error = await stack.http.writeErr(
      LetterHandlers.approveMany,
      { letterIds: [prepared, unprepared] },
      APPROVER,
    );

    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe(LetterI18n.notReadyForApproval);
    expect(propertyOf(error.details, "count")).toBe(1);
    expect((await letterRow(prepared))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
  });

  test("a letter with a document fault is not ready", async () => {
    await setLimit(100_000);
    letterSimulator.setCapabilities({ maxSheets: 1 });
    const faulty = await sendAndPrepare({ fileRefIds: [await seedDocument(await pdfBytes(5))] });

    const error = await stack.http.writeErr(
      LetterHandlers.approveMany,
      { letterIds: [faulty] },
      APPROVER,
    );

    expect(error.i18nKey).toBe(LetterI18n.notReadyForApproval);
  });

  test("an unknown or foreign letter is not found", async () => {
    await setLimit(100_000);
    const own = await sendAndPrepare();
    const stranger = createTestUser({
      id: 9,
      tenantId: testTenantId(12),
      roles: ["LetterApprover"],
    });

    const unknown = await stack.http.writeErr(
      LetterHandlers.approveMany,
      { letterIds: [own, crypto.randomUUID()] },
      APPROVER,
    );
    const foreign = await stack.http.writeErr(
      LetterHandlers.approveMany,
      { letterIds: [own] },
      stranger,
    );

    expect(unknown.httpStatus).toBe(404);
    expect(foreign.httpStatus).toBe(404);
    expect((await letterRow(own))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
  });
});

describe("budget", () => {
  test("shows the limit and what approved letters already use", async () => {
    await setLimit(5_000);
    const letterId = await sendAndPrepare();
    const budget = () =>
      stack.http.queryOk<{ limitCents: number; usedCents: number }>(
        LetterQueries.budget,
        {},
        APPROVER,
      );

    expect(await budget()).toEqual({ limitCents: 5_000, usedCents: 0 });
    await harness.approve(letterId);
    expect(await budget()).toEqual({ limitCents: 5_000, usedCents: LETTER_PRICE });
  });

  test("is open to the tenant admin, not to a plain user", async () => {
    await setLimit(5_000);

    const asAdmin = await stack.http.queryOk<{ limitCents: number }>(
      LetterQueries.budget,
      {},
      SYSTEM_ADMIN,
    );
    const asUser = await stack.http.queryErr(
      LetterQueries.budget,
      {},
      createTestUser({ id: 8, tenantId: TENANT, roles: ["User"] }),
    );

    expect(asAdmin.limitCents).toBe(5_000);
    expect(asUser.httpStatus).toBe(403);
  });
});
