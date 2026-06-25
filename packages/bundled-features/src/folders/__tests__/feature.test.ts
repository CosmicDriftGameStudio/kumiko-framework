import { describe, expect, test } from "bun:test";
import { DEFAULT_FOLDER_ROLES } from "../constants";
import { createFoldersFeature } from "../feature";
import { clearFolderPayloadSchema, setFolderPayloadSchema } from "../schemas";

// Unit tests: feature-shape, role-options, schema-validation. The ES-loop
// behaviour (single-membership set/move/clear, projection, tenant-isolation,
// read composition) needs a real stack → folders.integration.test.ts.

function writeAccess(
  feature: ReturnType<typeof createFoldersFeature>,
  nameMatch: string,
): readonly string[] {
  const entry = Object.entries(feature.writeHandlers).find(([qn]) => qn.includes(nameMatch));
  if (!entry) throw new Error(`handler ${nameMatch} not registered`);
  const access = entry[1].access;
  if (!access || !("roles" in access)) throw new Error(`handler ${nameMatch} has no roles`);
  return access.roles;
}

function queryAccess(
  feature: ReturnType<typeof createFoldersFeature>,
  nameMatch: string,
): readonly string[] {
  const entry = Object.entries(feature.queryHandlers).find(([qn]) => qn.includes(nameMatch));
  if (!entry) throw new Error(`query ${nameMatch} not registered`);
  const access = entry[1].access;
  if (!access || !("roles" in access)) throw new Error(`query ${nameMatch} has no roles`);
  return access.roles;
}

function rawWriteAccess(
  feature: ReturnType<typeof createFoldersFeature>,
  nameMatch: string,
): unknown {
  const entry = Object.entries(feature.writeHandlers).find(([qn]) => qn.includes(nameMatch));
  if (!entry) throw new Error(`handler ${nameMatch} not registered`);
  return entry[1].access;
}

describe("createFoldersFeature shape", () => {
  test("registers folder + folder-assignment entities, 5 write-handlers, 3 query-handlers", () => {
    const feature = createFoldersFeature();

    expect(Object.keys(feature.entities ?? {})).toEqual(
      expect.arrayContaining(["folder", "folder-assignment"]),
    );

    expect(Object.keys(feature.writeHandlers)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/folder:create/),
        expect.stringMatching(/folder:update/),
        expect.stringMatching(/folder:delete/),
        expect.stringMatching(/set-folder/),
        expect.stringMatching(/clear-folder/),
      ]),
    );
    expect(Object.keys(feature.writeHandlers)).toHaveLength(5);

    expect(Object.keys(feature.queryHandlers)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/folder:list/),
        expect.stringMatching(/folder:detail/),
        expect.stringMatching(/folder-assignment:list/),
      ]),
    );
    expect(Object.keys(feature.queryHandlers)).toHaveLength(3);
  });
});

describe("createFoldersFeature access-options", () => {
  test("without options: singleton with default roles on every path", () => {
    const feature = createFoldersFeature();
    expect(feature).toBe(createFoldersFeature());
    for (const path of [
      "folder:create",
      "folder:update",
      "folder:delete",
      "set-folder",
      "clear-folder",
    ]) {
      expect(writeAccess(feature, path)).toEqual([...DEFAULT_FOLDER_ROLES]);
    }
    expect(queryAccess(feature, "folder:list")).toEqual([...DEFAULT_FOLDER_ROLES]);
    expect(queryAccess(feature, "folder-assignment:list")).toEqual([...DEFAULT_FOLDER_ROLES]);
  });

  test("roles option overrides every write- and query-path", () => {
    const feature = createFoldersFeature({ roles: ["Admin", "Editor"] });
    expect(writeAccess(feature, "set-folder")).toEqual(["Admin", "Editor"]);
    expect(writeAccess(feature, "folder:create")).toEqual(["Admin", "Editor"]);
    expect(queryAccess(feature, "folder:list")).toEqual(["Admin", "Editor"]);
  });

  test("access:{openToAll} applies to every write- and query-path", () => {
    const feature = createFoldersFeature({ access: { openToAll: true } });
    for (const path of [
      "folder:create",
      "folder:update",
      "folder:delete",
      "set-folder",
      "clear-folder",
    ]) {
      expect(rawWriteAccess(feature, path)).toEqual({ openToAll: true });
    }
  });

  test("access takes precedence over the roles shorthand", () => {
    const feature = createFoldersFeature({ access: { openToAll: true }, roles: ["Admin"] });
    expect(rawWriteAccess(feature, "set-folder")).toEqual({ openToAll: true });
  });
});

describe("createFoldersFeature toggleable-option (tier-gating)", () => {
  test("without toggleable: feature is always-on (toggleableDefault undefined)", () => {
    expect(createFoldersFeature().toggleableDefault).toBeUndefined();
  });

  test("toggleable:{default:false} makes the feature tier-gatable, fail-closed", () => {
    const feature = createFoldersFeature({
      access: { openToAll: true },
      toggleable: { default: false },
    });
    expect(feature.toggleableDefault).toBe(false);
  });

  test("toggleable alone (no access/roles) builds a fresh, non-singleton feature", () => {
    const feature = createFoldersFeature({ toggleable: { default: false } });
    expect(feature).not.toBe(createFoldersFeature());
    expect(writeAccess(feature, "folder:create")).toEqual([...DEFAULT_FOLDER_ROLES]);
  });
});

describe("setFolderPayloadSchema", () => {
  const valid = { folderId: "f-1", entityType: "credit", entityId: "c-1" };

  test("accepts a full (folder, entity) reference", () => {
    expect(setFolderPayloadSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects missing folderId", () => {
    expect(
      setFolderPayloadSchema.safeParse({ entityType: "credit", entityId: "c-1" }).success,
    ).toBe(false);
  });

  test("rejects empty folderId", () => {
    expect(setFolderPayloadSchema.safeParse({ ...valid, folderId: "" }).success).toBe(false);
  });

  test("rejects entityId over 128 chars", () => {
    expect(setFolderPayloadSchema.safeParse({ ...valid, entityId: "x".repeat(129) }).success).toBe(
      false,
    );
  });
});

describe("clearFolderPayloadSchema", () => {
  test("accepts an entity reference (no folderId)", () => {
    expect(
      clearFolderPayloadSchema.safeParse({ entityType: "credit", entityId: "c-1" }).success,
    ).toBe(true);
  });

  test("rejects missing entityId", () => {
    expect(clearFolderPayloadSchema.safeParse({ entityType: "credit" }).success).toBe(false);
  });
});
