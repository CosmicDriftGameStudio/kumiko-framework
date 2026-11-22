// A letter belongs to the provider it was approved with: after the environment switches to another
// provider, the poll, the submit job and cancel leave the letter alone instead of asking the wrong provider.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { capReservationsTable } from "../../cap-counter/index.ts";
import { ConfigHandlers } from "../../config/index.ts";
import {
  createLetterSimulator,
  INMEMORY_CAPABILITIES,
  letterSimulator,
} from "../../letter-provider-inmemory/index.ts";
import {
  LETTER_FAILURE_REASON,
  LETTER_PROVIDER_EXTENSION,
  LETTER_STATE,
  LetterHandlers,
  LetterI18n,
  LetterJobs,
} from "../constants.ts";
import { CLERK, createLetterHarness, LIMIT_KEY, SYSTEM_ADMIN } from "./letter-harness.ts";

const OTHER_PROVIDER = "other";
const otherSimulator = createLetterSimulator();
const otherProviderFeature = defineFeature("letter-provider-other", (r) => {
  r.requires({ features: ["letter-foundation"] });
  r.applyExtension({
    name: LETTER_PROVIDER_EXTENSION,
    entity: OTHER_PROVIDER,
    capabilities: INMEMORY_CAPABILITIES,
    build: async () => otherSimulator.provider,
  });
});

const harness = createLetterHarness({ handoverHoldMs: 300 }, [otherProviderFeature]);
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
  otherSimulator.reset();
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: LIMIT_KEY, value: 100_000, scope: "tenant" },
    SYSTEM_ADMIN,
  );
});

function underOtherProvider<T>(run: () => Promise<T>): Promise<T> {
  return withEnv(
    { NODE_ENV: "production", LETTER_LIVE: "true", LETTER_PROVIDER: OTHER_PROVIDER },
    run,
  );
}

function advance(): void {
  if (stack.clock === undefined) throw new Error("the stack has no manual clock");
  stack.clock.advance({ seconds: 1 });
}

async function acceptedLetter(): Promise<string> {
  const { letterId } = await send(await letterInput());
  await harness.approve(letterId);
  advance();
  await stack.drainJobs();
  expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.accepted);
  return letterId;
}

describe("a letter approved under one provider while another is selected", () => {
  test("the poll asks the provider of the letter, and the other one is left alone", async () => {
    const letterId = await acceptedLetter();
    await harness.runJobWithoutEventDelivery(LetterJobs.poll);
    expect(letterSimulator.calls.status).toBe(1);

    await underOtherProvider(() => harness.runJobWithoutEventDelivery(LetterJobs.poll));
    expect(letterSimulator.calls.status).toBe(1);
    expect(otherSimulator.calls.status).toBe(0);
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.accepted);
    expect(await usage()).toEqual({ cost: 109, count: 1, sheets: 2, pages: 3 });
    expect(await claimRows(letterId)).toHaveLength(1);
  });

  test("an approved letter is failed with provider-changed and never handed over", async () => {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    advance();
    await underOtherProvider(() => stack.drainJobs());

    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.failed);
    expect(row?.["failureReason"]).toBe(LETTER_FAILURE_REASON.providerChanged);
    expect(letterSimulator.calls.submit).toBe(0);
    expect(otherSimulator.calls.submit).toBe(0);
    expect(await usage()).toEqual({ cost: 0, count: 0, sheets: 0, pages: 0 });
    expect(await claimRows(letterId)).toHaveLength(0);
    expect(await selectMany(stack.db, capReservationsTable, { tenantId: CLERK.tenantId })).toEqual(
      [],
    );
  });

  test("cancel of an accepted letter answers 422 and keeps the letter", async () => {
    const letterId = await acceptedLetter();
    const error = await underOtherProvider(() =>
      stack.http.writeErr(LetterHandlers.cancel, { letterId }, CLERK),
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe(LetterI18n.providerChanged);
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.calls.cancel).toBe(0);
    expect(otherSimulator.calls.cancel).toBe(0);
  });
});
