// Tests für buildAppSchema. Drei Invarianten pinnen:
//   1. Multi-Feature: jedes Feature kommt mit eigenem featureName +
//      seinen Entities/Screens/Navs in der features-Liste an.
//   2. Workspaces werden mit aufgelösten navMembers (cross-feature
//      gemerged) auf AppSchema-Ebene gehoben.
//   3. JSON-Safety: function defaults und Zod-validators werden im
//      projection-Schritt rausgefiltert — sonst landet Server-Runtime
//      im Browser-Bundle.

import { describe, expect, test } from "bun:test";
import { buildAppSchema } from "../build-app-schema";
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
});
