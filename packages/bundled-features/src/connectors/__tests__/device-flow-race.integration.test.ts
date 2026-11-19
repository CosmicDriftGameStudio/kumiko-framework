import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { ConnectorHandlers } from "../constants.ts";
import { deviceTable } from "../schema/device.ts";
import {
  listConnectors,
  pollToken,
  setupConnectorsStack,
  startPairing,
  teardownConnectorsStack,
  tenantAdmin,
} from "./connectors-stack.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupConnectorsStack();
});
afterAll(() => teardownConnectorsStack(stack));

describe("connectors device flow under concurrency", () => {
  test("parallel polls of one confirmed pairing redeem exactly one token", async () => {
    const started = await startPairing(stack);
    await stack.http.writeOk(
      ConnectorHandlers.approveDevice,
      { userCode: started.user_code, name: "Racy" },
      tenantAdmin,
    );
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => pollToken(stack, started.device_code)),
    );
    const bodies = await Promise.all(
      responses.map((res) => res.json() as Promise<{ error?: string }>),
    );
    expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
    expect(bodies.filter((body) => body.error === "invalid_grant")).toHaveLength(7);
    expect(await selectMany(stack.db, deviceTable, {})).toHaveLength(1);
  });

  test("a code confirmed twice at once creates one connector and one winner", async () => {
    const started = await startPairing(stack);
    const before = (await listConnectors(stack)).length;
    const results = await Promise.all(
      ["Left", "Right"].map((name) =>
        stack.http.write(
          ConnectorHandlers.approveDevice,
          { userCode: started.user_code, name },
          tenantAdmin,
        ),
      ),
    );
    expect(results.filter((res) => res.ok)).toHaveLength(1);
    expect(await listConnectors(stack)).toHaveLength(before + 1);
  });
});
