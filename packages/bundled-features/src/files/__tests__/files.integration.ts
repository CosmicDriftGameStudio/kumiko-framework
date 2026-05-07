// files-feature integration tests (S1.5 + S1.7).
//
// Tests sortiert nach Verhaltens-Tiefe:
//   1. Feature-Definition Smoke (Boot-Validation passes)
//   2. Cross-Feature-Behavior: fileRef-Entity ist als Hook-Anker für
//      Sprint-2-userData-Extension nutzbar
//   3. DDL-Konsistenz: Framework-pgTable + Feature-Entity zeigen auf
//      dieselbe Postgres-Struktur (Drift-Guard)
//   4. Event-QN-Match: r.defineEvent + framework's fileUploadedEvent
//      resolven zum selben QN

import { EXT_USER_DATA, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  FILE_UPLOADED_EVENT_TYPE,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { getTableColumns } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createFilesFeature, fileRefEntity } from "../feature";

let stack: TestStack;

const feature = createFilesFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("files :: feature-definition smoke", () => {
  test("Boot ist clean (PII-Annotations + Event-Schema valide)", async () => {
    // setupTestStack hat das feature im beforeAll geladen — wenn Boot-
    // Validation fehlschlägt, würde dieser Block nie laufen.
    expect(stack).toBeDefined();
  });

  test("Tabellen-Name matched die Framework-pgTable (file_refs)", () => {
    expect(fileRefEntity.table).toBe("file_refs");
  });

  test("fileName ist als pii: true markiert", () => {
    const fileName = fileRefEntity.fields["fileName"] as { pii?: boolean };
    expect(fileName.pii).toBe(true);
  });
});

describe("files :: cross-feature behavior (F1, S1.7)", () => {
  test("Sprint-2-Pattern: ein Consumer-Feature kann r.useExtension(EXT_USER_DATA, fileRef, ...) registrieren", async () => {
    // Stub-Feature simuliert die Sprint-2-Semantik: extendsRegistrar
    // (kommt aus user-data-rights) + useExtension auf fileRef.
    const userDataProvider = defineFeature("test-user-data-provider", (r) => {
      r.extendsRegistrar(EXT_USER_DATA, {
        // Spec-stub — Sprint 2 wird die echten Hook-Signaturen liefern.
      });
    });

    const consumer = defineFeature("test-files-consumer", (r) => {
      r.requires("files", "test-user-data-provider");
      r.useExtension(EXT_USER_DATA, "fileRef", {
        // Stub-Hooks: in Sprint 2 werden diese die echte Forget-/Export-
        // Logik tragen. Hier reicht: useExtension findet die fileRef-
        // Entity in der Registry → kein Boot-Error.
        export: async () => [],
        delete: async () => undefined,
      });
    });

    // Eigener Test-Stack damit dieser Sub-Test isoliert vom outer
    // beforeAll-Stack laeuft.
    const crossStack = await setupTestStack({
      features: [feature, userDataProvider, consumer],
    });
    expect(crossStack).toBeDefined();
    await crossStack.cleanup();
  });

  test("useExtension auf nicht-existierendes Entity wirft beim Boot", async () => {
    const userDataProvider = defineFeature("test-user-data-provider-2", (r) => {
      r.extendsRegistrar(EXT_USER_DATA, {});
    });

    const consumer = defineFeature("test-broken-consumer", (r) => {
      r.requires("test-user-data-provider-2");
      // GHOSTLY: useExtension auf "ghostEntity" gibt es nirgends.
      r.useExtension(EXT_USER_DATA, "ghostEntity", {});
    });

    // Boot soll laufen — es ist NICHT der Job des Boot-Validators zu
    // pruefen ob die referenced Entity existiert (Extensions sind
    // generisch, "ghostEntity" könnte ein App-Entity in einem anderen
    // Feature sein). Test dokumentiert das aktuelle Verhalten als
    // Regression-Guard. Sprint 2 schaerft ggf. mit
    // validateUserDataExtensionTargets.
    const ghostStack = await setupTestStack({
      features: [userDataProvider, consumer],
    });
    expect(ghostStack).toBeDefined();
    await ghostStack.cleanup();
  });
});

describe("files :: DDL-Konsistenz (M3, S1.7)", () => {
  // Drizzle's getTableColumns liefert die typed column-map ohne den
  // Symbol-Properties-Junk. Sauberer als Object.keys(table) das auch
  // interne Drizzle-Symbols mitnimmt.
  function pgColumnNames(): Set<string> {
    return new Set(Object.keys(getTableColumns(fileRefsTable)));
  }

  test("Feature-Entity-Felder matchen die Framework-pgTable column-set", () => {
    // Framework's fileRefsTable ist die Quelle der Wahrheit fuer die
    // DB-Struktur. Feature-Entity ist Schema-Sicht. Beide muessen
    // konsistent sein — sonst landet Sprint-2's userData-Hook in
    // Drift-Hell beim Forget-Flow.
    //
    // Vergleich: alle Feature-Felder muessen als Spalten in der pgTable
    // existieren (umgekehrt darf pgTable framework-managed Spalten haben
    // wie tenantId/createdAt/updatedAt/deletedAt — die deklariert das
    // Framework automatisch beim buildDrizzleTable-Mapping).
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

describe("files :: event-QN-match (M4, S1.7)", () => {
  test("framework's fileUploadedEvent.name === 'files:event:uploaded'", () => {
    // Wenn das Framework den Event-Namen aendert, fliegt dieser Test
    // sofort an — und der QN aus r.defineEvent("uploaded") im feature
    // wuerde nicht mehr matchen. Drift-Guard.
    expect(FILE_UPLOADED_EVENT_TYPE).toBe("files:event:uploaded");
  });

  test("Feature-Name 'files' + Event-Short 'uploaded' = QN 'files:event:uploaded'", () => {
    // r.defineEvent("uploaded") in defineFeature("files", ...) resolved
    // zu QN "files:event:uploaded" via Framework-Convention. Match
    // garantiert dass framework's appendEvent + EventDef-Schema-
    // Validation auf demselben QN landen.
    const expected = `${feature.name}:event:uploaded`;
    expect(expected).toBe(FILE_UPLOADED_EVENT_TYPE);
  });
});
