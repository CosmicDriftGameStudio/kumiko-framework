import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { INBOUND_ITEM_CREATED_EVENT } from "../constants.ts";
import { INBOUND_FILE_FAILURE, readInboundFile } from "../read-inbound-file.ts";
import {
  pairDevice,
  runDeletionJobs,
  setupConnectorsStack,
  teardownConnectorsStack,
  upload,
} from "./connectors-stack.ts";

const MAX_BYTES = 16;
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
    const res = await upload(stack, token, { path: "lantek/2026/parts.csv", bytes });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    await runDeletionJobs(stack);

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
    const res = await upload(stack, token, { path: "lantek/big.csv", bytes });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    await runDeletionJobs(stack);

    expect(await recorded(id)).toMatchObject({
      outcome: INBOUND_FILE_FAILURE.tooLarge,
      relativePath: null,
      content: null,
    });
  });
});
