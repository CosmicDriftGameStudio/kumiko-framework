import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { CONNECTOR_CLIENT_ID } from "../constants.ts";
import {
  approve,
  postForm,
  START_PATH,
  setupConnectorsStack,
  startPairing,
  teardownConnectorsStack,
} from "./connectors-stack.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupConnectorsStack({ pairingLimits: { maxOpenPerIp: 3, maxOpenTotal: 4 } });
});
afterAll(() => teardownConnectorsStack(stack));

const start = () => postForm(stack, START_PATH, { client_id: CONNECTOR_CLIENT_ID });

describe("connectors pairing flood protection", () => {
  test("a fourth open request from one address is refused; a confirmed one frees a place", async () => {
    const first = await startPairing(stack);
    await startPairing(stack);
    await startPairing(stack);

    const refused = await start();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "slow_down" });
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(refused.headers.get("cache-control")).toBe("no-store");

    await approve(stack, first.user_code);
    expect((await start()).status).toBe(200);
  });

  test("an expired request frees its place", async () => {
    stack.clock?.advance({ seconds: 601 });
    expect((await start()).status).toBe(200);
  });
});

describe("connectors pairing global cap", () => {
  let capped: TestStack;
  beforeAll(async () => {
    capped = await setupConnectorsStack({ pairingLimits: { maxOpenTotal: 2 } });
  });
  afterAll(() => teardownConnectorsStack(capped));

  test("the overall cap refuses a start although the address has places left", async () => {
    await startPairing(capped);
    await startPairing(capped);
    const refused = await postForm(capped, START_PATH, { client_id: CONNECTOR_CLIENT_ID });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "slow_down" });
  });
});
