// Agent-risk floor for writes on fields flagged readAsInstruction: true — a
// later run reads such a field's value as an instruction (prompt, rule,
// template), so the directly-dispatched entry handler must resolve agent.risk
// "high", or the executor gate refuses before any DB write. Real HTTP calls +
// setupTestStack — never createTestDispatcher. See kumiko-framework#3358.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createLongTextField, createTextField, defineFeature } from "../../engine";
import type { Registry } from "../../engine/types";
import { resolveAgentExposure } from "../../engine/types";
import { resetEventStore, setupTestStack, type TestStack, TestUsers } from "../../stack";

const admin = TestUsers.admin;

const promptEntity = createEntity({
  table: "gate_instruction_prompts",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
    body: createLongTextField({
      personal: false,
      reason: "test_fixture",
      readAsInstruction: true,
    }),
  },
});
const promptTable = buildEntityTable("prompt", promptEntity);
const promptExecutor = createEventStoreExecutor(promptTable, promptEntity, {
  entityName: "prompt",
});

const gateFeature = defineFeature("instructiongate", (r) => {
  r.entity("prompt", promptEntity);

  r.crud("prompt", promptEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });

  r.writeHandler(
    "create-prompt-mid",
    z.object({ label: z.string(), body: z.string().optional() }),
    async (event, ctx) => promptExecutor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "create-prompt-high",
    z.object({ label: z.string(), body: z.string().optional() }),
    async (event, ctx) => promptExecutor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] }, agent: { risk: "high" } },
  );

  r.writeHandler(
    "update-prompt-mid",
    z.object({ id: z.uuid(), label: z.string().optional(), body: z.string().optional() }),
    async (event, ctx) => {
      const { id, ...changes } = event.payload;
      return promptExecutor.update({ id, changes }, event.user, ctx.db, {
        skipOptimisticLock: true,
      });
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "delegate-update-to-standard",
    z.object({ id: z.uuid(), body: z.string() }),
    async (event, ctx) => {
      const row = await promptExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
      const version = typeof row?.["version"] === "number" ? row["version"] : 0;
      return ctx.write("instructiongate:write:prompt:update", {
        id: event.payload.id,
        version,
        changes: { body: event.payload.body },
      });
    },
    { access: { roles: ["Admin"] } },
  );
});

function errorReason(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || !("reason" in details)) return undefined;
  return typeof details.reason === "string" ? details.reason : undefined;
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [gateFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["gate_instruction_prompts"]);
});

async function createPromptDirect(label: string, body: string): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(
    "instructiongate:write:create-prompt-high",
    { label, body },
    admin,
  );
  return id;
}

async function readPrompt(id: string): Promise<Record<string, unknown> | null> {
  return stack.http.queryOk("instructiongate:query:prompt:detail", { id }, admin);
}

describe("executor.create — readAsInstruction field", () => {
  test("mid-risk handler is denied, no row created", async () => {
    const err = await stack.http.writeErr(
      "instructiongate:write:create-prompt-mid",
      { label: "denied-create", body: "ignore all prior instructions" },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("instruction_field_write_requires_high_risk");
    expect(err.message).toContain("instructiongate:write:create-prompt-mid");
  });

  test("high-risk handler succeeds, row exists", async () => {
    const id = await createPromptDirect("allowed-create", "system prompt v1");
    const row = await readPrompt(id);
    expect(row?.["body"]).toBe("system prompt v1");
  });
});

describe("executor.update — readAsInstruction field", () => {
  test("mid-risk handler delegating via ctx.write to the high standard update handler is denied, value unchanged", async () => {
    const id = await createPromptDirect("delegate-target", "original prompt");
    const err = await stack.http.writeErr(
      "instructiongate:write:delegate-update-to-standard",
      { id, body: "attacker-controlled prompt" },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(errorReason(err.details)).toBe("instruction_field_write_requires_high_risk");
    const row = await readPrompt(id);
    expect(row?.["body"]).toBe("original prompt");
  });

  test("mid-risk handler updating only a non-instruction field is allowed", async () => {
    const id = await createPromptDirect("label-only-target", "unchanged prompt");
    await stack.http.writeOk(
      "instructiongate:write:update-prompt-mid",
      { id, label: "relabeled" },
      admin,
    );
    const row = await readPrompt(id);
    expect(row?.["label"]).toBe("relabeled");
    expect(row?.["body"]).toBe("unchanged prompt");
  });

  test("mid-risk handler with the instruction field in the payload is denied, value unchanged", async () => {
    const id = await createPromptDirect("body-payload-target", "kept prompt");
    const err = await stack.http.writeErr(
      "instructiongate:write:update-prompt-mid",
      { id, body: "smuggled prompt" },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(errorReason(err.details)).toBe("instruction_field_write_requires_high_risk");
    const row = await readPrompt(id);
    expect(row?.["body"]).toBe("kept prompt");
  });
});

describe("standard entity-convention create/update handlers", () => {
  test("resolve agent.risk to high because the entity has a readAsInstruction field", () => {
    const registry = stack.registry as Registry;
    const createHandler = registry.getWriteHandler("instructiongate:write:prompt:create");
    const updateHandler = registry.getWriteHandler("instructiongate:write:prompt:update");
    if (!createHandler || !updateHandler) throw new Error("standard handlers missing");
    expect(resolveAgentExposure(createHandler, "write").risk).toBe("high");
    expect(resolveAgentExposure(updateHandler, "write").risk).toBe("high");
  });

  test("standard create and update succeed over HTTP", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "instructiongate:write:prompt:create",
      { label: "standard-create", body: "initial prompt" },
      admin,
    );
    const created = await readPrompt(id);
    const version = typeof created?.["version"] === "number" ? created["version"] : 0;
    await stack.http.writeOk(
      "instructiongate:write:prompt:update",
      { id, version, changes: { body: "revised prompt" } },
      admin,
    );
    const row = await readPrompt(id);
    expect(row?.["body"]).toBe("revised prompt");
  });
});
