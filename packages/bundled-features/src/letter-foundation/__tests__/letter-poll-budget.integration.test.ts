// Letters with an unknown handover use only a small part of the poll budget, so the letters that
// are known to be at the provider still get their status asked.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConfigHandlers } from "../../config/index.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import { LETTER_STATE, LetterJobs } from "../constants.ts";
import { createLetterHarness, LIMIT_KEY, SYSTEM_ADMIN } from "./letter-harness.ts";

const harness = createLetterHarness({ handoverHoldMs: 300, pollLimitPerRun: 4 });
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

async function handOver(): Promise<string> {
  const { letterId } = await send(await letterInput());
  await harness.approve(letterId);
  stack.clock?.advance({ seconds: 1 });
  await stack.drainJobs();
  return letterId;
}

describe("poll budget", () => {
  test("four unknown letters do not starve a letter that is at the provider", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-lost" } });
    for (let index = 0; index < 4; index += 1) {
      expect((await letterRow(await handOver()))?.["status"]).toBe(LETTER_STATE.submissionUnknown);
    }
    letterSimulator.setScenario({});
    const accepted = await handOver();
    expect((await letterRow(accepted))?.["status"]).toBe(LETTER_STATE.accepted);
    const providerJobId = String((await letterRow(accepted))?.["providerJobId"]);

    await stack.jobRunner?.dispatch(LetterJobs.poll, {});
    await stack.drainJobs();

    expect(letterSimulator.statusCallsFor(providerJobId)).toBe(1);
    expect(letterSimulator.calls.findByReference).toBeLessThan(4);
  });

  test("a lookup dearer than the safety-net budget does not take the budget of the letters at the provider", async () => {
    letterSimulator.setScenario({ submit: { kind: "timeout-lost" } });
    expect((await letterRow(await handOver()))?.["status"]).toBe(LETTER_STATE.submissionUnknown);
    letterSimulator.setScenario({});
    const accepted = await handOver();
    const providerJobId = String((await letterRow(accepted))?.["providerJobId"]);
    letterSimulator.setCapabilities({ lookupRequestsPerLetter: 12 });

    await stack.jobRunner?.dispatch(LetterJobs.poll, {});
    await stack.drainJobs();

    expect(letterSimulator.calls.findByReference).toBe(1);
    expect(letterSimulator.statusCallsFor(providerJobId)).toBe(1);
  });
});
