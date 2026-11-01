// Records the request/response pairs that api-docs/ shows. A normal run only asserts the
// behaviour; with KUMIKO_RECORD_API_EXAMPLES=1 the pairs are also written to api-examples/.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  AuthHandlers,
  createAuthEmailPasswordFeature,
  hashPassword,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  createAuthFoundationFeature,
  resolveTokenVerifier,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  apiTokenEntity,
  PatHandlers,
} from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenantMembership } from "@cosmicdrift/kumiko-bundled-features/tenant/seeding";
import {
  createUserFeature,
  UserHandlers,
  userEntity,
} from "@cosmicdrift/kumiko-bundled-features/user";
import { entityEventName, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  formatWebhookPayloadIssues,
  type SessionUser,
  type TenantId,
  toEntityWebhookPayload,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { recordApiExample, recordWebhookExample } from "@cosmicdrift/kumiko-testing/api-examples";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { z } from "zod";
import { helpdeskFeature, patFeature } from "../feature";

const TENANT: TenantId = testTenantId(1);
const EXAMPLES_DIR = join(import.meta.dir, "../../api-examples");

let stack: TestStack;
let actor: SessionUser;

async function mintToken(scopes: readonly string[]): Promise<string> {
  const minted = await stack.http.writeOk<{ token: string }>(
    PatHandlers.create,
    { name: "Integration", scopes, currentPassword: "super-long-password" },
    actor,
  );
  return minted.token;
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createAuthFoundationFeature(),
      helpdeskFeature,
      patFeature(),
    ],
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      tokenVerifier: (raw: string) =>
        resolveTokenVerifier({ db: stack.db, registry: stack.registry }, raw),
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, apiTokenEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });

  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email: "agent@example.com",
      passwordHash: await hashPassword("super-long-password"),
      displayName: "Agent",
    },
    TestUsers.systemAdmin,
  );
  await seedTenantMembership(stack.db, { userId: created.id, tenantId: TENANT, roles: ["User"] });
  actor = { id: created.id, tenantId: TENANT, roles: ["User"] };
});

afterAll(async () => {
  await stack.cleanup();
});

const TicketRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
});
const CreatedSchema = z.object({ data: z.object({ id: z.string() }) });
const ListedSchema = z.object({ data: z.object({ rows: z.array(TicketRowSchema) }) });
const DetailSchema = z.object({ data: TicketRowSchema });

async function denied(token: string, type: string, payload: unknown) {
  const response = await stack.http.raw(
    "POST",
    "/api/write",
    { type, payload },
    { Authorization: `Bearer ${token}` },
  );
  return { status: response.status, body: await response.json() };
}

describe("helpdesk API with a personal access token", () => {
  test("create, list, detail, update and close a ticket", async () => {
    const token = await mintToken(["tickets:write"]);
    const record = (
      name: string,
      endpoint: "/api/query" | "/api/write",
      type: string,
      payload: unknown,
    ) =>
      recordApiExample(stack.http, {
        name,
        dir: EXAMPLES_DIR,
        endpoint,
        body: { type, payload },
        token,
      });

    const created = await record("ticket-create", "/api/write", "helpdesk:write:ticket:create", {
      title: "Printer is on fire",
      priority: "high",
    });
    expect(created.status).toBe(200);
    const id = CreatedSchema.parse(created.body).data.id;

    const listed = await record("ticket-list", "/api/query", "helpdesk:query:ticket:list", {});
    expect(ListedSchema.parse(listed.body).data.rows.map((row) => row.id)).toContain(id);

    const detail = await record("ticket-detail", "/api/query", "helpdesk:query:ticket:detail", {
      id,
    });
    expect(DetailSchema.parse(detail.body).data).toMatchObject({
      title: "Printer is on fire",
      status: "open",
      priority: "high",
    });

    const updated = await record("ticket-update", "/api/write", "helpdesk:write:ticket:update", {
      id,
      version: 1,
      changes: { priority: "normal" },
    });
    expect(updated.status).toBe(200);

    const closed = await record("ticket-close", "/api/write", "helpdesk:write:ticket:close", {
      id,
      resolution: "Replaced the cartridge",
    });
    expect(closed.status).toBe(200);
    const after = await stack.http.queryOk("helpdesk:query:ticket:detail", { id }, actor);
    expect(TicketRowSchema.parse(after)).toMatchObject({ status: "closed", priority: "normal" });
  });

  test("webhook payloads built from the appended events satisfy their contracts and are recorded", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "helpdesk:write:ticket:create",
      { title: "Scanner jams", priority: "low" },
      actor,
    );
    await stack.http.writeOk(
      "helpdesk:write:ticket:update",
      { id: created.id, version: 1, changes: { priority: "high" } },
      actor,
    );
    await stack.http.writeOk(
      "helpdesk:write:ticket:close",
      { id: created.id, resolution: "Replaced the roller" },
      actor,
    );
    const stored = await selectMany<{ type: string; payload: Record<string, unknown> }>(
      stack.db,
      eventsTable,
      { aggregateId: created.id },
    );
    const webhookPayloadOf = (verb: "created" | "updated") => {
      const qn = entityEventName("ticket", verb);
      const contract = stack.registry.getWebhookEventContract(qn);
      const event = stored.find((candidate) => candidate.type === qn);
      if (contract === undefined || event === undefined) {
        throw new Error(`${qn} is neither a contract nor an appended event`);
      }
      const mapped = toEntityWebhookPayload(contract, {
        aggregateId: created.id,
        payload: event.payload,
      });
      if (!mapped.ok) throw new Error(formatWebhookPayloadIssues(mapped.issues));
      return { contract, payload: mapped.payload };
    };

    const createdWebhook = webhookPayloadOf("created");
    expect(Object.keys(createdWebhook.payload).sort()).toEqual(
      Object.keys(createdWebhook.contract.payload.shape).sort(),
    );
    const recordedCreated = await recordWebhookExample({
      name: "ticket-created",
      dir: EXAMPLES_DIR,
      contract: createdWebhook.contract,
      payload: createdWebhook.payload,
    });
    expect(recordedCreated).toMatchObject({
      id: created.id,
      title: "Scanner jams",
      priority: "low",
    });

    const updatedWebhook = webhookPayloadOf("updated");
    expect(Object.keys(updatedWebhook.payload).sort()).toEqual(["changes", "id", "previous"]);
    expect(updatedWebhook.payload["changes"]).toEqual({ priority: "high" });

    const closedContract = stack.registry.getWebhookEventContract("helpdesk:ticket-closed");
    const closedEvent = stored.find((event) => event.type.endsWith("ticket-closed"));
    if (closedContract === undefined || closedEvent === undefined) {
      throw new Error("helpdesk:ticket-closed has no contract or no appended event");
    }
    const recordedClosed = await recordWebhookExample({
      name: "ticket-closed",
      dir: EXAMPLES_DIR,
      contract: closedContract,
      payload: { id: created.id, resolution: closedEvent.payload["resolution"] },
    });
    expect(recordedClosed).toEqual({ id: created.id, resolution: "Replaced the roller" });
  });

  test("a read-only token cannot create a ticket", async () => {
    const result = await denied(await mintToken(["tickets:read"]), "helpdesk:write:ticket:create", {
      title: "Nope",
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: "access_denied" } });
  });

  test("a write token cannot reach the UI-only purge", async () => {
    const result = await denied(await mintToken(["tickets:write"]), "helpdesk:write:ticket:purge", {
      olderThanDays: 30,
    });
    expect(result.status).toBe(403);
  });
});
