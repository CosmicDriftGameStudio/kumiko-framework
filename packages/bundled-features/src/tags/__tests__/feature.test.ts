import { describe, expect, test } from "bun:test";
import { createTagsFeature } from "../feature.ts";
import {
  assignTagPayloadSchema,
  createTagPayloadSchema,
  deleteTagPayloadSchema,
  rejectInvalidTagColorChange,
  removeTagPayloadSchema,
} from "../schemas.ts";
import { DEFAULT_TAG_ROLES } from "../web/constants.ts";

// Unit tests: feature-shape, role-options, schema-validation. The ES-loop
// behaviour (idempotent assign/remove, projection, tenant-isolation, read
// composition) needs a real stack → tags.integration.test.ts.

function writeAccess(
  feature: ReturnType<typeof createTagsFeature>,
  nameMatch: string,
): readonly string[] {
  const entry = Object.entries(feature.writeHandlers).find(([qn]) => qn.includes(nameMatch));
  if (!entry) throw new Error(`handler ${nameMatch} not registered`);
  const access = entry[1].access;
  if (!access || !("roles" in access)) throw new Error(`handler ${nameMatch} has no roles`);
  return access.roles;
}

function queryAccess(
  feature: ReturnType<typeof createTagsFeature>,
  nameMatch: string,
): readonly string[] {
  const entry = Object.entries(feature.queryHandlers).find(([qn]) => qn.includes(nameMatch));
  if (!entry) throw new Error(`query ${nameMatch} not registered`);
  const access = entry[1].access;
  if (!access || !("roles" in access)) throw new Error(`query ${nameMatch} has no roles`);
  return access.roles;
}

function rawWriteAccess(feature: ReturnType<typeof createTagsFeature>, nameMatch: string): unknown {
  const entry = Object.entries(feature.writeHandlers).find(([qn]) => qn.includes(nameMatch));
  if (!entry) throw new Error(`handler ${nameMatch} not registered`);
  return entry[1].access;
}

function rawQueryAccess(feature: ReturnType<typeof createTagsFeature>, nameMatch: string): unknown {
  const entry = Object.entries(feature.queryHandlers).find(([qn]) => qn.includes(nameMatch));
  if (!entry) throw new Error(`query ${nameMatch} not registered`);
  return entry[1].access;
}

describe("createTagsFeature shape", () => {
  test("registers tag + tag-assignment entities, catalog and assignment handlers", () => {
    const feature = createTagsFeature({ parents: ["credit"] });

    expect(Object.keys(feature.entities ?? {})).toEqual(
      expect.arrayContaining(["tag", "tag-assignment"]),
    );

    expect(Object.keys(feature.writeHandlers)).toEqual(
      expect.arrayContaining([
        "tag:create",
        "tag:update",
        "tag:delete",
        expect.stringMatching(/assign-tag/),
        expect.stringMatching(/remove-tag/),
      ]),
    );

    expect(Object.keys(feature.queryHandlers)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/tag:list/),
        expect.stringMatching(/tag-assignment:list/),
        "tag:detail",
      ]),
    );
  });
});

