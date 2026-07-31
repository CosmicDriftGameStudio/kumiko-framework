// Regression coverage for kumiko-framework#1672 — preSave hooks were
// registered and boot-validated but never invoked by the dispatch path,
// making `r.hook("preSave", ...)` a silent no-op. This exercises the real
// HTTP dispatcher (not a hand-fed handler context) so the fix is proven at
// the layer app authors actually depend on.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

const contactEntity = createEntity({
  table: "presave_wiring_contacts",
  fields: {
    firstName: createTextField({ required: true }),
    lastName: createTextField({ required: true }),
    displayName: createTextField(),
  },
});

const seenIsNew: boolean[] = [];

const deriveDisplayName: import("../types").PreSaveHookFn = async (changes, ctx) => {
  seenIsNew.push(ctx.isNew);
  const first =
    (changes["firstName"] as string | undefined) ??
    (ctx.previous["firstName"] as string | undefined);
  const last =
    (changes["lastName"] as string | undefined) ?? (ctx.previous["lastName"] as string | undefined);
  return { ...changes, displayName: `${first ?? ""} ${last ?? ""}`.trim() };
};

const contactFeature = defineFeature("presave-wiring", (r) => {
  r.crud("contact", contactEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { openToAll: true } },
  });

  // preSave has no entity-wide `{ allOf }` shorthand (unlike postSave/
  // preDelete/postDelete) — r.crud registers separate create/update
  // handlers, so both need their own target.
  r.hook("preSave", "contact:create", deriveDisplayName);
  r.hook("preSave", "contact:update", deriveDisplayName);
});

const CREATE = "presave-wiring:write:contact:create";
const UPDATE = "presave-wiring:write:contact:update";

describe("preSave hooks — real dispatcher path (#1672)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [contactFeature] });
    await unsafeCreateEntityTable(stack.db, contactEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    seenIsNew.length = 0;
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "presave_wiring_contacts"');
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
});
