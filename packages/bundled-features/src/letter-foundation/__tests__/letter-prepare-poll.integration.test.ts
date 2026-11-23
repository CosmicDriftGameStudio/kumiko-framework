// The poll's budget for stale unprepared letters goes to letters that need it, not to prepared ones.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { LETTER_PREPARE_STALE_MS, LetterJobs } from "../constants.ts";
import { CLERK, createLetterHarness } from "./letter-harness.ts";

// Mirrors POLL_SLOT_MS of the poll job, which is not exported.
const POLL_SLOT_MS = 5 * 60_000;

// A limit of 4 leaves the stale-prepare step a budget of one letter per run.
const harness = createLetterHarness({ handoverHoldMs: 0, pollLimitPerRun: 4 });
const { letterInput, letterRow, send } = harness;
let stack: TestStack;

beforeAll(async () => {
  stack = await harness.setup();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.reset();
});

describe("poll of letters the prepare job missed", () => {
  test("prepared letters do not take the budget of the one that was missed", async () => {
    const preparedIds: string[] = [];
    for (let count = 0; count < 3; count += 1) {
      preparedIds.push((await send(await letterInput(), CLERK)).letterId);
    }
    await stack.drainJobs();
    const { letterId: missed } = await send(await letterInput(), CLERK);
    if (stack.clock === undefined) throw new Error("the stack has no clock");

    // insertedAt is the real time of the send event, so the stack clock is set relative to it.
    // The poll reads page `slot % pages` of the candidates sorted by id; the slot is moved so that a
    // poll without the null filters (four candidates, one per page) would read a prepared letter.
    const oldFilterPages = preparedIds.length + 1;
    const missedIndex = [...preparedIds, missed].sort().indexOf(missed);
    const wantedPage = (missedIndex + 1) % oldFilterPages;
    const earliest = Temporal.Now.instant().add({ milliseconds: LETTER_PREPARE_STALE_MS + 60_000 });
    const earliestSlot = Math.floor(earliest.epochMilliseconds / POLL_SLOT_MS);
    const slotsToWait =
      (wantedPage - (earliestSlot % oldFilterPages) + oldFilterPages) % oldFilterPages;
    stack.clock.set(earliest.add({ milliseconds: slotsToWait * POLL_SLOT_MS }));
    await harness.runJobWithoutEventDelivery(LetterJobs.poll);

    expect(typeof (await letterRow(missed))?.["mergedFileRefId"]).toBe("string");
    for (const letterId of preparedIds) {
      expect(typeof (await letterRow(letterId))?.["mergedFileRefId"]).toBe("string");
    }
  });
});
