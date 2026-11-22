// The LetterXpress feature mounted next to the inmemory provider in a real stack. Nothing here may
// reach the network: without the live switch the simulator runs, whatever LETTER_PROVIDER says.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { withEnvForEachTest } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConfigHandlers } from "../../config/index.ts";
import {
  createLetterHarness,
  LIMIT_KEY,
  SYSTEM_ADMIN,
} from "../../letter-foundation/__tests__/letter-harness.ts";
import {
  LETTER_INMEMORY_PROVIDER,
  LETTER_PROVIDER_EXTENSION,
  LETTER_STATE,
  LetterJobs,
} from "../../letter-foundation/constants.ts";
import { selectLetterProvider } from "../../letter-foundation/provider-resolver.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import { LETTERXPRESS_HOST, LETTERXPRESS_PROVIDER_NAME } from "../constants.ts";
import { createLetterProviderLetterXpressFeature } from "../feature.ts";

const harness = createLetterHarness({ handoverHoldMs: 300 }, [
  createLetterProviderLetterXpressFeature(),
]);
const { letterInput, letterRow, send } = harness;
let stack: TestStack;

const originalFetch = globalThis.fetch;
let requestedUrls: string[] = [];

withEnvForEachTest({ LETTER_PROVIDER: LETTERXPRESS_PROVIDER_NAME, LETTER_LIVE: undefined });

beforeAll(async () => {
  stack = await harness.setup();
});

afterAll(async () => {
  await harness.cleanup();
});

beforeEach(async () => {
  await harness.reset();
  requestedUrls = [];
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      requestedUrls.push(String(input instanceof Request ? input.url : input));
      throw new Error("network access is not allowed in this test");
    },
    { preconnect: originalFetch.preconnect },
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("letter-provider-letterxpress in a stack", () => {
  test("registers the plugin next to the simulator", () => {
    const names = stack.registry
      .getExtensionUsages(LETTER_PROVIDER_EXTENSION)
      .map((usage) => usage.entityName)
      .sort();
    expect(names).toEqual([LETTER_INMEMORY_PROVIDER, LETTERXPRESS_PROVIDER_NAME].sort());
  });

  test("without the live switch the simulator is selected although LETTER_PROVIDER names letterxpress", () => {
    const selected = selectLetterProvider(stack.registry);
    expect(selected.name).toBe(LETTER_INMEMORY_PROVIDER);
    expect(selected.live).toBe(false);
  });

  test("with the live switch the letterxpress plugin is selected, without building it", () => {
    const selected = selectLetterProvider(stack.registry, {
      LETTER_LIVE: "true",
      LETTER_PROVIDER: LETTERXPRESS_PROVIDER_NAME,
      NODE_ENV: "production",
    });
    expect(selected.name).toBe(LETTERXPRESS_PROVIDER_NAME);
    expect(selected.live).toBe(true);
    expect(selected.plugin.capabilities.shippingModes).toEqual([
      "standard",
      "einwurf",
      "uebergabe",
    ]);
  });

  test("a letter runs to sent through the simulator and never calls LetterXpress", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: LIMIT_KEY, value: 100_000, scope: "tenant" },
      SYSTEM_ADMIN,
    );
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    stack.clock?.advance({ seconds: 1 });
    await stack.drainJobs();
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.accepted);

    stack.clock?.advance({ minutes: 11 });
    await stack.jobRunner?.dispatch(LetterJobs.poll, {});
    await stack.drainJobs();

    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.sent);
    expect(letterSimulator.calls.submit).toBe(1);
    expect(requestedUrls.filter((url) => url.includes(LETTERXPRESS_HOST))).toEqual([]);
  });
});
