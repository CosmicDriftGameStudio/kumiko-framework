// Regression coverage for preSave hooks that were
// registered and boot-validated but never invoked by the dispatch path,
// making `r.hook({ type: "preSave", ... })` a silent no-op. This exercises the real
// HTTP dispatcher (not a hand-fed handler context) so the fix is proven at
// the layer app authors actually depend on.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient } from "../../db/query.ts";
import { eventsTable } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";
import { from } from "../ownership.ts";

const contactEntity = createEntity({
  table: "presave_wiring_contacts",
  fields: {
    firstName: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    lastName: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    displayName: createTextField({ personal: false, reason: "test_fixture" }),
    // authorId is never set by the client — only deriveAuthorId (a preSave
    // hook) writes it. secretNote's ownership rule checks authorId, so
    // create only succeeds if the hook ran BEFORE the field-ownership check
    // (see also event-store-executor-write.ts).
    authorId: createTextField({ personal: false, reason: "test_fixture" }),
    secretNote: createTextField({
      personal: false,
      reason: "test_fixture",
      access: { write: { User: from("user:id", "authorId") } },
    }),
  },
});

const seenIsNew: boolean[] = [];

const deriveDisplayName: import("../types/index.ts").PreSaveHookFn = async (changes, ctx) => {
  seenIsNew.push(ctx.isNew);
  const first =
    (changes["firstName"] as string | undefined) ??
    (ctx.previous["firstName"] as string | undefined);
  const last =
    (changes["lastName"] as string | undefined) ?? (ctx.previous["lastName"] as string | undefined);
  return { ...changes, displayName: `${first ?? ""} ${last ?? ""}`.trim() };
};

const deriveAuthorId: import("../types/index.ts").PreSaveHookFn = async (changes) => ({
  ...changes,
  authorId: TestUsers.user.id,
});

const THROWING_HOOK_MESSAGE = "business rule violated";
const throwOnPreSave: import("../types/index.ts").PreSaveHookFn = async () => {
  throw new Error(THROWING_HOOK_MESSAGE);
};

const codeEntity = createEntity({
  table: "presave_wiring_codes",
  fields: {
    code: createTextField({
      required: true,
      maxLength: 5,
      personal: false,
      reason: "test_fixture",
    }),
  },
});

const OVERLONG_CODE = "far-too-long";
let hookWritesInvalidCode = false;
const overwriteCodeWhenArmed: import("../types/index.ts").PreSaveHookFn = async (changes) =>
  hookWritesInvalidCode ? { ...changes, code: OVERLONG_CODE } : changes;

const codeFeature = defineFeature("presave-wiring-code", (r) => {
  r.crud("code", codeEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  });
  r.hook({ type: "preSave", target: "code:create", handler: overwriteCodeWhenArmed });
  r.hook({ type: "preSave", target: "code:update", handler: overwriteCodeWhenArmed });
});

const contactFeature = defineFeature("presave-wiring", (r) => {
  r.crud("contact", contactEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  });

  // preSave has no entity-wide `{ allOf }` shorthand (unlike postSave/
  // preDelete/postDelete) — r.crud registers separate create/update
  // handlers, so both need their own target.
  r.hook({ type: "preSave", target: "contact:create", handler: deriveDisplayName });
  r.hook({ type: "preSave", target: "contact:update", handler: deriveDisplayName });
  r.hook({ type: "preSave", target: "contact:create", handler: deriveAuthorId });
  r.hook({ type: "preSave", target: "contact:update", handler: deriveAuthorId });
});

const throwingEntity = createEntity({
  table: "presave_wiring_throwing",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});

const throwingFeature = defineFeature("presave-wiring-throw", (r) => {
  r.crud("thing", throwingEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  });
  r.hook({ type: "preSave", target: "thing:create", handler: throwOnPreSave });
});

const CREATE = "presave-wiring:write:contact:create";
const UPDATE = "presave-wiring:write:contact:update";
const CODE_CREATE = "presave-wiring-code:write:code:create";
const CODE_UPDATE = "presave-wiring-code:write:code:update";
const THROWING_CREATE = "presave-wiring-throw:write:thing:create";

describe("preSave hooks — real dispatcher path (#1672)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [contactFeature, throwingFeature, codeFeature] });
    await unsafeCreateEntityTable(stack.db, contactEntity);
    await unsafeCreateEntityTable(stack.db, throwingEntity);
    await unsafeCreateEntityTable(stack.db, codeEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    seenIsNew.length = 0;
    hookWritesInvalidCode = false;
    await resetTestTables(stack.db, [
      "presave_wiring_codes",
      eventsTable,
      "presave_wiring_contacts",
    ]);
  });

  test("create: preSave hook derives displayName before persistence", async () => {
    const res = await stack.http.write(
      CREATE,
      { firstName: "Marc", lastName: "Ristone" },
      TestUsers.user,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { data: { displayName: string } } };
    expect(data.data.displayName).toBe("Marc Ristone");
    expect(seenIsNew).toEqual([true]);
  });

  test("update: preSave hook sees previous row and re-derives displayName", async () => {
    const created = await stack.http.write(
      CREATE,
      { firstName: "Marc", lastName: "Ristone" },
      TestUsers.user,
    );
    const { data } = (await created.json()) as { data: { data: { id: string; version: number } } };

    const res = await stack.http.write(
      UPDATE,
      { id: data.data.id, version: data.data.version, changes: { lastName: "Kumiko" } },
      TestUsers.user,
    );
    expect(res.status).toBe(200);
    const { data: updated } = (await res.json()) as { data: { data: { displayName: string } } };
    expect(updated.data.displayName).toBe("Marc Kumiko");
    expect(seenIsNew).toEqual([true, false]);
  });

  test("preSave runs before ownership checks: field authz sees the hook-derived owner id", async () => {
    const res = await stack.http.write(
      CREATE,
      { firstName: "Marc", lastName: "Ristone", secretNote: "psst" },
      TestUsers.user,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { data: { secretNote: string } } };
    expect(data.data.secretNote).toBe("psst");
  });

  test("a throwing preSave hook maps to a clean writeFailure, not a 500", async () => {
    const res = await stack.http.write(THROWING_CREATE, { name: "x" }, TestUsers.user);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { message?: string } } };
    expect(body.error?.details?.message).toBe(THROWING_HOOK_MESSAGE);
  });

  test("create: a preSave hook returning a value the entity schema rejects is a 422, not a persisted row", async () => {
    hookWritesInvalidCode = true;
    const res = await stack.http.write(CODE_CREATE, { code: "ok" }, TestUsers.user);

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error?: { details?: { reason?: string; handler?: string } };
    };
    expect(JSON.stringify(body.error)).toContain("presave_hook_invalid_output");
    expect(body.error?.details?.handler).toBe("code:create");
    const rows = await asRawClient(stack.db).unsafe('SELECT 1 FROM "presave_wiring_codes"');
    expect(rows).toHaveLength(0);
  });

  test("update: a preSave hook returning a value the entity schema rejects is a 422", async () => {
    const created = await stack.http.write(CODE_CREATE, { code: "ok" }, TestUsers.user);
    expect(created.status).toBe(200);
    const { data } = (await created.json()) as { data: { data: { id: string } } };

    hookWritesInvalidCode = true;
    const res = await stack.http.write(
      CODE_UPDATE,
      { id: data.data.id, version: 1, changes: { code: "new" } },
      TestUsers.user,
    );

    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("presave_hook_invalid_output");
  });
});
