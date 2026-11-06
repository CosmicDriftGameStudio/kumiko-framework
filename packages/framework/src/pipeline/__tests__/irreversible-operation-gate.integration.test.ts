// Agent-risk floor for irreversible operations (delete on a non-softDelete
// entity, forget on any entity): the directly-dispatched entry handler must
// resolve agent.risk "high", or the executor gate refuses before any DB read.
// A job or consumer without an entry handler is refused unless it declared irreversibleWithoutEntryHandler.
// Real HTTP calls + setupTestStack — never createTestDispatcher.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  drainEventConsumers,
  resetEventStore,
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-testing/stack";
import { resolveAgentExposure } from "@cosmicdrift/kumiko-types/agent-exposure";
import type { IrreversibleWithoutEntryHandler } from "@cosmicdrift/kumiko-types/config";
import type { JobContext, WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { runAsAgentToolCallEntry } from "../../api/request-context.ts";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "../../crypto/index.ts";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { createTenantDb, entityEventName } from "../../db/index.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import {
  createEntity,
  createLongTextField,
  createSystemUser,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import type { Registry } from "../../engine/types/index.ts";
import { AccessDeniedError } from "../../errors/index.ts";

import { TestUsers } from "../../seeding/seed-users.ts";

const admin = TestUsers.admin;
const NONEXISTENT_ID = "00000000-0000-4000-8000-00000000dead";

const hardEntity = createEntity({
  table: "gate_hard_items",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const hardTable = buildEntityTable("hard", hardEntity);
const hardExecutor = createEventStoreExecutor(hardTable, hardEntity, { entityName: "hard" });

const softEntity = createEntity({
  table: "gate_soft_items",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  softDelete: true,
});
const softTable = buildEntityTable("soft", softEntity);
const softExecutor = createEventStoreExecutor(softTable, softEntity, { entityName: "soft" });

const promptEntity = createEntity({
  table: "gate_hard_prompts",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
    body: createLongTextField({ personal: false, reason: "test_fixture", readAsInstruction: true }),
  },
});
const promptTable = buildEntityTable("prompt", promptEntity);
const promptExecutor = createEventStoreExecutor(promptTable, promptEntity, {
  entityName: "prompt",
});

type Outcome =
  | { readonly kind: "completed" }
  | {
      readonly kind: "refused";
      readonly reason: string | undefined;
      readonly handler: string | undefined;
      readonly message: string;
    };

function detailString(details: unknown, key: string): string | undefined {
  const value = propertyOf(details, key);
  return typeof value === "string" ? value : undefined;
}

function refusal(error: { readonly message: string; readonly details?: unknown }): Outcome {
  return {
    kind: "refused",
    reason: detailString(error.details, "reason"),
    handler: detailString(error.details, "handler"),
    message: error.message,
  };
}

// The gate throws inside the job, consumer or hook under test; the probe records what it threw.
async function outcomeOf(act: () => Promise<unknown>): Promise<Outcome> {
  try {
    await act();
    return { kind: "completed" };
  } catch (error) {
    if (error instanceof AccessDeniedError) return refusal(error);
    throw error;
  }
}

async function outcomeOfWrite(write: () => Promise<WriteResult>): Promise<Outcome> {
  const result = await write();
  return result.isSuccess ? { kind: "completed" } : refusal(result.error);
}

const SOME_USER_ID = "00000000-0000-4000-8000-0000000000aa";

function eraseSomeKey(ctx: JobContext): Promise<void> {
  const kms = configuredPiiSubjectKms();
  if (!kms) throw new Error("test KMS not configured");
  return kms.eraseKey(
    { kind: "user", userId: SOME_USER_ID },
    { requestId: "gate-test", userId: ctx.systemUser.id, eraseReason: "gate-test" },
  );
}

const CRON_PIPELINE: IrreversibleWithoutEntryHandler = "high-risk-or-cron-pipeline";

type JobProbe = {
  readonly exemption?: IrreversibleWithoutEntryHandler;
  readonly act: (id: string, ctx: JobContext) => Promise<Outcome>;
};

const jobProbes: Record<string, JobProbe> = {
  "forget-undeclared": {
    act: (id, ctx) => outcomeOf(() => hardExecutor.forget({ id }, ctx.systemUser, ctx.db)),
  },
  "hard-delete-undeclared": {
    act: (id, ctx) => outcomeOf(() => hardExecutor.delete({ id }, ctx.systemUser, ctx.db)),
  },
  "erase-key-undeclared": { act: (_id, ctx) => outcomeOf(() => eraseSomeKey(ctx)) },
  "instruction-write-undeclared": {
    act: (_id, ctx) =>
      outcomeOf(() => promptExecutor.create({ label: "p", body: "b" }, ctx.systemUser, ctx.db)),
  },
  "forget-declared": {
    exemption: CRON_PIPELINE,
    act: (id, ctx) => outcomeOf(() => hardExecutor.forget({ id }, ctx.systemUser, ctx.db)),
  },
  "erase-key-declared": {
    exemption: CRON_PIPELINE,
    act: (_id, ctx) => outcomeOf(() => eraseSomeKey(ctx)),
  },
  "mid-write-from-declared": {
    exemption: CRON_PIPELINE,
    act: (id, ctx) =>
      outcomeOfWrite(() => ctx.dispatch.write("gatetest:write:forget-hard-mid", { id })),
  },
  "agent-tool-call-from-declared": {
    exemption: CRON_PIPELINE,
    act: (id, ctx) =>
      outcomeOf(() =>
        runAsAgentToolCallEntry(() => hardExecutor.forget({ id }, ctx.systemUser, ctx.db)),
      ),
  },
  "hook-from-declared": {
    exemption: CRON_PIPELINE,
    act: (id, ctx) =>
      outcomeOfWrite(() =>
        ctx.dispatch.write("gatetest:write:forget-in-after-commit", {
          id,
          origin: "job",
        }),
      ),
  },
  "tool-hook-from-declared": {
    exemption: CRON_PIPELINE,
    act: (id, ctx) =>
      outcomeOfWrite(() =>
        runAsAgentToolCallEntry(() =>
          ctx.dispatch.write("gatetest:write:forget-in-after-commit", { id, origin: "tool" }),
        ),
      ),
  },
};

const jobPayloadSchema = z.object({ id: z.uuid() });

const jobOutcomes = new Map<string, Outcome>();
const hookOutcomes = new Map<string, Outcome>();
const consumerOutcomes = new Map<string, Outcome>();

const CONSUMER_LABEL_PREFIX = { undeclared: "msp-undeclared", declared: "msp-declared" } as const;

const gateFeature = defineFeature("gatetest", (r) => {
  r.entity({ name: "hard", ...hardEntity });
  r.entity({ name: "soft", ...softEntity });

  r.crud("hard", hardEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
  r.crud("soft", softEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });

  r.writeHandler({
    name: "forget-hard-mid",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      hardExecutor.forget({ id: event.payload.id }, event.user, ctx.db),
    access: { openToAll: { reason: "probe handler dispatched from a job without roles" } },
  });

  r.writeHandler({
    name: "forget-hard-high",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      hardExecutor.forget({ id: event.payload.id }, event.user, ctx.db),
    access: { roles: ["Admin"] },
    agent: { risk: "high" },
  });

  r.writeHandler({
    name: "delete-hard-mid",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      hardExecutor.delete({ id: event.payload.id }, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "delete-soft-mid",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      softExecutor.delete({ id: event.payload.id }, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "delegate-write-to-forget-high",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      ctx.dispatch.write("gatetest:write:forget-hard-high", { id: event.payload.id }),
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "delegate-write-as-to-forget-high",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      ctx.dispatch.writeAs(event.user, "gatetest:write:forget-hard-high", { id: event.payload.id }),
    access: { roles: ["Admin"] },
  });

  r.streamHandler(
    "delete-hard",
    z.object({ id: z.uuid() }),
    async function* (query, ctx) {
      await hardExecutor.delete({ id: query.payload.id }, query.user, ctx.db);
      yield "deleted";
    },
    { access: { roles: ["Admin"] } },
  );

  r.entity({ name: "prompt", ...promptEntity });
  r.crud("prompt", promptEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });

  r.writeHandler({
    name: "forget-in-after-commit",
    schema: z.object({ id: z.uuid(), origin: z.enum(["http", "job", "tool"]) }),
    handler: async (event, ctx) => {
      ctx.lifecycle.afterCommit?.(async () => {
        hookOutcomes.set(
          event.payload.origin,
          await outcomeOf(() =>
            hardExecutor.forget(
              { id: event.payload.id },
              event.user,
              ctx.db.outsideTransaction ?? ctx.db,
            ),
          ),
        );
      });
      return { isSuccess: true, data: {} };
    },
    access: { openToAll: { reason: "probe handler dispatched from a job without roles" } },
  });

  for (const [name, probe] of Object.entries(jobProbes)) {
    r.job(
      name,
      {
        trigger: { manual: true },
        retries: 0,
        ...(probe.exemption && { irreversibleWithoutEntryHandler: probe.exemption }),
      },
      async (payload, ctx) => {
        const { id } = jobPayloadSchema.parse(payload);
        jobOutcomes.set(name, await probe.act(id, ctx));
      },
    );
  }

  for (const [label, exemption] of [
    [CONSUMER_LABEL_PREFIX.undeclared, undefined],
    [CONSUMER_LABEL_PREFIX.declared, CRON_PIPELINE],
  ] as const) {
    r.multiStreamProjection({
      name: label,
      ...(exemption && { irreversibleWithoutEntryHandler: exemption }),
      apply: {
        [entityEventName("hard", "created")]: async (event, tx) => {
          if (event.payload["label"] !== label) return;
          consumerOutcomes.set(
            label,
            await outcomeOf(() =>
              hardExecutor.forget(
                { id: event.aggregateId },
                createSystemUser(event.tenantId),
                createTenantDb({ db: tx, tenantId: event.tenantId }),
              ),
            ),
          );
        },
      },
    });
  }
});

function errorReason(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || !("reason" in details)) return undefined;
  return typeof details.reason === "string" ? details.reason : undefined;
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [gateFeature], jobs: { consumerLane: "worker" } });
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  configurePiiSubjectKms(undefined);
  await stack.cleanup();
});

