import { describe, expect, test } from "bun:test";
import { DEFAULT_TAG_ROLES } from "../constants";
import { createTagsFeature } from "../feature";
import {
  assignTagPayloadSchema,
  createTagPayloadSchema,
  removeTagPayloadSchema,
  renameTagPayloadSchema,
} from "../schemas";

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
  test("registers tag + tag-assignment entities, 4 write-handlers, 2 query-handlers", () => {
    const feature = createTagsFeature();

    expect(Object.keys(feature.entities ?? {})).toEqual(
      expect.arrayContaining(["tag", "tag-assignment"]),
    );

    expect(Object.keys(feature.writeHandlers)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/create-tag/),
        expect.stringMatching(/rename-tag/),
        expect.stringMatching(/assign-tag/),
        expect.stringMatching(/remove-tag/),
      ]),
    );
    expect(Object.keys(feature.writeHandlers)).toHaveLength(4);

    expect(Object.keys(feature.queryHandlers)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/tag:list/),
        expect.stringMatching(/tag-assignment:list/),
      ]),
    );
    expect(Object.keys(feature.queryHandlers)).toHaveLength(2);
  });
});

describe("createTagsFeature access-options", () => {
  test("without options: singleton with default roles on every path", () => {
    const feature = createTagsFeature();
    expect(feature).toBe(createTagsFeature());
    expect(writeAccess(feature, "create-tag")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(writeAccess(feature, "rename-tag")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(writeAccess(feature, "assign-tag")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(writeAccess(feature, "remove-tag")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(queryAccess(feature, "tag:list")).toEqual([...DEFAULT_TAG_ROLES]);
    expect(queryAccess(feature, "tag-assignment:list")).toEqual([...DEFAULT_TAG_ROLES]);
  });

  test("roles option overrides every write- and query-path", () => {
    const feature = createTagsFeature({ roles: ["Admin", "Editor"] });
    expect(writeAccess(feature, "create-tag")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "rename-tag")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "assign-tag")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "remove-tag")).toEqual(["Admin", "Editor"]);
    expect(queryAccess(feature, "tag:list")).toEqual(["Admin", "Editor"]);
    expect(queryAccess(feature, "tag-assignment:list")).toEqual(["Admin", "Editor"]);
  });

  test("access:{openToAll} applies to every write- and query-path", () => {
    const feature = createTagsFeature({ access: { openToAll: true } });
    for (const path of ["create-tag", "rename-tag", "assign-tag", "remove-tag"]) {
      expect(rawWriteAccess(feature, path)).toEqual({ openToAll: true });
    }
    for (const query of ["tag:list", "tag-assignment:list"]) {
      expect(rawQueryAccess(feature, query)).toEqual({ openToAll: true });
    }
  });

  test("access takes precedence over the roles shorthand", () => {
    const feature = createTagsFeature({ access: { openToAll: true }, roles: ["Admin"] });
    expect(rawWriteAccess(feature, "create-tag")).toEqual({ openToAll: true });
    expect(rawQueryAccess(feature, "tag:list")).toEqual({ openToAll: true });
  });

  test("access:{roles} threads through like the roles shorthand", () => {
    const feature = createTagsFeature({ access: { roles: ["Owner"] } });
    expect(writeAccess(feature, "remove-tag")).toEqual(["Owner"]);
    expect(queryAccess(feature, "tag-assignment:list")).toEqual(["Owner"]);
  });
});

describe("createTagsFeature toggleable-option (tier-gating)", () => {
  test("without toggleable: feature is always-on (toggleableDefault undefined)", () => {
    expect(createTagsFeature().toggleableDefault).toBeUndefined();
    expect(createTagsFeature({ access: { openToAll: true } }).toggleableDefault).toBeUndefined();
  });

  test("toggleable:{default:false} makes the feature tier-gatable, fail-closed", () => {
    const feature = createTagsFeature({
      access: { openToAll: true },
      toggleable: { default: false },
    });
    expect(feature.toggleableDefault).toBe(false);
  });

  test("toggleable:{default:true} declares toggleable, enabled-by-default", () => {
    expect(createTagsFeature({ toggleable: { default: true } }).toggleableDefault).toBe(true);
  });

  test("toggleable alone (no access/roles) builds a fresh, non-singleton feature", () => {
    const feature = createTagsFeature({ toggleable: { default: false } });
    expect(feature).not.toBe(createTagsFeature());
    // access still defaults when only toggleable is set
    expect(writeAccess(feature, "create-tag")).toEqual([...DEFAULT_TAG_ROLES]);
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

describe("renameTagPayloadSchema", () => {
  const valid = { id: "tag-1", version: 0, name: "Neu" };

  test("accepts id + version + name", () => {
    expect(renameTagPayloadSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects a missing version (optimistic lock is mandatory)", () => {
    expect(renameTagPayloadSchema.safeParse({ id: "tag-1", name: "Neu" }).success).toBe(false);
  });

  test("rejects an empty name", () => {
    expect(renameTagPayloadSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  test("rejects a name over 64 chars", () => {
    expect(renameTagPayloadSchema.safeParse({ ...valid, name: "x".repeat(65) }).success).toBe(
      false,
    );
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
