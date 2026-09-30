// kms.eraseKey reached through configuredPiiSubjectKms() passes the same
// agent-risk floor executor.forget()/delete() already enforce.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  type SubjectId,
} from "@cosmicdrift/kumiko-framework/crypto";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { buildAgentManifest } from "../agent-manifest.js";
import { buildToolCatalog, toolNameForQn } from "../tool-catalog.js";
import { dispatchToolCall } from "../tool-dispatch.js";

const admin = TestUsers.admin;

const SUBJECT: SubjectId = {
  kind: "record",
  entity: "kms-erase-gate-widget",
  id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
};

const ERASE_MID_QN = "kms-erase-gate-test:write:erase-mid";
const ERASE_HIGH_QN = "kms-erase-gate-test:write:erase-high";

const kmsGateFeature = defineFeature("kms-erase-gate-test", (r) => {
  r.writeHandler(
    "erase-mid",
    z.object({}),
    async () => {
      await configuredPiiSubjectKms()!.eraseKey(SUBJECT, {
        requestId: "kms-erase-gate-test:erase-mid",
        eraseReason: "test",
      });
      return { isSuccess: true as const, data: {} };
    },
    {
      access: { roles: ["Admin"] },
      description: "Erase the widget subject key (mid risk, default).",
    },
  );

  r.writeHandler(
    "erase-high",
    z.object({}),
    async () => {
      await configuredPiiSubjectKms()!.eraseKey(SUBJECT, {
        requestId: "kms-erase-gate-test:erase-high",
        eraseReason: "test",
      });
      return { isSuccess: true as const, data: {} };
    },
    {
      access: { roles: ["Admin"] },
      description: "Erase the widget subject key (high risk).",
      agent: { risk: "high" },
    },
  );
});

let stack: TestStack;
let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  stack = await setupTestStack({ features: [kmsGateFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  kms = new InMemoryKmsAdapter();
  await kms.createKey(SUBJECT);
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

function catalogFor(roles: readonly string[]) {
  const manifest = buildAgentManifest(stack.registry, { locale: "en", roles });
  return buildToolCatalog(stack.registry, manifest, { mode: "edit" });
}

describe("kms.eraseKey via configuredPiiSubjectKms() — agent-risk gate", () => {
  test("a mid-risk (default) tool is denied, the key stays readable", async () => {
    const catalog = catalogFor(admin.roles);
    const result = await dispatchToolCall({
      dispatcher: stack.dispatcher,
      user: admin,
      toolName: toolNameForQn(ERASE_MID_QN),
      input: {},
      dispatchTable: catalog.dispatchTable,
      runId: "run-mid",
      toolCallId: "call-mid",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain(ERASE_MID_QN);
    expect(result.error).toContain("irreversible");
    expect(result.error).toContain("kms.eraseKey");
    await expect(kms.getKey(SUBJECT)).resolves.toBeTruthy();
  });

  test("a risk:high tool succeeds and the key is erased", async () => {
    const catalog = catalogFor(admin.roles);
    const result = await dispatchToolCall({
      dispatcher: stack.dispatcher,
      user: admin,
      toolName: toolNameForQn(ERASE_HIGH_QN),
      input: {},
      dispatchTable: catalog.dispatchTable,
      runId: "run-high",
      toolCallId: "call-high",
    });

    expect(result.ok).toBe(true);
    await expect(kms.getKey(SUBJECT)).rejects.toThrow("Subject key erased");
  });
});
