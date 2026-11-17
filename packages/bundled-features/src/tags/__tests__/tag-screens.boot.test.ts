import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createTagsFeature } from "../feature.ts";
import { TAGS_EDIT_SCREEN_ID, TAGS_SCREEN_ID } from "../web/constants.ts";

// QN convention: entityList loads tags:query:tag:list; entityEdit loads
// tags:query:tag:detail and saves via tags:write:tag:{create,update,delete}.

describe("tags catalog screens (entityList + entityEdit)", () => {
  const feature = createTagsFeature({ parents: ["note"] });

  test("boot-validates with declarative tag-list + tag-edit", () => {
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("tag-list is entityList gated by default tag roles", () => {
    const list = feature.screens[TAGS_SCREEN_ID];
    expect(list?.type).toBe("entityList");
    expect(list?.access).toEqual({ roles: ["TenantAdmin", "TenantMember"] });
  });

  test("tag-edit is entityEdit with matching access", () => {
    const edit = feature.screens[TAGS_EDIT_SCREEN_ID];
    expect(edit?.type).toBe("entityEdit");
    expect(edit?.access).toEqual({ roles: ["TenantAdmin", "TenantMember"] });
  });

  test("catalog writes run only through the convention handlers", () => {
    expect(Object.keys(feature.writeHandlers)).toEqual(
      expect.arrayContaining(["tag:create", "tag:update", "tag:delete"]),
    );
    expect(Object.keys(feature.writeHandlers)).not.toContain("create-tag");
    expect(Object.keys(feature.writeHandlers)).not.toContain("update-tag");
    expect(Object.keys(feature.writeHandlers)).not.toContain("delete-tag");
    expect(Object.keys(feature.queryHandlers)).toEqual(
      expect.arrayContaining(["tag:list", "tag:detail", "tag-assignment:list"]),
    );
  });

  test("createTagsFeature({ parents, roles }) threads access onto both screens", () => {
    const custom = createTagsFeature({ parents: ["note"], roles: ["Admin"] });
    expect(custom.screens[TAGS_SCREEN_ID]?.access).toEqual({ roles: ["Admin"] });
    expect(custom.screens[TAGS_EDIT_SCREEN_ID]?.access).toEqual({ roles: ["Admin"] });
    expect(custom.writeHandlers["tag:delete"]?.access).toEqual({ roles: ["Admin"] });
  });

  test("convention write schemas accept entityEdit envelopes", () => {
    const createSchema = feature.writeHandlers["tag:create"]?.schema;
    const updateSchema = feature.writeHandlers["tag:update"]?.schema;
    const deleteSchema = feature.writeHandlers["tag:delete"]?.schema;
    expect(createSchema).toBeDefined();
    expect(updateSchema).toBeDefined();
    expect(deleteSchema).toBeDefined();
    expect(createSchema!.safeParse({ name: "x" }).success).toBe(true);
    const id = "00000000-0000-4000-8000-000000000001";
    expect(updateSchema!.safeParse({ id, version: 0, changes: { name: "x" } }).success).toBe(true);
    expect(deleteSchema!.safeParse({ id }).success).toBe(true);
  });
});
