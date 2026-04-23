import ts from "typescript";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createBooleanField,
  createEntity,
  createRegistry,
  createSelectField,
  createTextField,
  defineEntityWriteHandler,
  defineFeature,
} from "../../engine";
import { generateE2ESpec, generateZodFixture, renderPlaywrightSpec } from "../e2e-generator";

const taskEntity = createEntity({
  table: "tasks",
  fields: {
    title: createTextField({ required: true, maxLength: 200 }),
    done: createBooleanField({ default: false }),
    status: createSelectField({ options: ["todo", "doing", "done"] as const }),
  },
});

// Minimal-Feature mit beiden Screen-Typen UND einem Create-Handler —
// abhängig davon was im Screen steht, emittiert der Generator andere
// Kind-Kombinationen, siehe buildListSpecs/buildEditSpecs.
function createTasksFeature() {
  return defineFeature("tasks", (r) => {
    r.systemScope();
    r.entity("task", taskEntity);
    r.writeHandler(defineEntityWriteHandler("task:create", taskEntity));
    r.screen({
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title", "status", "done"],
    });
    r.screen({
      id: "task-edit",
      type: "entityEdit",
      entity: "task",
      layout: {
        sections: [{ title: "tasks:section.basics", fields: ["title", "status", "done"] }],
      },
    });
  });
}

