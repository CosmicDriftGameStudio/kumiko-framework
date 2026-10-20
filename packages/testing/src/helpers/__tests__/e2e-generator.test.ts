import { describe, expect, test } from "bun:test";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createRegistry,
  createSelectField,
  createTextField,
  createTimestampField,
  defineEntityCreateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { generateE2ESpec, generateZodFixture } from "../e2e-generator.ts";

const taskEntity = createEntity({
  table: "tasks",
  fields: {
    title: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 200,
    }),
    done: createBooleanField({ default: false }),
    status: createSelectField({ options: ["todo", "doing", "done"] as const }),
  },
});

// Minimal feature with both screen types AND a create handler: the generator
// emits different kind combinations depending on what the screen contains, see
// buildListSpecs/buildEditSpecs.
function createTasksFeature() {
  return defineFeature("tasks", (r) => {
    r.systemScope();
    r.entity({ name: "task", ...taskEntity });
    r.writeHandler(
      defineEntityCreateHandler("task", taskEntity, {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      }),
    );
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
    // A select field must get "select", boolean "check", text "fill"; otherwise
    // the renderer emits .fill() for a dropdown and Playwright fails on the first
    // sample with a select field.
    expect(persists.fills).toEqual([
      { kind: "fill", field: "title", value: "e2e title" },
      { kind: "select", field: "status", value: "todo" },
      { kind: "check", field: "done", value: true },
    ]);
  });

  test("groups-only sections liefern Required-Felder, Fill-Ops und Text-Assertion", () => {
    const feature = defineFeature("tasks", (r) => {
      r.systemScope();
      r.entity({ name: "task", ...taskEntity });
      r.writeHandler(
        defineEntityCreateHandler("task", taskEntity, {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        }),
      );
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
          sections: [
            {
              title: "tasks:section.basics",
              groups: [
                { title: "tasks:group.core", fields: ["title", "status"] },
                { title: "tasks:group.state", fields: ["done"] },
              ],
            },
          ],
        },
      });
    });
    const specs = generateE2ESpec(createRegistry([feature]));
    const editSpecs = specs.filter((s) => s.screenQn === "tasks:screen:task-edit");

    const validates = editSpecs.find((s) => s.kind === "edit-validates-required");
    if (validates?.kind !== "edit-validates-required") throw new Error("unreachable");
    expect(validates.requiredFields).toEqual(["title"]);

    const persists = editSpecs.find((s) => s.kind === "edit-save-persists");
    if (persists?.kind !== "edit-save-persists") throw new Error("unreachable");
    expect(persists.fills).toEqual([
      { kind: "fill", field: "title", value: "e2e title" },
      { kind: "select", field: "status", value: "todo" },
      { kind: "check", field: "done", value: true },
    ]);
    expect(persists.identifyingField).toBe("title");
  });

  test("date emittiert fill, timestamp wird übersprungen (zwei Inputs seit #369)", () => {
    const entity = createEntity({
      table: "events",
      fields: {
        title: createTextField({ personal: false, reason: "test_fixture", required: true }),
        day: createDateField(),
        at: createTimestampField(),
      },
    });
    const feature = defineFeature("events", (r) => {
      r.systemScope();
      r.entity({ name: "event", ...entity });
      r.writeHandler(
        defineEntityCreateHandler("event", entity, {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        }),
      );
      r.screen({
        id: "event-edit",
        type: "entityEdit",
        entity: "event",
        layout: { sections: [{ title: "events:section", fields: ["title", "day", "at"] }] },
      });
    });
    const specs = generateE2ESpec(createRegistry([feature]));
    const persists = specs.find((s) => s.kind === "edit-save-persists");
    if (persists?.kind !== "edit-save-persists") throw new Error("unreachable");
    const filledFields = persists.fills.map((f) => f.field);
    // date: a text input, fillable generically. timestamp: date + time = two
    // inputs that break a single .fill() in Playwright strict mode.
    expect(filledFields).toContain("day");
    expect(filledFields).not.toContain("at");
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
    // Feature has screen + entity but no create handler (e.g. because writes
    // live in another feature variant). Without a handler the generator cannot
    // seed: list-renders stays, the fixture test is dropped instead of being
    // generated wrongly.
    const readOnly = defineFeature("read-only", (r) => {
      r.systemScope();
      r.entity({ name: "task", ...taskEntity });
      r.screen({ id: "list", type: "entityList", entity: "task", columns: ["title"] });
    });
    const specs = generateE2ESpec(createRegistry([readOnly]));
    expect(specs.map((s) => s.kind)).toEqual(["list-renders"]);
  });

  test("edit-save-persists has undefined listUrlPath when no matching list-screen exists", () => {
    // entityEdit without entityList, e.g. a detail page that is validated via SSE
    // refresh instead of navigation. The generator must still emit an
    // edit-save-persists spec, just without listUrlPath (the renderer then
    // verifies inside the edit view itself).
    const editOnly = defineFeature("edit-only", (r) => {
      r.systemScope();
      r.entity({ name: "task", ...taskEntity });
      r.writeHandler(
        defineEntityCreateHandler("task", taskEntity, {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        }),
      );
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
    // createTextField({ format: "email" }) must yield a mail-like fixture;
    // otherwise Zod validation on the server fails as soon as the generator
    // output runs against a real API.
    const contactEntity = createEntity({
      table: "contacts",
      fields: {
        name: createTextField({ personal: false, reason: "test_fixture", required: true }),
        email: createTextField({
          personal: false,
          reason: "test_fixture",
          required: true,
          format: "email",
        }),
        homepage: createTextField({ personal: false, reason: "test_fixture", format: "url" }),
      },
    });
    const feature = defineFeature("contacts", (r) => {
      r.systemScope();
      r.entity({ name: "contact", ...contactEntity });
      r.writeHandler(
        defineEntityCreateHandler("contact", contactEntity, {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        }),
      );
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
    // Covers the shape a real sample has: one feature with all three screen
    // types. Custom is skipped, list + edit yield their respective spec kinds.
    const mixed = defineFeature("mixed", (r) => {
      r.systemScope();
      r.entity({ name: "task", ...taskEntity });
      r.writeHandler(
        defineEntityCreateHandler("task", taskEntity, {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        }),
      );
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

  test("pipe (select-with-default, same shape schema-builder's z.preprocess produces) unwraps to the underlying type's fixture (fw#1712)", () => {
    const enumSchema = z.enum(["a", "b"]);
    const pipe = z.preprocess((value) => (value === "" ? "a" : value), enumSchema);
    expect(pipe._def.type).toBe("pipe");
    expect(generateZodFixture(pipe)).toBe("a");
  });
});
