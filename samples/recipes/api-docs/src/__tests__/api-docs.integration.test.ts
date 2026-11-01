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
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { recordApiExample } from "@cosmicdrift/kumiko-testing/api-examples";
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
