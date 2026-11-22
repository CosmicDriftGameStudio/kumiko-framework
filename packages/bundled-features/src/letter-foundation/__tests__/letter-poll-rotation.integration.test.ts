// The poll asks at most `pollLimitPerRun` letters per tenant and run. Letters that stay at the
// provider must all be asked within ceil(n / budget) runs, not only the first few by id.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConfigHandlers } from "../../config/index.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import { LETTER_STATE, LetterJobs } from "../constants.ts";
import { createLetterHarness, LIMIT_KEY, SYSTEM_ADMIN } from "./letter-harness.ts";

const BUDGET = 2;
const harness = createLetterHarness({ handoverHoldMs: 300, pollLimitPerRun: BUDGET });
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

describe("poll budget", () => {
  test("three letters at the provider and a budget of two: every letter is asked within two runs", async () => {
    const providerJobIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const { letterId } = await send(await letterInput());
      await harness.approve(letterId);
      clock().advance({ seconds: 1 });
      await stack.drainJobs();
      expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.accepted);
      providerJobIds.push(String((await letterRow(letterId))?.["providerJobId"]));
    }

    // Two runs in two different five-minute slots, both inside the 10-minute cancel window, so no letter leaves the group.
    for (let run = 0; run < 2; run += 1) {
      await stack.jobRunner?.dispatch(LetterJobs.poll, {});
      await stack.drainJobs();
      clock().advance({ minutes: 5 });
    }

    // Pages of two over three letters: each letter exactly once, none twice while another waits.
    for (const providerJobId of providerJobIds) {
      expect(letterSimulator.statusCallsFor(providerJobId)).toBe(1);
    }
  });
});
