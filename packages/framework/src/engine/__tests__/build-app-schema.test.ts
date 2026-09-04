// Tests für buildAppSchema. Drei Invarianten pinnen:
//   1. Multi-Feature: jedes Feature kommt mit eigenem featureName +
//      seinen Entities/Screens/Navs in der features-Liste an.
//   2. Workspaces werden mit aufgelösten navMembers (cross-feature
//      gemerged) auf AppSchema-Ebene gehoben.
//   3. JSON-Safety: function defaults und Zod-validators werden im
//      projection-Schritt rausgefiltert — sonst landet Server-Runtime
//      im Browser-Bundle.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildAppSchema, findNonJsonSafePath } from "../build-app-schema";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";
import type { EntityDefinition, MultiSelectFieldDef } from "../types/fields";
import type { ProjectionListScreenDefinition } from "../types/screen";

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

  // r.screen({ nav: {...} }) sugar must omit absent optional nav fields
  // rather than writing them as explicit `undefined` — a plain key-per-
  // field object literal makes `undefined` a real value in the schema,
  // which findNonJsonSafePath flags as a boot-time warning even though
  // JSON.stringify silently drops the key later. r.contentCollection()
  // already gets this right via a conditional spread; this pins the same
  // fix for r.screen().
  test("r.screen({ nav }) sugar omits absent optional nav fields instead of writing them as undefined", () => {
    const topLevelFeature = defineFeature("privacy", (r) => {
      r.screen({
        id: "privacy-center",
        type: "custom",
        renderer: { react: { __component: "PrivacyCenterScreen" } },
        nav: { label: "Privacy" },
      });
    });
    const nestedFeature = defineFeature("billing", (r) => {
      r.screen({
        id: "invoices",
        type: "custom",
        renderer: { react: { __component: "InvoicesScreen" } },
        nav: { label: "Invoices", parent: "billing:nav:overview" },
      });
    });

    const app = buildAppSchema(createRegistry([topLevelFeature, nestedFeature]));

    const privacyFeature = app.features.find((f) => f.featureName === "privacy");
    const topLevelNav = privacyFeature?.navs?.[0];
    if (!topLevelNav) throw new Error("privacy feature's nav entry is missing");
    expect("parent" in topLevelNav).toBe(false);
    expect("icon" in topLevelNav).toBe(false);
    expect("order" in topLevelNav).toBe(false);

    const billingFeature = app.features.find((f) => f.featureName === "billing");
    const nestedNav = billingFeature?.navs?.[0];
    if (!nestedNav) throw new Error("billing feature's nav entry is missing");
    expect(nestedNav.parent).toBe("billing:nav:overview");

    expect(findNonJsonSafePath(app, "schema")).toBeNull();
  });

  // #1059: r.translations({keys}) must flow into FeatureSchema.translations
  // BYTE-IDENTICAL — nav/screen labels resolve these keys verbatim via
  // t(label) client-side, so any re-prefixing (like the registry's internal
  // mergedTranslations does for features whose keys already carry a colon)
  // would break the lookup. Mirrors cap-counter's real shape exactly: nav
  // label references its own already-qualified translation key.
  test("r.translations landet verbatim in FeatureSchema.translations, ohne Re-Prefixing", () => {
    const capCounterLikeFeature = defineFeature("cap-counter", (r) => {
      r.nav({ id: "cap-list", label: "cap-counter:nav.cap-list" });
      r.translations({
        keys: {
          "cap-counter:nav.cap-list": { de: "Limits", en: "Caps" },
        },
      });
    });

    const app = buildAppSchema(createRegistry([capCounterLikeFeature]));
    const feature = app.features.find((f) => f.featureName === "cap-counter");

    expect(feature?.translations).toEqual({
      "cap-counter:nav.cap-list": { de: "Limits", en: "Caps" },
    });
  });

  // kumiko-framework#2034: createKumikoApp's boot diagnostic reads
  // `screens[].dormant` from the CLIENT schema, not from the registry —
  // this pins that the flag actually survives the server→client projection
  // instead of only living in the registry's verbatim `feature.screens`.
  test("custom screen's `dormant` flag survives the buildAppSchema projection verbatim (#2034)", () => {
    const dormantScreenFeature = defineFeature("privacy", (r) => {
      r.screen({
        id: "privacy-center",
        type: "custom",
        renderer: { react: { __component: "PrivacyCenterScreen" } },
        dormant: true,
      });
    });

    const app = buildAppSchema(createRegistry([dormantScreenFeature]));
    const screen = app.features.find((f) => f.featureName === "privacy")?.screens[0];

    expect(screen).toMatchObject({ id: "privacy-center", dormant: true });
  });

  // fw#2163: resolveTarget (renderer) reads screen.detailFor + screen.id
  // (short, unqualified) off the client FeatureSchema — this pins that both
  // survive the server→client projection verbatim, on a real registry-built
  // schema rather than a hand-rolled FeatureSchema literal.
  test("custom screen's `detailFor` survives the buildAppSchema projection, screen id stays unqualified (#2163)", () => {
    const propertyFeature = defineFeature("property", (r) => {
      r.entity("lease", {
        table: "leases",
        fields: { name: { type: "text" } },
      } as unknown as EntityDefinition);
      r.screen({
        id: "lease-detail",
        type: "custom",
        renderer: { react: { __component: "LeaseDetailScreen" } },
        detailFor: "lease",
      });
      r.translations({ keys: { "screen:lease-detail.title": { de: "Detail", en: "Detail" } } });
    });

    const app = buildAppSchema(createRegistry([propertyFeature]));
    const screen = app.features.find((f) => f.featureName === "property")?.screens[0];

    expect(screen).toMatchObject({ id: "lease-detail", detailFor: "lease" });
  });

  test("Feature ohne r.translations lässt das Feld weg (omit-undefined-Pattern)", () => {
    const f = defineFeature("bare", (r) => {
      r.nav({ id: "x", label: "X" });
    });
    const app = buildAppSchema(createRegistry([f]));
    expect(app.features[0]?.translations).toBeUndefined();
  });

  // #2062: buildAppSchema itself has no context, so the boot entrypoint
  // (createKumikoServer, runProdApp) forwards its own context.searchAdapter
  // presence check in via options.searchAdapterMissing.
  test("options.searchAdapterMissing: true landet auf jeder FeatureSchema", () => {
    const orderFeature = defineFeature("orders", (r) => {
      r.nav({ id: "list", label: "List" });
    });
    const fleetFeature = defineFeature("fleet", (r) => {
      r.nav({ id: "list", label: "List" });
    });
    const app = buildAppSchema(createRegistry([orderFeature, fleetFeature]), {
      searchAdapterMissing: true,
    });

    expect(app.features.length).toBeGreaterThan(0);
    expect(app.features.every((f) => f.searchAdapterMissing === true)).toBe(true);
  });

  test("options.searchAdapterMissing ohne/false lässt das Feld weg (omit-undefined-Pattern)", () => {
    const f = defineFeature("bare", (r) => {
      r.nav({ id: "x", label: "X" });
    });

    expect(buildAppSchema(createRegistry([f])).features[0]?.searchAdapterMissing).toBeUndefined();
    expect(
      buildAppSchema(createRegistry([f]), { searchAdapterMissing: false }).features[0]
        ?.searchAdapterMissing,
    ).toBeUndefined();
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

  test("Reference-Field: entity + labelField + multiple überleben die Projection", () => {
    // Regression: ohne diese Properties im Client-Schema baut der ReferenceInput
    // die Options-Query als `<feature>:query::list` (leeres refEntity) → 404 →
    // Dropdown zeigt „Keine Treffer" obwohl die referenzierte Entity Rows hat.
    const entity = {
      fields: {
        name: { type: "text" },
        parentId: { type: "reference", entity: "component", labelField: "name" },
        tags: { type: "reference", entity: "tag", labelField: "label", multiple: true },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["parentId"]?.["type"]).toBe("reference");
    expect(fields["parentId"]?.["entity"]).toBe("component");
    expect(fields["parentId"]?.["labelField"]).toBe("name");
    expect(fields["tags"]?.["entity"]).toBe("tag");
    expect(fields["tags"]?.["multiple"]).toBe(true);
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
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;
    expect(fields["active"]?.["default"]).toBe(false);
    expect(fields["count"]?.["default"]).toBe(0);
    expect(fields["label"]?.["default"]).toBe("");
  });

  test("filterable kommt ins Client-Schema (steuert die Faceted-Filter)", () => {
    const entity = {
      fields: {
        status: { type: "select", options: ["draft", "published"], filterable: true },
        name: { type: "text" },
      },
    } as unknown as EntityDefinition;
    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;
    expect(fields["status"]?.["filterable"]).toBe(true);
    // Felder ohne filterable tragen den Key nicht (kein false-Müll).
    expect(fields["name"]?.["filterable"]).toBeUndefined();
  });

  test("searchable kommt ins Client-Schema (steuert den EntityList-Default, #1194)", () => {
    const entity = {
      fields: {
        title: { type: "text", searchable: true },
        name: { type: "text" },
      },
    } as unknown as EntityDefinition;
    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;
    expect(fields["title"]?.["searchable"]).toBe(true);
    // Fields without searchable don't carry the key (no false-litter).
    expect(fields["name"]?.["searchable"]).toBeUndefined();
  });

  test("MultiSelect: display/columns/maxRows überleben die Projection (fw#2494)", () => {
    // Regression: without display in the client schema, render-field.tsx's
    // `field.display === "checkboxes"` check always falls through → the
    // renderer always shows the combobox, MultiSelectCheckboxes is unreachable.
    const entity = {
      fields: {
        tags: {
          type: "multiSelect",
          options: ["a", "b", "c"],
          display: "checkboxes",
          columns: 3,
          maxRows: 5,
        },
        categories: { type: "multiSelect", options: ["x", "y"] },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["tags"]?.["display"]).toBe("checkboxes");
    expect(fields["tags"]?.["columns"]).toBe(3);
    expect(fields["tags"]?.["maxRows"]).toBe(5);
    // Fields without display/columns/maxRows don't carry the keys (no false-litter).
    expect(fields["categories"]?.["display"]).toBeUndefined();
    expect(fields["categories"]?.["columns"]).toBeUndefined();
    expect(fields["categories"]?.["maxRows"]).toBeUndefined();
  });

  test("MultiSelectFieldDef: alle Keys sind in projectField bewusst eingeordnet", () => {
    // Bounded completeness check, scoped to MultiSelectFieldDef's own key set
    // (packages/types/src/fields.ts) — NOT a general FieldDefinition lockstep.
    // A full-union version would have to classify every property of all 20
    // FieldDefinition variants as forwarded or server-only. fw#2497 closed the
    // gaps fw#2494 flagged for other variants (image's `capture`, embedded's
    // `derived`/`totals`/`totalsMatch`/`minItems`/`maxItems`, date's
    // `min`/`max`/`locale`, longText's `multiline`, array/object `default`) —
    // see the dedicated tests below. This check only covers the type this fix
    // actually touches.
    //
    // The `_allKeysClassified` assignment below is the actual guard: if
    // MultiSelectFieldDef ever gains a key that isn't in one of the two
    // lists, `Exclude<keyof MultiSelectFieldDef, Classified>` stops being
    // `never` and the assignment fails to typecheck — `bun run typecheck`
    // (part of `bun run kumiko check`) catches it even without touching this
    // test's runtime assertions.
    const FORWARDED_KEYS = [
      "type",
      "required",
      "filterable",
      "options",
      "display",
      "columns",
      "maxRows",
      "default", // array-valued for multiSelect — projectField's
      // isJsonSafeValue() (fw#2497) now recurses into arrays/plain
      // objects instead of only string/number/boolean/null.
    ] as const;

    const SERVER_ONLY_KEYS = [
      "sensitive", // controls write-response redaction, never rendered
      "access", // server-side authz check, not a renderer concern
      "pii", // PII classification, drives crypto/storage — not client-relevant
      "userOwned", // same: subject-key annotation, server/crypto-only
      "tenantOwned", // same: subject-key annotation, server/crypto-only
      "anonymize", // retention-cleanup callback, never serializable to JSON
      "allowPlaintext", // PII-audit reason string, not a renderer concern
      "lookupable", // blind-index equality lookup, server-side query concern
      "subjectRef", // GDPR-hook-coverage marker, not a renderer concern
    ] as const;

    type Classified = (typeof FORWARDED_KEYS)[number] | (typeof SERVER_ONLY_KEYS)[number];
    const _allKeysClassified: Exclude<keyof MultiSelectFieldDef, Classified> extends never
      ? true
      : never = true;

    const entity = {
      fields: {
        tags: {
          type: "multiSelect",
          required: true,
          filterable: true,
          options: ["a", "b"],
          default: ["a"],
          display: "checkboxes",
          columns: 2,
          maxRows: 4,
          sensitive: true,
          access: { read: ["admin"] },
          pii: true,
          userOwned: { ownerField: "authorId" },
          tenantOwned: true,
          anonymize: () => "[ANONYMIZED]",
          allowPlaintext: "is_business_data",
          lookupable: true,
          subjectRef: true,
        },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const projected = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields["tags"] as Record<string, unknown>;

    for (const key of FORWARDED_KEYS) {
      expect(projected[key]).toBeDefined();
    }
    for (const key of SERVER_ONLY_KEYS) {
      expect(projected[key]).toBeUndefined();
    }
  });

  test("text/longText: multiline überlebt die Projection (fw#2497)", () => {
    // Regression: without `multiline` in the client schema, DefaultInput
    // always renders a single-line <input> — the textarea row count never
    // arrives.
    const entity = {
      fields: {
        notes: { type: "text", multiline: { rows: 6 } },
        bio: { type: "text", multiline: true },
        title: { type: "text" },
        body: { type: "longText", multiline: true },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["notes"]?.["multiline"]).toEqual({ rows: 6 });
    expect(fields["bio"]?.["multiline"]).toBe(true);
    expect(fields["body"]?.["multiline"]).toBe(true);
    // Fields without multiline don't carry the key (no false-litter).
    expect(fields["title"]?.["multiline"]).toBeUndefined();
  });

  test("number/date/timestamp/locatedTimestamp: min/max/locale überleben die Projection (fw#2497)", () => {
    // Regression: input bounds and locale overrides never arrived at the
    // renderer, so the browser's own range validation and date-picker
    // formatting were always off.
    const entity = {
      fields: {
        quantity: { type: "number", min: 0, max: 100 },
        birthday: { type: "date", min: "1900-01-01", max: "2026-08-28", locale: "de-DE" },
        startedAt: {
          type: "timestamp",
          min: "2020-01-01T00:00:00Z",
          max: "2030-01-01T00:00:00Z",
          locale: "de-DE",
        },
        pickupAt: {
          type: "locatedTimestamp",
          min: "2020-01-01T00:00:00",
          max: "2030-01-01T00:00:00",
          locale: "de-DE",
        },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["quantity"]?.["min"]).toBe(0);
    expect(fields["quantity"]?.["max"]).toBe(100);
    expect(fields["birthday"]?.["min"]).toBe("1900-01-01");
    expect(fields["birthday"]?.["max"]).toBe("2026-08-28");
    expect(fields["birthday"]?.["locale"]).toBe("de-DE");
    expect(fields["startedAt"]?.["min"]).toBe("2020-01-01T00:00:00Z");
    expect(fields["startedAt"]?.["locale"]).toBe("de-DE");
    expect(fields["pickupAt"]?.["max"]).toBe("2030-01-01T00:00:00");
    expect(fields["pickupAt"]?.["locale"]).toBe("de-DE");
  });

  test("image: capture überlebt die Projection (fw#2497)", () => {
    // Regression: `capture` decides whether a mobile file picker opens the
    // rear or front camera — never arrived, so it never applied.
    const entity = {
      fields: {
        idPhoto: { type: "image", capture: "environment" },
        avatar: { type: "image" },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["idPhoto"]?.["capture"]).toBe("environment");
    expect(fields["avatar"]?.["capture"]).toBeUndefined();
  });

  test("embedded: minItems/maxItems/derived/totals/totalsMatch überleben die Projection (fw#2497)", () => {
    // Regression: `totals` carries "Renderer metadata: numeric sub-field
    // names to sum in a totals row" in its own doc-comment but was never
    // forwarded — same for the other embedded-list renderer hints.
    const entity = {
      fields: {
        lines: {
          type: "embedded",
          multiple: true,
          schema: {
            qty: { type: "number" },
            amount: { type: "money" },
          },
          minItems: 1,
          maxItems: 20,
          derived: { amount: { op: "multiply", from: ["qty", "unitPrice"] } },
          totals: ["amount"],
          totalsMatch: { amount: "invoiceTotal" },
        },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["lines"]?.["minItems"]).toBe(1);
    expect(fields["lines"]?.["maxItems"]).toBe(20);
    expect(fields["lines"]?.["derived"]).toEqual({
      amount: { op: "multiply", from: ["qty", "unitPrice"] },
    });
    expect(fields["lines"]?.["totals"]).toEqual(["amount"]);
    expect(fields["lines"]?.["totalsMatch"]).toEqual({ amount: "invoiceTotal" });
  });

  test("embedded: derived/totalsMatch mit Function eine Ebene tief bleiben blockiert (fw#2497)", () => {
    // Regression: a shallow `isPlainObject`/`Array.isArray` check alone
    // would let a function survive one level deep — `derived`/`totals`/
    // `totalsMatch`/`multiline` must go through isJsonSafeValue() too, not
    // just `default`.
    const entity = {
      fields: {
        lines: {
          type: "embedded",
          multiple: true,
          schema: { qty: { type: "number" } },
          derived: { amount: { op: "multiply", from: () => ["qty"] } },
          totals: [() => "amount"],
          totalsMatch: { amount: () => "invoiceTotal" },
        },
        multi: { type: "text", multiline: { rows: () => 4 } },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["lines"]?.["derived"]).toBeUndefined();
    expect(fields["lines"]?.["totals"]).toBeUndefined();
    expect(fields["lines"]?.["totalsMatch"]).toBeUndefined();
    expect(fields["multi"]?.["multiline"]).toBeUndefined();
  });

  test("default: JSON-safe Arrays/Objects überleben die Projection, Nicht-JSON-Werte bleiben blockiert (fw#2497)", () => {
    // isJsonSafeValue() now recurses into arrays/plain objects instead of
    // only accepting string/number/boolean/null — but the defense-in-depth
    // against smuggled function/class-instance defaults must still hold.
    const entity = {
      fields: {
        tags: { type: "multiSelect", options: ["a", "b"], default: ["a"] },
        nested: { type: "text", default: { rows: [1, "x"], flag: true } },
        brokenFn: { type: "text", default: () => "x" },
        brokenClass: { type: "text", default: new Date() },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity("thing", entity);
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["tags"]?.["default"]).toEqual(["a"]);
    expect(fields["nested"]?.["default"]).toEqual({ rows: [1, "x"], flag: true });
    expect(fields["brokenFn"]?.["default"]).toBeUndefined();
    expect(fields["brokenClass"]?.["default"]).toBeUndefined();
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
            rowClick: true,
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
    const actions = screen?.rowActions as Array<{
      id: string;
      visible?: unknown;
      rowClick?: unknown;
    }>;
    expect(actions?.find((a) => a.id === "open")?.visible).toEqual({
      field: "status",
      ne: "archived",
    });
    expect(actions?.find((a) => a.id === "archive")?.visible).toEqual({
      field: "status",
      eq: "open",
    });
    expect(actions?.find((a) => a.id === "always")?.visible).toBe(true);

    // rowClick (skalares Flag) überlebt die JSON-Projektion — nicht gedroppt.
    expect(actions?.find((a) => a.id === "open")?.rowClick).toBe(true);
  });

  test("derivedFields werden ins Client-Schema projiziert (valueType, ohne derive-fn)", () => {
    // Regression: projectEntity ließ derivedFields ganz weg → der Client kannte
    // sie nicht, computeListViewModel warf "references unknown field" für jede
    // derived entityList-Spalte (z.B. bauspar `phase`). Der executor hängt den
    // Wert server-seitig an die Row; der Client braucht nur den valueType.
    const contractEntity = {
      table: "contracts",
      fields: { name: { type: "text" } },
      derivedFields: {
        phase: { valueType: "text", derive: () => "saving" },
        balance: { valueType: "decimal", derive: () => 0 },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("credit", (r) => {
      r.entity("contract", contractEntity);
      r.screen({
        id: "list",
        type: "entityList",
        entity: "contract",
        columns: ["name", "phase", "balance"],
      });
    });

    const app = buildAppSchema(createRegistry([f]));
    const entity = app.features.find((feat) => feat.featureName === "credit")?.entities["contract"];

    expect(entity?.derivedFields?.["phase"]?.valueType).toBe("text");
    expect(entity?.derivedFields?.["balance"]?.valueType).toBe("decimal");
    // derive-fn ist Server-only — darf NICHT durchkommen (sonst Funktions-Leak
    // im Browser-Bundle, den die JSON-Safety-Guard fängt).
    expect(entity?.derivedFields?.["phase"]).not.toHaveProperty("derive");
    expect(findNonJsonSafePath(app, "schema")).toBeNull();
  });

  // fw#2165: projectionList's searchable/sortable/paginated are derived from
  // the bound query handler's Zod schema, not authored — see
  // deriveProjectionListCapabilities in build-app-schema.ts.
  test("projectionList: search/sort/cursor in the query schema become derived capabilities (fw#2165)", () => {
    const f = defineFeature("ledger", (r) => {
      r.queryHandler(
        "schedule:list",
        z.object({
          search: z.string().optional(),
          sort: z.string().optional(),
          cursor: z.string().optional(),
        }),
        async () => ({ rows: [], nextCursor: null }),
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
      });
    });

    const app = buildAppSchema(createRegistry([f]));
    const screen = app.features[0]?.screens[0] as ProjectionListScreenDefinition;
    expect(screen.searchable).toBe(true);
    expect(screen.sortable).toBe(true);
    expect(screen.paginated).toBe(true);
  });

  test("projectionList: a query schema without search/sort/cursor derives no capability", () => {
    const f = defineFeature("ledger", (r) => {
      r.queryHandler("schedule:list", z.object({}), async () => ({ rows: [], nextCursor: null }));
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
      });
    });

    const app = buildAppSchema(createRegistry([f]));
    const screen = app.features[0]?.screens[0] as ProjectionListScreenDefinition;
    expect(screen.searchable).toBe(false);
    expect(screen.sortable).toBe(false);
    expect(screen.paginated).toBe(false);
  });

  test("projectionList: a non-ZodObject query schema (z.union) derives no capability and doesn't throw", () => {
    const f = defineFeature("ledger", (r) => {
      r.queryHandler(
        "schedule:list",
        z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
        async () => ({ rows: [], nextCursor: null }),
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
      });
    });

    let app: ReturnType<typeof buildAppSchema> | undefined;
    expect(() => {
      app = buildAppSchema(createRegistry([f]));
    }).not.toThrow();
    const screen = app?.features[0]?.screens[0] as ProjectionListScreenDefinition;
    expect(screen.searchable).toBe(false);
    expect(screen.sortable).toBe(false);
    expect(screen.paginated).toBe(false);
  });

  test("projectionList: author-written searchable:false survives even when the schema accepts search", () => {
    const f = defineFeature("ledger", (r) => {
      r.queryHandler("schedule:list", z.object({ search: z.string().optional() }), async () => ({
        rows: [],
        nextCursor: null,
      }));
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: false,
      });
    });

    const app = buildAppSchema(createRegistry([f]));
    const screen = app.features[0]?.screens[0] as ProjectionListScreenDefinition;
    expect(screen.searchable).toBe(false);
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