describe("generateE2ESpec", () => {
  test("emits list-renders + list-has-fixture-row for entityList screens", () => {
    const registry = createRegistry([createTasksFeature()]);
    const specs = generateE2ESpec(registry);

    const listSpecs = specs.filter((s) => s.screenQn === "tasks:screen:task-list");
    expect(listSpecs.map((s) => s.kind)).toEqual(["list-renders", "list-has-fixture-row"]);

    const fixtureSpec = listSpecs.find((s) => s.kind === "list-has-fixture-row");
    if (fixtureSpec?.kind !== "list-has-fixture-row") throw new Error("unreachable");
    expect(fixtureSpec.writeHandlerQn).toBe("tasks:write:task:create");
    expect(fixtureSpec.urlPath).toBe("/t/{tenant}/tasks/task-list");
    expect(fixtureSpec.fixture["title"]).toBe("e2e title");
    expect(fixtureSpec.identifyingValue).toBe("e2e title");
  });

  test("emits edit-validates-required + edit-save-persists for entityEdit screens", () => {
    const registry = createRegistry([createTasksFeature()]);
    const specs = generateE2ESpec(registry);

    const editSpecs = specs.filter((s) => s.screenQn === "tasks:screen:task-edit");
    expect(editSpecs.map((s) => s.kind)).toEqual(["edit-validates-required", "edit-save-persists"]);

    const validates = editSpecs.find((s) => s.kind === "edit-validates-required");
    if (validates?.kind !== "edit-validates-required") throw new Error("unreachable");
    expect(validates.requiredFields).toEqual(["title"]);

    const persists = editSpecs.find((s) => s.kind === "edit-save-persists");
    if (persists?.kind !== "edit-save-persists") throw new Error("unreachable");
    expect(persists.listUrlPath).toBe("/t/{tenant}/tasks/task-list");
    expect(persists.identifyingField).toBe("title");
    // Select-Field muss "select" bekommen, Boolean "check", Text "fill" —
    // sonst emittiert der Renderer .fill() für ein Dropdown und Playwright
    // zerschellt am ersten Sample mit Select-Feld.
    expect(persists.fills).toEqual([
      { kind: "fill", field: "title", value: "e2e title" },
      { kind: "select", field: "status", value: "todo" },
      { kind: "check", field: "done", value: true },
    ]);
  });

  test("accepts tenant-slug override", () => {
    const registry = createRegistry([createTasksFeature()]);
    const specs = generateE2ESpec(registry, { tenantPlaceholder: "acme" });
    expect(specs[0]?.urlPath).toMatch(/^\/t\/acme\//);
  });

  test("skips custom screens", () => {
    const feature = defineFeature("audit", (r) => {
      r.systemScope();
      r.screen({
        id: "log",
        type: "custom",
        renderer: { react: { __component: "X" } },
      });
    });
    const specs = generateE2ESpec(createRegistry([feature]));
    expect(specs).toEqual([]);
  });

  test("skips list-has-fixture-row when no create-handler is registered", () => {
    // Feature hat Screen + Entity aber keinen Create-Handler (z.B. weil
    // Writes noch in einer anderen Feature-Variante landen). Ohne Handler
    // kann der Generator nicht seeden — list-renders bleibt, der Fixture-
    // Test wird gespart statt falsch generiert.
    const readOnly = defineFeature("read-only", (r) => {
      r.systemScope();
      r.entity("task", taskEntity);
      r.screen({ id: "list", type: "entityList", entity: "task", columns: ["title"] });
    });
    const specs = generateE2ESpec(createRegistry([readOnly]));
    expect(specs.map((s) => s.kind)).toEqual(["list-renders"]);
  });

  test("edit-save-persists has undefined listUrlPath when no matching list-screen exists", () => {
    // entityEdit ohne entityList — z.B. Detail-Seite die über SSE Refresh
    // statt Navigation validiert wird. Der Generator muss trotzdem eine
    // edit-save-persists-Spec emittieren, nur ohne listUrlPath (Renderer
    // verifiziert dann im Edit-View selbst).
    const editOnly = defineFeature("edit-only", (r) => {
      r.systemScope();
      r.entity("task", taskEntity);
      r.writeHandler(defineEntityWriteHandler("task:create", taskEntity));
      r.screen({
        id: "edit",
        type: "entityEdit",
        entity: "task",
        layout: { sections: [{ title: "s", fields: ["title"] }] },
      });
    });
    const specs = generateE2ESpec(createRegistry([editOnly]));
    const persists = specs.find((s) => s.kind === "edit-save-persists");
    if (persists?.kind !== "edit-save-persists") throw new Error("unreachable");
    expect(persists.listUrlPath).toBeUndefined();
  });

  test("text-field formats (email/url) produce format-specific fixtures", () => {
    // createTextField({ format: "email" }) muss einen Mail-artigen Fixture
    // liefern — sonst schlägt die Zod-Validation am Server fehl, sobald
    // der Generator-Output gegen eine echte API läuft.
    const contactEntity = createEntity({
      table: "contacts",
      fields: {
        name: createTextField({ required: true }),
        email: createTextField({ required: true, format: "email" }),
        homepage: createTextField({ format: "url" }),
      },
    });
    const feature = defineFeature("contacts", (r) => {
      r.systemScope();
      r.entity("contact", contactEntity);
      r.writeHandler(defineEntityWriteHandler("contact:create", contactEntity));
      r.screen({
        id: "list",
        type: "entityList",
        entity: "contact",
        columns: ["name", "email", "homepage"],
      });
    });
    const specs = generateE2ESpec(createRegistry([feature]));
    const fixtureSpec = specs.find((s) => s.kind === "list-has-fixture-row");
    if (fixtureSpec?.kind !== "list-has-fixture-row") throw new Error("unreachable");
    expect(fixtureSpec.fixture["email"]).toMatch(/^e2e-email@/);
    expect(fixtureSpec.fixture["homepage"]).toBe("https://example.com");
  });

  test("mixed feature (list + edit + custom) — generates for list/edit, skips custom", () => {
    // Deckt das Shape ab das ein echtes Sample hat: ein Feature mit allen
    // drei Screen-Typen. Custom wird übersprungen, List + Edit liefern
    // ihre jeweiligen Spec-Kinds.
    const mixed = defineFeature("mixed", (r) => {
      r.systemScope();
      r.entity("task", taskEntity);
      r.writeHandler(defineEntityWriteHandler("task:create", taskEntity));
      r.screen({ id: "list", type: "entityList", entity: "task", columns: ["title"] });
      r.screen({
        id: "edit",
        type: "entityEdit",
        entity: "task",
        layout: { sections: [{ title: "mixed:s", fields: ["title"] }] },
      });
      r.screen({
        id: "dashboard",
        type: "custom",
        renderer: { react: { __component: "X" } },
      });
    });
    const specs = generateE2ESpec(createRegistry([mixed]));
    const screens = new Set(specs.map((s) => s.screenQn));
    expect(screens).toEqual(new Set(["mixed:screen:list", "mixed:screen:edit"]));
    expect(specs.map((s) => s.kind).sort()).toEqual([
      "edit-save-persists",
      "edit-validates-required",
      "list-has-fixture-row",
      "list-renders",
    ]);
  });
});

describe("generateZodFixture", () => {
  test("primitives", () => {
    expect(generateZodFixture(z.string())).toBe("e2e-fixture");
    expect(generateZodFixture(z.number())).toBe(1);
    expect(generateZodFixture(z.boolean())).toBe(true);
    expect(generateZodFixture(z.enum(["a", "b"]))).toBe("a");
  });

  test("string formats", () => {
    expect(generateZodFixture(z.email())).toBe("e2e@example.com");
    expect(generateZodFixture(z.url())).toBe("https://example.com");
    expect(generateZodFixture(z.uuid())).toBe("00000000-0000-4000-8000-000000000000");
  });

  test("optional + default unwrap", () => {
    expect(generateZodFixture(z.string().optional())).toBe("e2e-fixture");
    expect(generateZodFixture(z.number().default(42))).toBe(1);
  });

  test("unsupported types throw", () => {
    expect(() => generateZodFixture(z.object({}))).toThrow(/not supported yet/);
    expect(() => generateZodFixture(z.array(z.string()))).toThrow(/not supported yet/);
  });
});

describe("renderPlaywrightSpec", () => {
  test("produces stable output (snapshot)", () => {
    const registry = createRegistry([createTasksFeature()]);
    const specs = generateE2ESpec(registry);
    const source = renderPlaywrightSpec(specs);
    expect(source).toMatchSnapshot();
  });

  test("empty specs produce only the header", () => {
    const source = renderPlaywrightSpec([]);
    expect(source).toContain("@playwright/test");
    expect(source).not.toContain("test(");
  });

  test("rendered output is syntactically valid TypeScript", () => {
    // Schützt gegen Template-Bugs die der Snapshot nicht fängt: ein
    // vergessenes Semikolon, ein unbalancierter String, ein typo in
    // einer Type-Annotation. ts.transpileModule parst + emittiert —
    // Syntax-Fehler werden als diagnostics gemeldet. Semantik (fehlende
    // Playwright-Types) prüfen wir hier NICHT, das würde das Paket als
    // Dependency erzwingen.
    const registry = createRegistry([createTasksFeature()]);
    const specs = generateE2ESpec(registry);
    const source = renderPlaywrightSpec(specs);
    const result = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
      reportDiagnostics: true,
    });
    const syntaxErrors = (result.diagnostics ?? []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    );
    expect(syntaxErrors).toEqual([]);
  });
});