afterEach(async () => {
  jobOutcomes.clear();
  hookOutcomes.clear();
  consumerOutcomes.clear();
  await resetEventStore(stack, ["gate_hard_items", "gate_soft_items", "gate_hard_prompts"]);
});

async function createHard(label: string): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(
    "gatetest:write:hard:create",
    { label },
    admin,
  );
  return id;
}

async function createSoft(label: string): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(
    "gatetest:write:soft:create",
    { label },
    admin,
  );
  return id;
}

// The entity-convention "detail" query returns `data: null` for a missing
// row instead of an HTTP error — assert via queryOk + null, not queryErr.
async function hardRowExists(id: string): Promise<boolean> {
  const row = await stack.http.queryOk("gatetest:query:hard:detail", { id }, admin);
  return row !== null;
}

describe("executor.forget — always irreversible", () => {
  test("mid-risk handler is denied, row survives", async () => {
    const id = await createHard("survives-mid-forget");
    const err = await stack.http.writeErr("gatetest:write:forget-hard-mid", { id }, admin);
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("irreversible_operation_requires_high_risk");
    expect(err.message).toContain("gatetest:write:forget-hard-mid");
    expect(await hardRowExists(id)).toBe(true);
  });

  test("high-risk handler succeeds, row is gone", async () => {
    const id = await createHard("gone-after-high-forget");
    await stack.http.writeOk("gatetest:write:forget-hard-high", { id }, admin);
    expect(await hardRowExists(id)).toBe(false);
  });

  test("nonexistent id at mid-risk still answers 403, not 404", async () => {
    const err = await stack.http.writeErr(
      "gatetest:write:forget-hard-mid",
      { id: NONEXISTENT_ID },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe("access_denied");
  });
});

describe("executor.delete — irreversible only without softDelete", () => {
  test("mid-risk handler on a hard-delete entity is denied", async () => {
    const id = await createHard("survives-mid-delete");
    const err = await stack.http.writeErr("gatetest:write:delete-hard-mid", { id }, admin);
    expect(err.httpStatus).toBe(403);
    expect(errorReason(err.details)).toBe("irreversible_operation_requires_high_risk");
  });

  test("mid-risk handler on a softDelete entity succeeds", async () => {
    const id = await createSoft("soft-delete-ok");
    await stack.http.writeOk("gatetest:write:delete-soft-mid", { id }, admin);
    const row = await stack.http.queryOk("gatetest:query:soft:detail", { id }, admin);
    expect(row).toBeNull();
  });
});

describe("stream entry handlers resolve mid risk", () => {
  test("a stream hard-deleting a row is denied with a stream-specific remedy, row survives", async () => {
    const id = await createHard("streamed");
    const headers = { Authorization: `Bearer ${await stack.jwt.sign(admin)}` };
    const res = await stack.http.raw(
      "POST",
      "/api/stream",
      { type: "gatetest:stream:delete-hard", payload: { id } },
      headers,
    );
    const body = await res.text();
    expect(body).toContain("irreversible_operation_requires_high_risk");
    expect(body).toContain("stream handlers cannot declare an agent risk");
    expect(body).not.toContain('declare agent: { risk: "high" } on "gatetest:stream');
    expect(await hardRowExists(id)).toBe(true);
  });
});

describe("delegation via ctx.dispatch.write/writeAs does not inherit the inner handler's risk", () => {
  test("mid handler delegating via ctx.dispatch.write to a high forget handler is denied", async () => {
    const id = await createHard("delegate-write-denied");
    const err = await stack.http.writeErr(
      "gatetest:write:delegate-write-to-forget-high",
      { id },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(errorReason(err.details)).toBe("irreversible_operation_requires_high_risk");
    expect(await hardRowExists(id)).toBe(true);
  });

  test("mid handler delegating via ctx.dispatch.writeAs to a high forget handler is denied", async () => {
    const id = await createHard("delegate-write-as-denied");
    const err = await stack.http.writeErr(
      "gatetest:write:delegate-write-as-to-forget-high",
      { id },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(errorReason(err.details)).toBe("irreversible_operation_requires_high_risk");
    expect(await hardRowExists(id)).toBe(true);
  });

  test("calling the high handler directly still succeeds", async () => {
    const id = await createHard("direct-high-ok");
    await stack.http.writeOk("gatetest:write:forget-hard-high", { id }, admin);
    expect(await hardRowExists(id)).toBe(false);
  });
});

describe("standard entity-convention delete handler", () => {
  test("resolves to high risk on a non-softDelete entity, mid on a softDelete one", () => {
    const registry = stack.registry as Registry;
    const hardDelete = registry.getWriteHandler("gatetest:write:hard:delete");
    const softDelete = registry.getWriteHandler("gatetest:write:soft:delete");
    if (!hardDelete || !softDelete) throw new Error("delete handlers missing from registry");
    expect(resolveAgentExposure(hardDelete, "write").risk).toBe("high");
    expect(resolveAgentExposure(softDelete, "write").risk).toBe("mid");
  });

  test("succeeds over HTTP on the non-softDelete entity", async () => {
    const id = await createHard("standard-delete-ok");
    await stack.http.writeOk("gatetest:write:hard:delete", { id }, admin);
    expect(await hardRowExists(id)).toBe(false);
  });
});

async function runProbeJob(name: string, id: string): Promise<Outcome> {
  await stack.jobRunner?.dispatch(`gatetest:job:${name}`, { id, tenantId: admin.tenantId });
  await waitFor(() => {
    expect(jobOutcomes.has(name)).toBe(true);
  });
  const outcome = jobOutcomes.get(name);
  if (!outcome) throw new Error(`probe job ${name} recorded no outcome`);
  return outcome;
}

function expectRefusedWithoutDeclaration(outcome: Outcome, pipeline: string): void {
  if (outcome.kind !== "refused") throw new Error("expected the gate to refuse");
  expect(outcome.reason).toBe("irreversible_operation_without_entry_handler");
  expect(outcome.handler).toBe(pipeline);
  expect(outcome.message).toContain(`"${pipeline}"`);
  expect(outcome.message).toContain("irreversibleWithoutEntryHandler");
  expect(outcome.message).toContain('agent: { risk: "high" }');
}

describe("a job without an entry handler needs a declared exception", () => {
  test("executor.forget in an undeclared job is refused, the row survives", async () => {
    const id = await createHard("job-forget-refused");
    expectRefusedWithoutDeclaration(
      await runProbeJob("forget-undeclared", id),
      "gatetest:job:forget-undeclared",
    );
    expect(await hardRowExists(id)).toBe(true);
  });

  test("a hard delete in an undeclared job is refused, the row survives", async () => {
    const id = await createHard("job-delete-refused");
    expectRefusedWithoutDeclaration(
      await runProbeJob("hard-delete-undeclared", id),
      "gatetest:job:hard-delete-undeclared",
    );
    expect(await hardRowExists(id)).toBe(true);
  });

  test("kms.eraseKey in an undeclared job is refused", async () => {
    expectRefusedWithoutDeclaration(
      await runProbeJob("erase-key-undeclared", NONEXISTENT_ID),
      "gatetest:job:erase-key-undeclared",
    );
  });

  test("a write to a readAsInstruction field in an undeclared job is refused", async () => {
    const outcome = await runProbeJob("instruction-write-undeclared", NONEXISTENT_ID);
    expectRefusedWithoutDeclaration(outcome, "gatetest:job:instruction-write-undeclared");
    const prompts = await stack.http.queryOk<{ rows: unknown[] }>(
      "gatetest:query:prompt:list",
      {},
      admin,
    );
    expect(prompts.rows).toHaveLength(0);
  });

  test("the declared job runs the same forget through, the row is gone", async () => {
    const id = await createHard("job-forget-declared");
    expect(await runProbeJob("forget-declared", id)).toEqual({ kind: "completed" });
    expect(await hardRowExists(id)).toBe(false);
  });

  test("the declared job runs kms.eraseKey through", async () => {
    expect(await runProbeJob("erase-key-declared", NONEXISTENT_ID)).toEqual({
      kind: "completed",
    });
  });

  test("a mid-risk write dispatched from the declared job is still refused, the row survives", async () => {
    const id = await createHard("job-mid-write-refused");
    const outcome = await runProbeJob("mid-write-from-declared", id);
    if (outcome.kind !== "refused") throw new Error("expected the gate to refuse");
    expect(outcome.reason).toBe("irreversible_operation_requires_high_risk");
    expect(outcome.handler).toBe("gatetest:write:forget-hard-mid");
    expect(await hardRowExists(id)).toBe(true);
  });

  test("an agent tool call inside the declared job does not inherit the exception", async () => {
    const id = await createHard("job-agent-tool-call-refused");
    expectRefusedWithoutDeclaration(
      await runProbeJob("agent-tool-call-from-declared", id),
      "gatetest:job:agent-tool-call-from-declared",
    );
    expect(await hardRowExists(id)).toBe(true);
  });
});

describe("an afterCommit hook never inherits a declared exception", () => {
  test("a forget in a hook of an HTTP write is refused, the row survives", async () => {
    const id = await createHard("hook-http-refused");
    await stack.http.writeOk(
      "gatetest:write:forget-in-after-commit",
      { id, origin: "http" },
      admin,
    );
    await waitFor(() => {
      expect(hookOutcomes.has("http")).toBe(true);
    });
    const outcome = hookOutcomes.get("http");
    if (outcome?.kind !== "refused") throw new Error("expected the gate to refuse");
    expect(outcome.reason).toBe("irreversible_operation_without_entry_handler");
    expect(await hardRowExists(id)).toBe(true);
  });

  test("a forget in a hook of a write dispatched by the declared job is refused, the row survives", async () => {
    const id = await createHard("hook-job-refused");
    expect(await runProbeJob("hook-from-declared", id)).toEqual({ kind: "completed" });
    await waitFor(() => {
      expect(hookOutcomes.has("job")).toBe(true);
    });
    const outcome = hookOutcomes.get("job");
    if (outcome?.kind !== "refused") throw new Error("expected the gate to refuse");
    expect(outcome.reason).toBe("irreversible_operation_without_entry_handler");
    expect(await hardRowExists(id)).toBe(true);
  });

  test("a forget in a hook of an agent tool call is refused, the row survives", async () => {
    const id = await createHard("hook-tool-refused");
    expect(await runProbeJob("tool-hook-from-declared", id)).toEqual({ kind: "completed" });
    await waitFor(() => {
      expect(hookOutcomes.has("tool")).toBe(true);
    });
    const outcome = hookOutcomes.get("tool");
    if (outcome?.kind !== "refused") throw new Error("expected the gate to refuse");
    expect(outcome.reason).toBe("irreversible_operation_without_entry_handler");
    expect(await hardRowExists(id)).toBe(true);
  });
});

describe("an event consumer without an entry handler needs a declared exception", () => {
  test("executor.forget in an undeclared consumer is refused, the row survives", async () => {
    const id = await createHard(CONSUMER_LABEL_PREFIX.undeclared);
    await drainEventConsumers(stack, [`gatetest:projection:${CONSUMER_LABEL_PREFIX.undeclared}`]);
    expectRefusedWithoutDeclaration(
      consumerOutcomes.get(CONSUMER_LABEL_PREFIX.undeclared) ?? { kind: "completed" },
      `gatetest:projection:${CONSUMER_LABEL_PREFIX.undeclared}`,
    );
    expect(await hardRowExists(id)).toBe(true);
  });

  test("the declared consumer runs the same forget through, the row is gone", async () => {
    const id = await createHard(CONSUMER_LABEL_PREFIX.declared);
    await drainEventConsumers(stack, [`gatetest:projection:${CONSUMER_LABEL_PREFIX.declared}`]);
    expect(consumerOutcomes.get(CONSUMER_LABEL_PREFIX.declared)).toEqual({ kind: "completed" });
    expect(await hardRowExists(id)).toBe(false);
  });
});

describe("without a request scope nothing is gated", () => {
  test("a direct forget and eraseKey outside any scope run through (boot seed, CLI)", async () => {
    const id = await createHard("no-scope-forget");
    const tenantDb = createTenantDb({ db: stack.db, tenantId: admin.tenantId });
    const result = await hardExecutor.forget({ id }, createSystemUser(admin.tenantId), tenantDb);
    expect(result.isSuccess).toBe(true);
    expect(await hardRowExists(id)).toBe(false);
    await configuredPiiSubjectKms()?.eraseKey(
      { kind: "user", userId: SOME_USER_ID },
      { requestId: "gate-test", userId: admin.id, eraseReason: "gate-test" },
    );
  });
});
