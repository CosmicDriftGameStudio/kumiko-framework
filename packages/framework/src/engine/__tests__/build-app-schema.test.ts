// Tests für buildAppSchema. Drei Invarianten pinnen:
//   1. Multi-Feature: jedes Feature kommt mit eigenem featureName +
//      seinen Entities/Screens/Navs in der features-Liste an.
//   2. Workspaces werden mit aufgelösten navMembers (cross-feature
//      gemerged) auf AppSchema-Ebene gehoben.
//   3. JSON-Safety: function defaults und Zod-validators werden im
//      projection-Schritt rausgefiltert — sonst landet Server-Runtime
//      im Browser-Bundle.

import { describe, expect, test } from "bun:test";
import { buildAppSchema, findNonJsonSafePath } from "../build-app-schema";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";
import type { EntityDefinition } from "../types/fields";

describe("buildAppSchema", () => {
  test("Multi-Feature: jedes Feature wird mit eigenem featureName projiziert", () => {
    const orderEntity = {
      table: "orders",
      fields: { label: { type: "text" } },
    } as unknown as EntityDefinition;
    const fleetEntity = {
      table: "vehicles",
      fields: { plate: { type: "text" } },
    } as unknown as EntityDefinition;

    const orderFeature = defineFeature("orders", (r) => {
      r.entity("order", orderEntity);
      r.screen({ id: "list", type: "entityList", entity: "order", columns: ["label"] });
      r.nav({ id: "list", label: "Order List" });
    });
    const fleetFeature = defineFeature("fleet", (r) => {
      r.entity("vehicle", fleetEntity);
      r.screen({ id: "list", type: "entityList", entity: "vehicle", columns: ["plate"] });
      r.nav({ id: "list", label: "Fleet List" });
    });

    const registry = createRegistry([orderFeature, fleetFeature]);
    const app = buildAppSchema(registry);

    expect(app.features.map((f) => f.featureName).sort()).toEqual(["fleet", "orders"]);
    const orders = app.features.find((f) => f.featureName === "orders");
    const fleet = app.features.find((f) => f.featureName === "fleet");
    expect(orders?.screens).toHaveLength(1);
    expect(orders?.navs).toHaveLength(1);
    expect(orders?.entities["order"]).toBeDefined();
    expect(fleet?.entities["vehicle"]).toBeDefined();
  });

  test("Workspaces — definition + aufgelöste navMembers landen auf AppSchema-Ebene", () => {
    const ordersFeature = defineFeature("orders", (r) => {
      r.nav({ id: "list", label: "List" });
    });
    const fleetFeature = defineFeature("fleet", (r) => {
      r.nav({ id: "vehicles", label: "Vehicles" });
    });
    const adminFeature = defineFeature("app", (r) => {
      r.workspace({
        id: "admin",
        label: "Admin",
        access: { openToAll: true },
        nav: ["orders:nav:list", "fleet:nav:vehicles"],
        default: true,
      });
    });

    const registry = createRegistry([ordersFeature, fleetFeature, adminFeature]);
    const app = buildAppSchema(registry);

    expect(app.workspaces).toHaveLength(1);
    const admin = app.workspaces?.[0];
    // Short id — Renderer matcht gegen URL-Segment ("/admin/...") und
    // erwartet die kurze Form. Registry intern qualifiziert, buildAppSchema
    // projeziert zurück auf short.
    expect(admin?.definition.id).toBe("admin");
    // Cross-feature merge: beide Members sind drin, der Workspace-Owner
    // (`app`) sieht die anderen Features ohne dass er sie importiert.
    expect(admin?.navMembers).toEqual(["orders:nav:list", "fleet:nav:vehicles"]);
  });

  test("Apps ohne Workspaces lassen das Feld weg (omit-undefined-Pattern)", () => {
    const f = defineFeature("only", (r) => {
      r.nav({ id: "x", label: "X" });
    });
    const app = buildAppSchema(createRegistry([f]));
    expect(app.workspaces).toBeUndefined();
  });

  test("JSON-Safety: Function-Defaults werden in der Projection rausgefiltert", () => {
    // Field mit function-default — typisch z.B. () => generateId(). Auf
    // dem Server legitimer Code, im Browser-Bundle aber unbrauchbar weil
    // die Function auf Server-Internals zugreifen würde. Projection muss
    // den default-Slot weglassen, nicht die Function durchlassen.
    const entity = {
      fields: {
        id: { type: "text", default: () => "would-be-runtime-id" },
        title: { type: "text" },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const projectedEntity = app.features[0]?.entities["thing"] as unknown as {
      fields: Record<string, Record<string, unknown>>;
    };
    const idField = projectedEntity.fields["id"];
    expect(idField).toBeDefined();
    expect(idField?.["default"]).toBeUndefined(); // Function abgewiesen
    expect(idField?.["type"]).toBe("text"); // type kommt durch
  });

  test("JSON-Safety: literal Defaults bleiben erhalten", () => {
    const entity = {
      fields: {
        active: { type: "boolean", default: false },
        count: { type: "number", default: 0 },
        label: { type: "text", default: "" },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]?.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;
    expect(fields["active"]?.["default"]).toBe(false);
    expect(fields["count"]?.["default"]).toBe(0);
    expect(fields["label"]?.["default"]).toBe("");
  });

  test("AppSchema ist via JSON.stringify roundtrip-sicher", () => {
    // Echter Smoke-Test des Vertrags — wenn jemand in den project-
    // Helper eine Function reinschmuggelt, würde das hier brennen.
    const entity = {
      fields: { id: { type: "text", default: () => "x" } },
    } as unknown as EntityDefinition;
    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
      r.nav({ id: "n", label: "N" });
      r.workspace({ id: "ws", label: "Ws", access: { openToAll: true } });
    });
    const app = buildAppSchema(createRegistry([f]));
    const json = JSON.stringify(app);
    const parsed = JSON.parse(json);
    // Feature-namen identisch nach Roundtrip
    expect(parsed.features[0].featureName).toBe("ent");
  });

  test("FormatSpec-Renderer + FieldCondition-RowActions überleben JSON-Roundtrip unverändert", () => {
    // Pinnt: FormatSpec ({ format: "timestamp" } etc.) ist JSON-sicher
    // und FieldCondition ({ field, eq/ne } | boolean) bleibt nach
    // JSON.parse(JSON.stringify(app)) deep-equal zum Original.
    const entity = {
      table: "events",
      fields: {
        id: { type: "text" },
        startedAt: { type: "timestamp" },
        status: { type: "text" },
        priority: { type: "number" },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ev", (r) => {
      r.entity("event", entity);
      r.screen({
        id: "list",
        type: "entityList",
        entity: "event",
        columns: [
          "id",
          { field: "startedAt", renderer: { format: "timestamp" as const } },
          { field: "priority", renderer: { format: "priority" as const, prefix: "P" } },
          { field: "status" },
        ],
        rowActions: [
          {
            kind: "navigate",
            id: "open",
            label: "Öffnen",
            screen: "detail",
            visible: { field: "status", ne: "archived" },
          },
          {
            kind: "navigate",
            id: "archive",
            label: "Archivieren",
            screen: "archive",
            visible: { field: "status", eq: "open" },
          },
          {
            kind: "navigate",
            id: "always",
            label: "Immer",
            screen: "view",
            visible: true,
          },
        ],
      });
    });

    const app = buildAppSchema(createRegistry([f]));
    const roundTripped = JSON.parse(JSON.stringify(app));

    // toStrictEqual: toEqual ignoriert undefined-Props und würde einen
    // Silent-Drop durch JSON.stringify genau NICHT fangen.
    expect(roundTripped).toStrictEqual(app);

    // Explizit: FormatSpec-Felder landen unverändert an
    const screen = roundTripped.features[0]?.screens[0];
    const cols = screen?.columns as Array<{ field?: string; renderer?: unknown }>;
    expect(cols?.find((c) => c.field === "startedAt")?.renderer).toEqual({
      format: "timestamp",
    });
    expect(cols?.find((c) => c.field === "priority")?.renderer).toEqual({
      format: "priority",
      prefix: "P",
    });

    // Explizit: FieldCondition-Varianten (eq, ne, boolean) landen unverändert an
    const actions = screen?.rowActions as Array<{ id: string; visible?: unknown }>;
    expect(actions?.find((a) => a.id === "open")?.visible).toEqual({
      field: "status",
      ne: "archived",
    });
    expect(actions?.find((a) => a.id === "archive")?.visible).toEqual({
      field: "status",
      eq: "open",
    });
    expect(actions?.find((a) => a.id === "always")?.visible).toBe(true);
  });
});

describe("findNonJsonSafePath", () => {
  test("findet eine Funktion ausserhalb von PlatformComponent-Slots mit Pfad", () => {
    const schema = { features: [{ label: () => "nope" }] };
    expect(findNonJsonSafePath(schema, "schema")).toBe("schema.features[0].label");
  });

  test("PlatformComponent-Slots ({ react, native }) sind opak — Komponenten-Funktionen erlaubt", () => {
    const schema = {
      features: [{ screens: [{ id: "s1", component: { react: () => null } }] }],
    };
    expect(findNonJsonSafePath(schema, "schema")).toBeNull();
  });

  test("faengt undefined, bigint und Klassen-Instanzen", () => {
    expect(findNonJsonSafePath({ a: undefined }, "schema")).toBe("schema.a");
    expect(findNonJsonSafePath({ a: 1n }, "schema")).toBe("schema.a");
    expect(findNonJsonSafePath({ a: new Map() }, "schema")).toBe("schema.a");
    expect(findNonJsonSafePath({ a: Number.NaN }, "schema")).toBe("schema.a");
  });

  test("normales JSON-Schema passiert ohne Befund", () => {
    expect(
      findNonJsonSafePath({ features: [{ name: "x", count: 3, on: true, opt: null }] }, "schema"),
    ).toBeNull();
  });
});
