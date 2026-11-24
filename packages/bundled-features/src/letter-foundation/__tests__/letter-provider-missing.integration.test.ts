// In production without the live switch the provider cannot be chosen: sendLetter, preview, approve and cancel answer with a
// readable 422 instead of a crash.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConfigHandlers } from "../../config/index.ts";
import { LETTER_STATE, LetterHandlers, LetterQueries } from "../constants.ts";
import { LETTER_PROVIDER_NOT_CONFIGURED } from "../provider-resolver.ts";
import {
  APPROVER,
  CLERK,
  createLetterHarness,
  LIMIT_KEY,
  SEND,
  SYSTEM_ADMIN,
} from "./letter-harness.ts";

const harness = createLetterHarness({ handoverHoldMs: 300 });
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

function inProductionWithoutLiveSwitch<T>(run: () => Promise<T>): Promise<T> {
  return withEnv({ NODE_ENV: "production" }, run);
}

describe("a provider that is not configured", () => {
  test("sendLetter answers 422 with a readable code", async () => {
    const input = await letterInput();
    const error = await inProductionWithoutLiveSwitch(() =>
      stack.http.writeErr(SEND, input, CLERK),
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe(LETTER_PROVIDER_NOT_CONFIGURED.i18nKey);
  });

  test("preview answers 422 with a readable code", async () => {
    const { letterId } = await send(await letterInput());
    const error = await inProductionWithoutLiveSwitch(() =>
      stack.http.queryErr(LetterQueries.preview, { letterId }, APPROVER),
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe(LETTER_PROVIDER_NOT_CONFIGURED.i18nKey);
  });

  test("approve answers 422, the letter keeps waiting and no claim is made", async () => {
    const { letterId } = await send(await letterInput());
    const error = await inProductionWithoutLiveSwitch(() =>
      stack.http.writeErr(LetterHandlers.approve, { letterId }, APPROVER),
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe(LETTER_PROVIDER_NOT_CONFIGURED.i18nKey);
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    expect(await harness.claimRows(letterId)).toHaveLength(0);
  });

  test("cancel of a letter the provider already has answers 422 and keeps the letter", async () => {
    const { letterId } = await send(await letterInput());
    await harness.approve(letterId);
    stack.clock?.advance({ seconds: 1 });
    await stack.drainJobs();
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.accepted);

    const error = await inProductionWithoutLiveSwitch(() =>
      stack.http.writeErr(LetterHandlers.cancel, { letterId }, CLERK),
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe(LETTER_PROVIDER_NOT_CONFIGURED.i18nKey);
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.accepted);
  });
});
