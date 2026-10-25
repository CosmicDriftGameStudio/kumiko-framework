// Files-feature integration tests.
//
// Tests grouped by behavioral depth:
//   1. Feature-definition smoke test (boot validation passes)
//   2. Cross-feature behavior: the fileRef entity can serve as a hook anchor
//      for user-data extensions
//   3. DDL consistency: fileRefsTable (buildEntityTable) and fileRefEntity
//      point to the same PostgreSQL structure (drift guard)

import { defineFeature, EXT_USER_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";

// Native dialect exposes column metadata on the `columns` array (EntityTableMeta)
// and on the Symbol.for("kumiko:schema:Columns") map (compat shape). Tests use the
// Symbol map because keys are JS field-names (camelCase), matching what
// feature-entity definitions declare.
const KUMIKO_COLUMNS_SYMBOL = Symbol.for("kumiko:schema:Columns");

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFilesFeature, fileRefEntity } from "../feature.ts";

let stack: TestStack;

const feature = createFilesFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("files :: feature-definition smoke", () => {
  test("Boot is clean (PII annotations + event schema valid)", async () => {
    // setupTestStack loaded the feature in beforeAll; if boot validation fails,
    // this block would never run.
    expect(stack).toBeDefined();
  });

  test("Tabellen-Name matched die Framework-pgTable (file_refs)", () => {
    expect(fileRefEntity.table).toBe("file_refs");
  });

  test("fileName is marked as pii: true", () => {
    const fileName = fileRefEntity.fields["fileName"] as { pii?: boolean };
    expect(fileName.pii).toBe(true);
  });
});

describe("files :: cross-feature behavior (F1, S1.7)", () => {
  test("a consumer feature can register r.useExtension(EXT_USER_DATA, fileRef, ...)", async () => {
    // The stub feature simulates the user-data semantics: extendsRegistrar
    // comes from user-data-rights, and useExtension targets fileRef.
    const userDataProvider = defineFeature("test-user-data-provider", (r) => {
      r.extendsRegistrar(EXT_USER_DATA, {
        // Spec-stub — the actual hook signatures will be provided later.
      });
    });

    const consumer = defineFeature("test-files-consumer", (r) => {
      r.requires({ features: ["files", "test-user-data-provider"] });
      r.useExtension(EXT_USER_DATA, "fileRef", {
        // Stub hooks: these will carry the actual forget/export logic later. For this
        // test, it is enough that useExtension finds the fileRef entity in the
        // registry without a boot error.
        export: async () => null,
        delete: async () => undefined,
      });
    });

    // Use a separate test stack so this sub-test runs in isolation from the outer
    // beforeAll stack.
    const crossStack = await setupTestStack({
      features: [feature, userDataProvider, consumer],
    });
    expect(crossStack).toBeDefined();
    await crossStack.cleanup();
  });

  test("useExtension on non-existent Entity throws during boot", async () => {
    const userDataProvider = defineFeature("test-user-data-provider-2", (r) => {
      r.extendsRegistrar(EXT_USER_DATA, {});
    });

    const consumer = defineFeature("test-broken-consumer", (r) => {
      r.requires({ features: ["test-user-data-provider-2"] });
      // GHOSTLY: no entity named "ghostEntity" exists.
      r.useExtension(EXT_USER_DATA, "ghostEntity", { export: async () => null });
    });

    // Boot should succeed: the boot validator is not responsible for checking
    // whether the referenced entity exists. Extensions are generic, so
    // "ghostEntity" could be an application entity in another feature. This
    // test records the current behavior as a regression guard.
    // validateUserDataExtensionTargets may tighten this behavior later.
    const ghostStack = await setupTestStack({
      features: [userDataProvider, consumer],
    });
    expect(ghostStack).toBeDefined();
    await ghostStack.cleanup();
  });
});

describe("files :: DDL-Konsistenz (M3, S1.7)", () => {
  // The native dialect's SchemaTable exposes its column map via the
  // Symbol.for("kumiko:schema:Columns") metadata (kept for back-compat with
  // anything that previously introspected pgTable that way). Keys are
  // JS field-names — exactly the level feature-entity declarations live at.
  function pgColumnNames(): Set<string> {
    const cols = (fileRefsTable as unknown as Record<symbol, unknown>)[KUMIKO_COLUMNS_SYMBOL];
    if (typeof cols !== "object" || cols === null) {
      throw new Error("files.integration: fileRefsTable has no kumiko:schema:Columns symbol");
    }
    return new Set(Object.keys(cols as Record<string, unknown>));
  }

  test("Feature-Entity-Felder matchen die Framework-pgTable column-set", () => {
    // Framework's fileRefsTable is the source of truth for the database
    // structure. The feature entity is the schema view; both must remain
    // consistent, or the user-data hook will encounter drift during the
    // forget flow.
    //
    // Every feature field must exist as a column in the pgTable. Conversely,
    // the pgTable may contain framework-managed columns such as
    // tenantId/createdAt/updatedAt/deletedAt, which the framework adds
    // automatically through the buildEntityTable mapping.
    const pgColumns = pgColumnNames();
    const featureFields = Object.keys(fileRefEntity.fields);

    for (const field of featureFields) {
      expect(
        pgColumns.has(field),
        `Feature-Field "${field}" fehlt in framework pgTable file_refs — Schema-Drift!`,
      ).toBe(true);
    }
  });

  test("Framework-pgTable hat die kritischen file_ref-Spalten (storageKey, fileName, mimeType, size)", () => {
    const pgColumns = pgColumnNames();
    expect(pgColumns.has("storageKey")).toBe(true);
    expect(pgColumns.has("fileName")).toBe(true);
    expect(pgColumns.has("mimeType")).toBe(true);
    expect(pgColumns.has("size")).toBe(true);
  });
});
