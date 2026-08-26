import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { TAGS_EDIT_SCREEN_ID, TAGS_SCREEN_ID } from "../constants";
import { createTagsFeature } from "../feature";

// QN convention: entityList loads tags:query:tag:list; entityEdit loads
// tags:query:tag:detail and saves via tags:write:tag:{create,update,delete}.
// Legacy create-tag/update-tag/delete-tag stay registered for TagManager.

describe("tags catalog screens (entityList + entityEdit)", () => {
  const feature = createTagsFeature();

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

  test("convention handlers sit beside legacy create-tag/update-tag/delete-tag", () => {
    expect(Object.keys(feature.writeHandlers)).toEqual(
      expect.arrayContaining([
        "create-tag",
        "update-tag",
        "delete-tag",
        "tag:create",
        "tag:update",
        "tag:delete",
      ]),
    );
    expect(Object.keys(feature.queryHandlers)).toEqual(
      expect.arrayContaining(["tag:list", "tag:detail", "tag-assignment:list"]),
    );
  });

  test("createTagsFeature({ roles }) threads access onto both screens", () => {
    const custom = createTagsFeature({ roles: ["Admin"] });
    expect(custom.screens[TAGS_SCREEN_ID]?.access).toEqual({ roles: ["Admin"] });
    expect(custom.screens[TAGS_EDIT_SCREEN_ID]?.access).toEqual({ roles: ["Admin"] });
    expect(custom.writeHandlers["tag:delete"]?.access).toEqual({ roles: ["Admin"] });
  });
});
