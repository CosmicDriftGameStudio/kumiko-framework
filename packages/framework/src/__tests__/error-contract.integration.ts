// Error-Contract — one test per KumikoError subclass through the full HTTP
// stack. This file is the wire-format goldstandard: every error class must
// come back with a stable code + i18nKey and the shape that the client SDK
// and docs promise. If you change the contract, this is the file that moves.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEventStoreExecutor } from "../db/event-store-executor";
import { buildDrizzleTable } from "../db/table-builder";
import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
  type TenantId,
} from "../engine";
import {
  AccessDeniedError,
  ConflictError,
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "../errors";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../stack";
import { asRawClient } from "../bun-db/query";

// --- Entity + handlers that deliberately raise each Kumiko error class ---

const itemEntity = createEntity({
  table: "errctr_items",
  fields: {
    name: createTextField({ required: true }),
    stock: createNumberField({ default: 0 }),
  },
});
const itemTable = buildDrizzleTable("item", itemEntity);

const errorFeature = defineFeature("errctr", (r) => {
  r.entity("item", itemEntity);

  // CRUD create to prep update/delete scenarios (NotFound, VersionConflict).
  r.writeHandler(
    "item:create",
    z.object({ name: z.string().min(1) }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(itemTable, itemEntity, { entityName: "item" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  // VersionConflict: update with stale version → 409 via CrudExecutor.
  r.writeHandler(
    "item:update",
    z.object({
      id: z.uuid(),
      version: z.number().optional(),
      changes: z.record(z.string(), z.unknown()),
    }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(itemTable, itemEntity, { entityName: "item" });
      return crud.update(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  // ValidationError via Zod schema (too-short string).
  // The "name: z.string().min(3)" constraint triggers a ZodIssue which the
  // dispatcher wraps into ValidationError.details.fields automatically.
  r.writeHandler(
    "item:create-strict",
    z.object({ name: z.string().min(3) }),
    async () => writeFailure(new UnprocessableError("unreachable")),
    { access: { roles: ["Admin"] } },
  );

  // ValidationError via a hook (post-schema business validation).
  const createForHook = r.writeHandler(
    "item:create-for-hook",
    z.object({ name: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(itemTable, itemEntity, { entityName: "item" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );
  r.hook("validation", createForHook, (data) => {
    if (data["name"] === "forbidden") {
      return [{ field: "name", error: "name_is_forbidden" }];
    }
    return null;
  });

  // ConflictError: generic 409, used e.g. for delete_restricted.
  r.writeHandler(
    "item:conflict",
    z.object({}),
    async () =>
      writeFailure(
        new ConflictError({
          message: "would leave dangling references",
          i18nKey: "errctr.errors.dependencyConflict",
          details: { reason: "has_dependencies", blocker: "order" },
        }),
      ),
    { access: { roles: ["Admin"] } },
  );

  // UnprocessableError: business rule, reason surfaces under details.reason.
  r.writeHandler(
    "item:unprocessable",
    z.object({}),
    async () =>
      writeFailure(
        new UnprocessableError("already_fulfilled", {
          i18nKey: "errctr.errors.alreadyFulfilled",
          details: { stage: "ship" },
        }),
      ),
    { access: { roles: ["Admin"] } },
  );

  // AccessDeniedError in the handler body (distinct from dispatcher-level
  // role check, which also surfaces AccessDeniedError — both land on 403).
  r.writeHandler(
    "item:explicit-deny",
    z.object({}),
    async () =>
      writeFailure(
        new AccessDeniedError({
          message: "manual access deny",
          details: { reason: "manual_deny" },
        }),
      ),
    { access: { roles: ["Admin"] } },
  );

  // NotFoundError thrown directly as KumikoError (in query handler — proves
  // the throw-based path, not the writeFailure return-based path).
  r.queryHandler(
    "item:detail-strict",
    z.object({ id: z.uuid() }),
    async (event) => {
      throw new NotFoundError("item", event.payload.id);
    },
    { access: { openToAll: true } },
  );

  // InternalError auto-wrap: handler raises an unexpected TypeError; the
  // dispatcher wraps it so the wire body is the sanitized InternalError shape.
  r.writeHandler(
    "item:boom",
    z.object({}),
    async () => {
      throw new TypeError("cannot_read_prop");
    },
    { access: { roles: ["Admin"] } },
  );

  // Nested cause: user-thrown KumikoError with a .cause chain. The
  // forensic info should stay server-side (Log), while the response body
  // carries only the top-level class.
  r.writeHandler(
    "item:caused",
    z.object({}),
    async () => {
      const inner = new Error("upstream_service_blew_up");
      throw new ConflictError({
        message: "conflict caused by upstream",
        i18nKey: "errctr.errors.upstream",
        details: { reason: "upstream_blew_up" },
        cause: inner,
      });
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;
const guest = createTestUser({ id: 2, roles: ["Guest"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [errorFeature] });
  await unsafeCreateEntityTable(stack.db, itemEntity);
});
afterAll(async () => stack.cleanup());
beforeEach(async () => {
  stack.events.reset();
  await asRawClient(stack.db).unsafe(`DELETE FROM "${itemTable.tableName}"`);
});

// --- Helpers ---

type ErrorBody = {
  readonly code: string;
  readonly i18nKey: string;
  readonly message: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly timestamp: string;
};

type AnyUser = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly roles: readonly string[];
};

async function writeErrorBody(
  type: string,
  payload: unknown,
  user: AnyUser = admin,
): Promise<{ status: number; body: { isSuccess: false; error: ErrorBody } }> {
  const res = await stack.http.write(type, payload, user);
  const body = (await res.json()) as { isSuccess: false; error: ErrorBody };
  return { status: res.status, body };
}

// The invariant the client SDK keys off. Every 4xx/5xx from /write + /batch
// must satisfy it — independent of which Kumiko class produced the error.
function expectErrorShape(error: ErrorBody): void {
  expect(typeof error.code).toBe("string");
  expect(error.code.length).toBeGreaterThan(0);
  expect(typeof error.i18nKey).toBe("string");
  expect(error.i18nKey).toMatch(/^[a-z]/); // namespaced key, not a sentence
  expect(typeof error.message).toBe("string");
  expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
}

// =============================================================================
// One test per error class — status, code, i18nKey, details shape
// =============================================================================

describe("error contract: wire format per class", () => {
  test("ValidationError (Zod) → 400, details.fields[] with path + code + i18nKey", async () => {
    const { status, body } = await writeErrorBody("errctr:write:item:create-strict", { name: "x" });
    expect(status).toBe(400);
    expect(body.isSuccess).toBe(false);
    expectErrorShape(body.error);
    expect(body.error.code).toBe("validation_error");

    const details = body.error.details as {
      fields: Array<{ path: string; code: string; i18nKey: string }>;
    };
    expect(details.fields.length).toBeGreaterThan(0);
    const nameIssue = details.fields.find((f) => f.path === "name");
    expect(nameIssue).toBeDefined();
    expect(nameIssue?.code).toBe("too_small");
    expect(nameIssue?.i18nKey).toBe("errors.validation.too_small");
  });

  test("ValidationError (hook) → 400, details.fields carries hook-reported errors", async () => {
    const { status, body } = await writeErrorBody("errctr:write:item:create-for-hook", {
      name: "forbidden",
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_error");
    const details = body.error.details as { fields: Array<{ path: string; code: string }> };
    expect(details.fields).toContainEqual(
      expect.objectContaining({ path: "name", code: "name_is_forbidden" }),
    );
  });

  test("AccessDeniedError (handler throws) → 403, code access_denied", async () => {
    const { status, body } = await writeErrorBody("errctr:write:item:explicit-deny", {});
    expect(status).toBe(403);
    expect(body.error.code).toBe("access_denied");
    expectErrorShape(body.error);
    expect((body.error.details as { reason: string }).reason).toBe("manual_deny");
  });

  test("AccessDeniedError (dispatcher role check) → 403", async () => {
    const { status, body } = await writeErrorBody("errctr:write:item:create", { name: "x" }, guest);
    expect(status).toBe(403);
    expect(body.error.code).toBe("access_denied");
  });

  test("NotFoundError (thrown from query handler) → 404 via /query", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      {
        type: "errctr:query:item:detail-strict",
        payload: { id: "00000000-0000-4000-8000-000000000999" },
      },
      await authHeaders(admin),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: ErrorBody };
    expectErrorShape(body.error);
    expect(body.error.code).toBe("not_found");
    expect(body.error.details).toMatchObject({
      reason: "item_not_found",
      entity: "item",
      id: "00000000-0000-4000-8000-000000000999",
    });
  });

  test("NotFoundError (unknown write handler) → 404", async () => {
    const { status, body } = await writeErrorBody("errctr:write:item:nope", {});
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
    expect(body.error.details).toMatchObject({ entity: "handler", id: expect.any(String) });
  });

  test("ConflictError → 409, details carries the business reason", async () => {
    const { status, body } = await writeErrorBody("errctr:write:item:conflict", {});
    expect(status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.details).toMatchObject({ reason: "has_dependencies", blocker: "order" });
  });

  test("VersionConflictError → 409, details carries version info", async () => {
    const created = await stack.http.writeOk<{ id: number }>(
      "errctr:write:item:create",
      { name: "Widget" },
      admin,
    );
    // First update succeeds — current version becomes 2.
    await stack.http.writeOk(
      "errctr:write:item:update",
      { id: created.id, version: 1, changes: { name: "Widget v2" } },
      admin,
    );
    // Second update with the already-consumed version=1 → VersionConflictError.
    const { status, body } = await writeErrorBody("errctr:write:item:update", {
      id: created.id,
      version: 1,
      changes: { name: "Widget stale" },
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe("version_conflict");
    expect(body.error.details).toMatchObject({
      entityId: created.id,
      expectedVersion: 1,
      currentVersion: 2,
    });
  });

  test("UnprocessableError → 422, details.reason preserves the business reason", async () => {
    const { status, body } = await writeErrorBody("errctr:write:item:unprocessable", {});
    expect(status).toBe(422);
    expect(body.error.code).toBe("unprocessable");
    expect(body.error.details).toMatchObject({ reason: "already_fulfilled", stage: "ship" });
    expect(body.error.i18nKey).toBe("errctr.errors.alreadyFulfilled");
  });

  test("InternalError (auto-wrap) → 500, generic message; dev exposes cause, prod hides it", async () => {
    // Default test-Run läuft mit NODE_ENV !== "production" — dev-Modus exposed
    // die cause-Details (causeName/causeMessage/causeStack), damit Handler-
    // Bugs nicht als nackter "internal error" zurückkommen. Memory:
    // Framework-DX Fixes 2026-04-25.
    const dev = await writeErrorBody("errctr:write:item:boom", {});
    expect(dev.status).toBe(500);
    expect(dev.body.error.code).toBe("internal_error");
    // Generic message für Client (keine Stack-Leak im message-Feld), aber
    // details enthalten die cause-Zusammenfassung für DX.
    expect(dev.body.error.message).not.toContain("cannot_read_prop");
    expect(dev.body.error.details).toMatchObject({
      causeName: "TypeError",
      causeMessage: "cannot_read_prop",
    });

    // Production-Modus: details werden gestripped, der Stack lebt nur im Log.
    const prevEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const prod = await writeErrorBody("errctr:write:item:boom", {});
      expect(prod.status).toBe(500);
      expect(prod.body.error.code).toBe("internal_error");
      expect(prod.body.error).not.toHaveProperty("details");
      expect(prod.body.error.message).not.toContain("cannot_read_prop");
    } finally {
      if (prevEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevEnv;
    }
  });
});

// =============================================================================
// Cross-cutting: requestId, timestamp, cause-chain privacy
// =============================================================================

describe("error contract: cross-cutting guarantees", () => {
  test("every error response includes requestId when a header is supplied", async () => {
    const token = await stack.jwt.sign(admin);
    const res = await stack.app.request("/api/write", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Request-ID": "custom-err-req",
      },
      body: JSON.stringify({
        type: "errctr:write:item:conflict",
        payload: {},
      }),
    });
    const body = (await res.json()) as { isSuccess: false; error: ErrorBody };
    expect(body.error.requestId).toBe("custom-err-req");
  });

  test("error response contains an ISO timestamp", async () => {
    const { body } = await writeErrorBody("errctr:write:item:conflict", {});
    const parsed = new Date(body.error.timestamp);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    // Within a sensible window — not an epoch zero, not a year-3000 garbage
    // value — proves the serializer ran now and didn't copy a stale value.
    expect(Math.abs(Date.now() - parsed.getTime())).toBeLessThan(10_000);
  });

  test("cause chain stays server-side: response body has no cause field", async () => {
    const { body } = await writeErrorBody("errctr:write:item:caused", {});
    expect(body.error).not.toHaveProperty("cause");
    expect(body.error).not.toHaveProperty("stack");
    // The top-level error is exposed, but the "upstream_service_blew_up"
    // cause message must not leak through.
    expect(JSON.stringify(body.error)).not.toContain("upstream_service_blew_up");
  });
});

async function authHeaders(user: {
  id: string;
  tenantId: TenantId;
  roles: readonly string[];
}): Promise<Record<string, string>> {
  const token = await stack.jwt.sign(user);
  return { Authorization: `Bearer ${token}` };
}