describe("createTagsFeature access-options", () => {
  test("with only parents: default roles on every path", () => {
    const feature = createTagsFeature({ parents: ["credit"] });
    expect(writeAccess(feature, "tag:create")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(writeAccess(feature, "tag:update")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(writeAccess(feature, "tag:delete")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(writeAccess(feature, "assign-tag")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(writeAccess(feature, "remove-tag")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(queryAccess(feature, "tag:list")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(queryAccess(feature, "tag-assignment:list")).toEqual([...DEFAULT_TAG_ROLES]);
  });

  test("roles option overrides every write- and query-path", () => {
    const feature = createTagsFeature({ parents: ["credit"], roles: ["Admin", "Editor"] });
    expect(writeAccess(feature, "tag:create")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "tag:update")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "tag:delete")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "assign-tag")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "remove-tag")).toEqual(["Admin", "Editor"]);
    expect(queryAccess(feature, "tag:list")).toEqual(["Admin", "Editor"]);
    expect(queryAccess(feature, "tag-assignment:list")).toEqual(["Admin", "Editor"]);
  });

  test("access:{openToAll} applies to every write- and query-path", () => {
    const feature = createTagsFeature({ parents: ["credit"],
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    for (const path of [
      "tag:create",
      "tag:update",
      "tag:delete",
      "assign-tag",
      "remove-tag",
    ]) {
      expect(rawWriteAccess(feature, path)).toEqual({
        openToAll: { reason: "test handler callable by any signed-in test user" },
      });
    }
    for (const query of ["tag:list", "tag:detail", "tag-assignment:list"]) {
      expect(rawQueryAccess(feature, query)).toEqual({
        openToAll: { reason: "test handler callable by any signed-in test user" },
      });
    }
  });

  test("access takes precedence over the roles shorthand", () => {
    const feature = createTagsFeature({ parents: ["credit"],
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      roles: ["Admin"],
    });
    expect(rawWriteAccess(feature, "tag:create")).toEqual({
      openToAll: { reason: "test handler callable by any signed-in test user" },
    });
    expect(rawQueryAccess(feature, "tag:list")).toEqual({
      openToAll: { reason: "test handler callable by any signed-in test user" },
    });
  });

  test("access:{roles} threads through like the roles shorthand", () => {
    const feature = createTagsFeature({ parents: ["credit"], access: { roles: ["Owner"] } });
    expect(writeAccess(feature, "remove-tag")).toEqual(["Owner"]);
    expect(queryAccess(feature, "tag-assignment:list")).toEqual(["Owner"]);
  });
});

describe("createTagsFeature toggleable-option (tier-gating)", () => {
  test("without toggleable: feature is always-on (toggleableDefault undefined)", () => {
    expect(createTagsFeature({ parents: ["credit"] }).toggleableDefault).toBeUndefined();
    expect(
      createTagsFeature({ parents: ["credit"],
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      }).toggleableDefault,
    ).toBeUndefined();
  });

  test("toggleable:{default:false} makes the feature tier-gatable, fail-closed", () => {
    const feature = createTagsFeature({ parents: ["credit"],
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      toggleable: { default: false },
    });
    expect(feature.toggleableDefault).toBe(false);
  });

  test("toggleable:{default:true} declares toggleable, enabled-by-default", () => {
    expect(createTagsFeature({ parents: ["credit"], toggleable: { default: true } }).toggleableDefault).toBe(true);
  });

  test("toggleable alone (no access/roles) keeps the default roles", () => {
    const feature = createTagsFeature({ parents: ["credit"], toggleable: { default: false } });
    // access still defaults when only toggleable is set
    expect(writeAccess(feature, "tag:create")).toEqual([...DEFAULT_TAG_ROLES]);
  });
});

describe("createTagPayloadSchema", () => {
  test("accepts name only", () => {
    expect(createTagPayloadSchema.safeParse({ name: "Kunde Müller" }).success).toBe(true);
  });

  test("accepts name + color", () => {
    expect(createTagPayloadSchema.safeParse({ name: "VIP", color: "#d4af37" }).success).toBe(true);
  });

  test("rejects empty name", () => {
    expect(createTagPayloadSchema.safeParse({ name: "" }).success).toBe(false);
  });

  test("rejects name over 64 chars", () => {
    expect(createTagPayloadSchema.safeParse({ name: "x".repeat(65) }).success).toBe(false);
  });
});

describe("createTagPayloadSchema colour", () => {
  test("accepts #abc and the empty string", () => {
    expect(createTagPayloadSchema.safeParse({ name: "a", color: "#abc" }).success).toBe(true);
    expect(createTagPayloadSchema.safeParse({ name: "a", color: "" }).success).toBe(true);
  });

  test("rejects a colour that is not a hex code", () => {
    expect(createTagPayloadSchema.safeParse({ name: "a", color: "red" }).success).toBe(false);
  });
});

describe("rejectInvalidTagColorChange", () => {
  test("flags a non-hex colour in changes", () => {
    expect(rejectInvalidTagColorChange({ changes: { color: "red" } })).toEqual([
      { field: "color", error: "invalid_color" },
    ]);
  });

  test("passes a hex colour, an empty colour and changes without colour", () => {
    expect(rejectInvalidTagColorChange({ changes: { color: "#fff" } })).toBeNull();
    expect(rejectInvalidTagColorChange({ changes: { color: "" } })).toBeNull();
    expect(rejectInvalidTagColorChange({ changes: { name: "x" } })).toBeNull();
  });
});

describe("deleteTagPayloadSchema", () => {
  test("accepts a bare id (no version — destructive intent)", () => {
    expect(deleteTagPayloadSchema.safeParse({ id: "tag-1" }).success).toBe(true);
  });

  test("rejects an empty id", () => {
    expect(deleteTagPayloadSchema.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("assign/remove payload schemas", () => {
  const valid = { tagId: "tag-1", entityType: "credit", entityId: "c-1" };

  test("accept a full (tag, entity) reference", () => {
    expect(assignTagPayloadSchema.safeParse(valid).success).toBe(true);
    expect(removeTagPayloadSchema.safeParse(valid).success).toBe(true);
  });

  test("reject missing entityId", () => {
    expect(assignTagPayloadSchema.safeParse({ tagId: "tag-1", entityType: "credit" }).success).toBe(
      false,
    );
  });

  test("reject empty tagId", () => {
    expect(assignTagPayloadSchema.safeParse({ ...valid, tagId: "" }).success).toBe(false);
  });

  test("reject entityId over 128 chars", () => {
    expect(assignTagPayloadSchema.safeParse({ ...valid, entityId: "x".repeat(129) }).success).toBe(
      false,
    );
  });
});
