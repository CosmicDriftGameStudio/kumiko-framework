import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { restoreFetch, routeFetchToStack } from "../../shared/__tests__/fetch-test-utils.ts";
import { keepAccount } from "../static-keep-account.ts";
import {
  type InactivityTestStack,
  KEEP_SECRET,
  KEEP_URL,
  setupInactivityStack,
} from "./inactivity-test-stack.ts";

const START = Temporal.Instant.from("2030-01-15T10:00:00Z");
const FIRST_WARNING_AT = START.toZonedDateTimeISO("UTC")
  .add({ months: 12 })
  .toInstant()
  .subtract({ hours: 30 * 24 });

let t: InactivityTestStack;

beforeAll(async () => {
  t = await setupInactivityStack(() => ({
    rule: { after: { months: 12 }, warnings: [{ days: 30 }, { days: 7 }] },
    keepAccountUrl: KEEP_URL,
    keepAccountTokenSecret: KEEP_SECRET,
    appName: "Acme",
  }));
});

afterAll(async () => {
  await t.stack.cleanup();
});

afterEach(restoreFetch);

beforeEach(async () => {
  await t.reset();
  await t.seedTenantWithOwner();
  routeFetchToStack(t.stack);
});

describe("keepAccount against the real stack", () => {
  test("redeems the mailed link once; a replay and a garbage token fail", async () => {
    await t.runJob();
    t.clock.set(FIRST_WARNING_AT);
    await t.runJob();
    const token = t.tokenInMail(0);

    expect(await keepAccount(token)).toEqual({ kind: "success", data: undefined });

    const replay = await keepAccount(token);
    expect(replay.kind).toBe("failure");
    expect((await keepAccount("not-a-token")).kind).toBe("failure");
  });
});
