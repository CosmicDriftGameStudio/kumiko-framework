import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createEntity,
  createEntityExecutor,
  createNumberField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { INBOUND_ITEM_CREATED_EVENT } from "../constants.ts";
import { readInboundFile } from "../read-inbound-file.ts";
import { pairConnectorDevice, runConnectorJobs, uploadConnectorFile } from "../testing.ts";
import { setupConnectorsStack, teardownConnectorsStack, tenantAdmin } from "./connectors-stack.ts";

const businessData = { personal: false, reason: "is_business_data" } as const;
const receivedFileEntity = createEntity({
  name: "received-file",
  table: "testing_helpers_received_files",
  fields: {
    path: createTextField({ required: true, maxLength: 500, ...businessData }),
    size: createNumberField({ required: true, ...businessData }),
  },
});
const { executor: receivedFileExecutor } = createEntityExecutor(receivedFileEntity);

const MAX_BYTES = 1024;
const LIST_QUERY = "testing-helpers-fixture:query:received-file:list";

const fixtureFeature = defineFeature("testing-helpers-fixture", (r) => {
  r.crud(receivedFileEntity, {
    write: { access: { roles: ["TenantAdmin"] } },
    read: { access: { roles: ["TenantAdmin"] } },
  });
  r.job({
    name: "record-received-file",
    trigger: { on: INBOUND_ITEM_CREATED_EVENT },
    runIn: "worker",
    handler: async (_payload, ctx) => {
      const inboundItemId = ctx.triggerEvent?.aggregateId;
      if (inboundItemId === undefined) return;
      const file = await readInboundFile(ctx, inboundItemId, { maxBytes: MAX_BYTES });
      if (!file.isSuccess) throw new Error(`reading the delivered file failed: ${file.failure}`);
      const created = await receivedFileExecutor.create(
        { path: file.data.relativePath, size: file.data.bytes.byteLength },
        ctx.systemUser,
        ctx.db,
      );
      if (!created.isSuccess) throw new Error("recording the delivered file failed");
    },
  });
});

let stack: TestStack;
beforeAll(async () => {
  stack = await setupConnectorsStack({ extraFeatures: [fixtureFeature] });
});
afterAll(() => teardownConnectorsStack(stack));

describe("connector testing helpers", () => {
  test("pair, upload and run jobs lets a job record the delivered file", async () => {
    const { token } = await pairConnectorDevice(stack, tenantAdmin);
    const bytes = new TextEncoder().encode("Q-1;Part A\n");

    const res = await uploadConnectorFile(stack, token, { path: "lantek/parts.csv", bytes });
    expect(res.status).toBe(201);
    await runConnectorJobs(stack);

    const page = await stack.http.queryOk<{ rows: { path: string; size: number }[] }>(
      LIST_QUERY,
      {},
      tenantAdmin,
    );
    expect(page.rows.map((row) => ({ path: row.path, size: row.size }))).toEqual([
      { path: "lantek/parts.csv", size: bytes.byteLength },
    ]);
  });

  test("the helpers reach routes mounted under a custom basePath", async () => {
    const basePath = "/sync";
    const custom = await setupConnectorsStack({ basePath });
    try {
      await expect(pairConnectorDevice(custom, tenantAdmin)).rejects.toThrow("basePath");
      const { token } = await pairConnectorDevice(custom, tenantAdmin, { basePath });
      const bytes = new TextEncoder().encode("Q-2\n");
      const res = await uploadConnectorFile(custom, token, { path: "a.csv", bytes }, { basePath });
      expect(res.status).toBe(201);
    } finally {
      await teardownConnectorsStack(custom);
    }
  });

  test("pairing against a stack without connector routes names the missing extraRoutes", async () => {
    const bare = await setupTestStack({ features: [] });
    try {
      await expect(pairConnectorDevice(bare, tenantAdmin)).rejects.toThrow(
        "createConnectorRoutes()",
      );
    } finally {
      await bare.cleanup();
    }
  });
});

describe("runConnectorJobs on a stack without a job lane", () => {
  test("fails with the hint to pass jobs.consumerLane instead of silently running nothing", async () => {
    const noJobsStack = await setupTestStack({ features: [] });
    try {
      await expect(runConnectorJobs(noJobsStack)).rejects.toThrow("consumerLane");
    } finally {
      await noJobsStack.cleanup();
    }
  });
});
