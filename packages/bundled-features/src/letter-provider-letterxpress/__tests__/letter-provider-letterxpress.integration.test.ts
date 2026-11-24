// The LetterXpress feature mounted next to the inmemory provider in a real stack. Nothing here may
// reach the network: outside production the simulator runs, whatever the live switch says.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConfigHandlers } from "../../config/index.ts";
import {
  APPROVER,
  createLetterHarness,
  LIMIT_KEY,
  SYSTEM_ADMIN,
} from "../../letter-foundation/__tests__/letter-harness.ts";
import {
  LETTER_INMEMORY_PROVIDER,
  LETTER_PROVIDER_EXTENSION,
  LETTER_STATE,
  LetterJobs,
  LetterQueries,
} from "../../letter-foundation/constants.ts";
import {
  LetterProviderNotConfiguredError,
  resolveLetterProvider,
  selectLetterProvider,
} from "../../letter-foundation/provider-resolver.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import {
  LETTERXPRESS_API_KEY_CONFIG,
  LETTERXPRESS_HOST,
  LETTERXPRESS_PROVIDER_NAME,
  LETTERXPRESS_USERNAME_CONFIG,
} from "../constants.ts";
import { createLetterProviderLetterXpressFeature } from "../feature.ts";

const harness = createLetterHarness({ handoverHoldMs: 300 }, [
  createLetterProviderLetterXpressFeature(),
]);
const { letterInput, letterRow, send } = harness;
let stack: TestStack;

const originalFetch = globalThis.fetch;
let requestedUrls: string[] = [];

const inProduction = <T>(run: () => Promise<T>) => withEnv({ NODE_ENV: "production" }, run);

async function setSystemConfig(key: string, value: string): Promise<void> {
  await stack.http.writeOk(ConfigHandlers.set, { key, value, scope: "system" }, SYSTEM_ADMIN);
}

async function setCredentials(): Promise<void> {
  await setSystemConfig(LETTERXPRESS_USERNAME_CONFIG.name, "api-user");
  await setSystemConfig(LETTERXPRESS_API_KEY_CONFIG.name, "api-key-value");
}

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

  test("outside production the simulator is selected although the live switch is on", async () => {
    await harness.setLive(true);
    await setCredentials();
    const selected = await selectLetterProvider(harness.providerSelectionContext());
    expect(selected.name).toBe(LETTER_INMEMORY_PROVIDER);
    expect(selected.live).toBe(false);
  });

  test("in production with the switch off the provider is refused", async () => {
    await setCredentials();
    await expect(
      inProduction(() => selectLetterProvider(harness.providerSelectionContext())),
    ).rejects.toThrow(LetterProviderNotConfiguredError);
  });

  test("in production with the switch on and credentials set letterxpress is built as live", async () => {
    await harness.setLive(true);
    await setCredentials();
    const resolved = await inProduction(() =>
      resolveLetterProvider(harness.providerSelectionContext()),
    );
    expect(resolved.name).toBe(LETTERXPRESS_PROVIDER_NAME);
    expect(resolved.live).toBe(true);
    expect(resolved.capabilities.shippingModes).toEqual(["standard", "einwurf", "uebergabe"]);
  });

  test("in production with the switch on but no api key the build is refused", async () => {
    await harness.setLive(true);
    await setSystemConfig(LETTERXPRESS_USERNAME_CONFIG.name, "api-user");
    await expect(
      inProduction(() => resolveLetterProvider(harness.providerSelectionContext())),
    ).rejects.toThrow(LetterProviderNotConfiguredError);
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

type RecordedRequest = {
  readonly method: string;
  readonly url: string;
  readonly body: { readonly auth?: Record<string, unknown> };
};

const submitAnswer = {
  status: 200,
  message: "OK",
  data: {
    id: 10000001,
    status: "queue",
    notice: "letter-ref",
    items: [
      {
        address: "Erika Mustermann, Musterstraße 12, 12345 Musterstadt",
        pages: 3,
        amount: 0.91,
        vat: 0.17,
        status: "hold",
      },
    ],
  },
};

function answerLetterXpress(requests: RecordedRequest[]): void {
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      const body: RecordedRequest["body"] = JSON.parse(String(init?.body ?? "{}"));
      requests.push({ method: init?.method ?? "GET", url, body });
      const answer = url.endsWith("/price") ? { status: 200, data: { price: 1.08 } } : submitAnswer;
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
}

describe("letter-provider-letterxpress through the real handler and job context", () => {
  beforeEach(async () => {
    await harness.setLive(true);
    await setCredentials();
    await harness.setLimit(100_000);
  });

  test("the submit job calls LetterXpress with the stored credentials and mode live", async () => {
    const requests: RecordedRequest[] = [];
    answerLetterXpress(requests);
    const letterId = await inProduction(async () => {
      const { letterId } = await send(await letterInput());
      await harness.approve(letterId);
      stack.clock?.advance({ seconds: 1 });
      await stack.drainJobs();
      return letterId;
    });

    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.accepted);
    const submit = requests.find((request) => request.url.endsWith("/printjobs"));
    expect(submit?.method).toBe("POST");
    expect(submit?.url).toBe(`https://${LETTERXPRESS_HOST}/v3/printjobs`);
    expect(submit?.body.auth).toEqual({
      username: "api-user",
      apikey: "api-key-value",
      mode: "live",
    });
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("a user who is only LetterApprover previews in production, the system secrets are read regardless of roles", async () => {
    const requests: RecordedRequest[] = [];
    answerLetterXpress(requests);
    await inProduction(async () => {
      const { letterId } = await send(await letterInput());
      await stack.http.queryOk(LetterQueries.preview, { letterId }, APPROVER);
    });
    expect(requests.some((request) => request.url.endsWith("/price"))).toBe(true);
  });
});
