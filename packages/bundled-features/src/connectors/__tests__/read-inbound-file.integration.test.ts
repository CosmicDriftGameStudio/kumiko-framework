import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { ConnectorHandlers, INBOUND_ITEM_CREATED_EVENT } from "../constants.ts";
import { INBOUND_FILE_FAILURE, readInboundFile } from "../read-inbound-file.ts";
import { runConnectorJobs, uploadConnectorFile } from "../testing.ts";
import {
  checkCode,
  pairDevice,
  pollToken,
  setupConnectorsStack,
  startPairing,
  teardownConnectorsStack,
  tenantAdmin,
} from "./connectors-stack.ts";

const MAX_BYTES = 16;
const READ_HANDLER = "inbound-reaction-fixture:write:read-delivered-file";
const otherTenantAdmin = createTestUser({
  id: 21,
  tenantId: testTenantId(2),
  roles: ["TenantAdmin"],
});
const text = (value: string) => new TextEncoder().encode(value);

const text200 = {
  required: true,
  maxLength: 200,
  personal: false,
  reason: "test_fixture",
} as const;
const receivedEntity = createEntity({
  name: "received-file",
  table: "read_received_files_test",
  fields: {
    inboundItemId: createTextField(text200),
    outcome: createTextField(text200),
    relativePath: createTextField({ ...text200, required: false }),
    connectorName: createTextField({ ...text200, required: false }),
    content: createTextField({ ...text200, required: false }),
    unknownItemOutcome: createTextField(text200),
  },
});
const { table: receivedTable, executor: receivedExecutor } = createEntityExecutor(receivedEntity);

const reactingFeature = defineFeature("inbound-reaction-fixture", (r) => {
  r.entity(receivedEntity);
  r.writeHandler({
    name: "read-delivered-file",
    schema: z.object({ id: z.uuid() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => {
      const file = await readInboundFile(ctx, event.payload.id, { maxBytes: MAX_BYTES });
      return {
        isSuccess: true as const,
        data: file.isSuccess
          ? {
              outcome: "read",
              relativePath: file.data.relativePath,
              content: new TextDecoder().decode(file.data.bytes),
            }
          : { outcome: file.failure },
      };
    },
  });
  r.job({
    name: "record-delivered-file",
    trigger: { on: INBOUND_ITEM_CREATED_EVENT },
    runIn: "worker",
    handler: async (_payload, ctx) => {
      const inboundItemId = ctx.triggerEvent?.aggregateId;
      if (inboundItemId === undefined) return;
      const file = await readInboundFile(ctx, inboundItemId, { maxBytes: MAX_BYTES });
      const unknown = await readInboundFile(ctx, generateId(), { maxBytes: MAX_BYTES });
      const created = await receivedExecutor.create(
        {
          inboundItemId,
          outcome: file.isSuccess ? "read" : file.failure,
          unknownItemOutcome: unknown.isSuccess ? "read" : unknown.failure,
          ...(file.isSuccess && {
            relativePath: file.data.relativePath,
            connectorName: file.data.connectorName ?? "",
            content: new TextDecoder().decode(file.data.bytes),
          }),
        },
        ctx.systemUser,
        ctx.db,
      );
      if (!created.isSuccess) throw new Error("recording the delivered file failed");
    },
  });
});

let stack: TestStack;
let token: string;

const recorded = async (inboundItemId: string) => {
  const rows = await selectMany<{
    outcome: string;
    relativePath: string | null;
    connectorName: string | null;
    content: string | null;
    unknownItemOutcome: string;
  }>(stack.db, receivedTable, { inboundItemId });
  return rows[0];
};

beforeAll(async () => {
  stack = await setupConnectorsStack({ extraFeatures: [reactingFeature] });
  ({ token } = await pairDevice(stack, "Lantek PC"));
});
afterAll(() => teardownConnectorsStack(stack));

describe("a job reacting to a delivered file", () => {
  test("INBOUND_ITEM_CREATED_EVENT fires the job and readInboundFile returns path, name and content", async () => {
    const bytes = text("Q-1;Part A\n");
    const res = await uploadConnectorFile(stack, token, { path: "lantek/2026/parts.csv", bytes });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    await runConnectorJobs(stack);

    expect(await recorded(id)).toMatchObject({
      outcome: "read",
      relativePath: "lantek/2026/parts.csv",
      connectorName: "Lantek PC",
      content: "Q-1;Part A\n",
      unknownItemOutcome: INBOUND_FILE_FAILURE.notFound,
    });
  });

  test("a file above maxBytes is reported as too-large without its content", async () => {
    const bytes = text("x".repeat(MAX_BYTES + 1));
    const res = await uploadConnectorFile(stack, token, { path: "lantek/big.csv", bytes });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    await runConnectorJobs(stack);

    expect(await recorded(id)).toMatchObject({
      outcome: INBOUND_FILE_FAILURE.tooLarge,
      relativePath: null,
      content: null,
    });
  });
});

describe("readInboundFile from a write handler", () => {
  const readViaHandler = (id: string, user: typeof tenantAdmin) =>
    stack.http.writeOk<{ outcome: string; relativePath?: string; content?: string }>(
      READ_HANDLER,
      { id },
      user,
    );

  test("the handler's own user reads path and content of its tenant's file", async () => {
    const res = await uploadConnectorFile(stack, token, {
      path: "lantek/h.csv",
      bytes: text("H;1"),
    });
    const { id } = (await res.json()) as { id: string };
    expect(await readViaHandler(id, tenantAdmin)).toEqual({
      outcome: "read",
      relativePath: "lantek/h.csv",
      content: "H;1",
    });
  });

  test("an item of a second tenant is not-found for the first tenant", async () => {
    const started = await startPairing(stack);
    await checkCode(stack, started.user_code, otherTenantAdmin);
    await stack.http.writeOk(
      ConnectorHandlers.approveDevice,
      { userCode: started.user_code, name: "Other tenant PC" },
      otherTenantAdmin,
    );
    const otherToken = (
      (await (await pollToken(stack, started.device_code)).json()) as { access_token: string }
    ).access_token;
    const res = await uploadConnectorFile(stack, otherToken, {
      path: "other/x.csv",
      bytes: text("X;1"),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    expect((await readViaHandler(id, otherTenantAdmin)).outcome).toBe("read");
    expect(await readViaHandler(id, tenantAdmin)).toEqual({
      outcome: INBOUND_FILE_FAILURE.notFound,
    });
  });

  test("a deleted item is not-found", async () => {
    const res = await uploadConnectorFile(stack, token, {
      path: "lantek/gone.csv",
      bytes: text("G;1"),
    });
    const { id } = (await res.json()) as { id: string };
    await stack.http.writeOk(ConnectorHandlers.deleteFile, { id }, tenantAdmin);

    expect(await readViaHandler(id, tenantAdmin)).toEqual({
      outcome: INBOUND_FILE_FAILURE.notFound,
    });
  });
});
