// Tests for buildAppSchema. Three invariants are pinned:
//   1. Multi-feature: each feature reaches the features list with its own
//      featureName and its entities, screens, and navs.
//   2. Workspaces are promoted to AppSchema level with resolved, cross-feature
//      merged navMembers.
//   3. JSON safety: function defaults and Zod validators are filtered out
//      during projection; otherwise server runtime would enter the browser
//      bundle.

import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { buildAppSchema, findNonJsonSafePath } from "../build-app-schema.ts";
import { access, createSystemConfig, createTenantConfig } from "../config-helpers.ts";
import { defineFeature } from "../define-feature.ts";
import { defineEntityListHandler } from "../entity-handlers.ts";
import { createEntity, createTextField } from "../factories.ts";
import { createRegistry } from "../registry.ts";
import type { EntityDefinition, MultiSelectFieldDef } from "../types/fields.ts";
import type { ProjectionListScreenDefinition } from "../types/screen.ts";

describe("buildAppSchema", () => {
  test("Multi-Feature: each feature is projected with its own featureName", () => {
    const orderEntity = {
      table: "orders",
      fields: { label: { type: "text" } },
    } as unknown as EntityDefinition;
    const fleetEntity = {
      table: "vehicles",
      fields: { plate: { type: "text" } },
    } as unknown as EntityDefinition;

    const orderFeature = defineFeature("orders", (r) => {
      r.entity({ name: "order", ...orderEntity });
      r.screen({ id: "list", type: "entityList", entity: "order", columns: ["label"] });
      r.nav({ id: "list", label: "Order List" });
    });
    const fleetFeature = defineFeature("fleet", (r) => {
      r.entity({ name: "vehicle", ...fleetEntity });
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

    const iconFeature = defineFeature("receipts", (r) => {
      r.screen({
        id: "receipt-list",
        type: "custom",
        renderer: { react: { __component: "ReceiptListScreen" } },
        nav: { label: "Receipts", icon: "receipt", order: 10 },
      });
    });
    const explicitUndefinedNavFeature = defineFeature("undef-nav", (r) => {
      r.nav({ id: "x", label: "X", icon: undefined });
    });

    const app = buildAppSchema(
      createRegistry([topLevelFeature, nestedFeature, iconFeature, explicitUndefinedNavFeature]),
    );

    const iconNav = app.features.find((f) => f.featureName === "receipts")?.navs?.[0];
    expect(iconNav?.icon).toBe("receipt");
    expect(iconNav?.order).toBe(10);

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

  // r.translations({keys}) must flow into FeatureSchema.translations
  // BYTE-IDENTICAL — nav/screen labels resolve these keys verbatim via
  // t(label) client-side, so any re-prefixing (like the registry's internal
  // mergedTranslations does for features whose keys already carry a colon)
  // would break the lookup. Mirrors cap-counter's real shape exactly: nav
  // label references its own already-qualified translation key.
  test("r.translations is placed verbatim in FeatureSchema.translations, without re-prefixing", () => {
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

  // createKumikoApp's boot diagnostic reads
  // `screens[].dormant` from the CLIENT schema, not from the registry —
  // this pins that the flag actually survives the server→client projection
  // instead of only living in the registry's verbatim `feature.screens`.
  test("custom screen's `dormant` flag survives the buildAppSchema projection verbatim", () => {
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

  // resolveTarget (renderer) reads screen.detailFor + screen.id
  // (short, unqualified) off the client FeatureSchema — this pins that both
  // survive the server→client projection verbatim, on a real registry-built
  // schema rather than a hand-rolled FeatureSchema literal.
  test("custom screen's `detailFor` survives the buildAppSchema projection, screen id stays unqualified", () => {
    const propertyFeature = defineFeature("property", (r) => {
      r.entity({
        name: "lease",
        ...({
          table: "leases",
          fields: { name: { type: "text" } },
        } as unknown as EntityDefinition),
      });
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

  test("Feature without r.translations omits the field (omit-undefined pattern)", () => {
    const f = defineFeature("bare", (r) => {
      r.nav({ id: "x", label: "X" });
    });
    const app = buildAppSchema(createRegistry([f]));
    expect(app.features[0]?.translations).toBeUndefined();
  });

  // buildAppSchema itself has no context, so the boot entrypoint
  // (createKumikoServer, runProdApp) forwards its own context.searchAdapter
  // presence check in via options.searchAdapterMissing.
  test("options.searchAdapterMissing: true is included in every FeatureSchema", () => {
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

  test("options.searchAdapterMissing absent/false omits the field (omit-undefined pattern)", () => {
    const f = defineFeature("bare", (r) => {
      r.nav({ id: "x", label: "X" });
    });

    expect(buildAppSchema(createRegistry([f])).features[0]?.searchAdapterMissing).toBeUndefined();
    expect(
      buildAppSchema(createRegistry([f]), { searchAdapterMissing: false }).features[0]
        ?.searchAdapterMissing,
    ).toBeUndefined();
  });

  test("Workspaces — definition + resolved navMembers are placed at AppSchema level", () => {
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
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        nav: ["orders:nav:list", "fleet:nav:vehicles"],
        default: true,
      });
    });

    const registry = createRegistry([ordersFeature, fleetFeature, adminFeature]);
    const app = buildAppSchema(registry);

    expect(app.workspaces).toHaveLength(1);
    const admin = app.workspaces?.[0];
    // Short id — the renderer matches it against the URL segment ("/admin/...")
    // and expects the short form. The registry qualifies it internally, while
    // buildAppSchema projects it back to the short form.
    expect(admin?.definition.id).toBe("admin");
    // Cross-feature merge: both members are included, so the workspace owner
    // (`app`) can see the other features without importing them.
    expect(admin?.navMembers).toEqual(["orders:nav:list", "fleet:nav:vehicles"]);
  });

  test("Apps without Workspaces omit the field (omit-undefined pattern)", () => {
    const f = defineFeature("only", (r) => {
      r.nav({ id: "x", label: "X" });
    });
    const app = buildAppSchema(createRegistry([f]));
    expect(app.workspaces).toBeUndefined();
  });

  test("JSON-Safety: function defaults are filtered out in the projection", () => {
    // A function default is valid server-side, but unusable in the browser
    // bundle because it may access server internals. Projection must omit the
    // default slot rather than expose the function.
    const entity = {
      fields: {
        id: { type: "text", default: () => "would-be-runtime-id" },
        title: { type: "text" },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const projectedEntity = app.features[0]?.entities["thing"] as unknown as {
      fields: Record<string, Record<string, unknown>>;
    };
    const idField = projectedEntity.fields["id"];
    expect(idField).toBeDefined();
    expect(idField?.["default"]).toBeUndefined(); // Function abgewiesen
    expect(idField?.["type"]).toBe("text"); // type is preserved
  });

  test("JSON-Safety: non-finite number defaults are dropped, shared sub-objects survive", () => {
    const shared = { a: 1 };
    const entity = {
      fields: {
        nan: { type: "number", default: Number.NaN },
        inf: { type: "number", default: Number.POSITIVE_INFINITY },
        ok: { type: "text", default: { x: shared, y: shared } },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const thingEntity = app.features[0]?.entities["thing"] as unknown as {
      fields: Record<string, Record<string, unknown>>;
    };
    const fields = thingEntity.fields;
    expect(fields["nan"]?.["default"]).toBeUndefined();
    expect(fields["inf"]?.["default"]).toBeUndefined();
    expect(fields["ok"]?.["default"]).toEqual({ x: { a: 1 }, y: { a: 1 } });
  });

  test("Reference field: entity + labelField + multiple survive the projection", () => {
    // Regression: without these properties in the client schema, ReferenceInput
    // builds the options query as `<feature>:query::list` (with an empty
    // refEntity), causing a 404 and making the dropdown show „Keine Treffer"
    // even though the referenced entity has rows.
    const entity = {
      fields: {
        name: { type: "text" },
        parentId: { type: "reference", entity: "component", labelField: "name" },
        tags: { type: "reference", entity: "tag", labelField: "label", multiple: true },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
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
      r.entity({ name: "thing", ...entity });
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
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;
    expect(fields["status"]?.["filterable"]).toBe(true);
    // Fields without filterable omit the key (no `false` noise).
    expect(fields["name"]?.["filterable"]).toBeUndefined();
  });

  test("searchable is included in the client schema (controls the EntityList default)", () => {
    const entity = {
      fields: {
        title: { type: "text", searchable: true },
        name: { type: "text" },
      },
    } as unknown as EntityDefinition;
    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
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

  test("Select: display survives the projection so radio reaches the client schema", () => {
    const entity = {
      fields: {
        priority: { type: "select", options: ["low", "high"], display: "radio" },
        state: { type: "select", options: ["open", "closed"] },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["priority"]?.["display"]).toBe("radio");
    expect(fields["state"]?.["display"]).toBeUndefined();
  });

  test("MultiSelect: display/columns/maxRows survive the projection", () => {
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
      r.entity({ name: "thing", ...entity });
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

  test("Select: optionTones survive the projection", () => {
    const entity = {
      fields: {
        status: {
          type: "select",
          options: ["open", "closed"],
          optionTones: { closed: "bad" },
        },
        area: { type: "select", options: ["a", "b"] },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["status"]?.["optionTones"]).toEqual({ closed: "bad" });
    expect(fields["area"]?.["optionTones"]).toBeUndefined();
  });

  test("MultiSelectFieldDef: all keys are intentionally accounted for in projectField", () => {
    // Bounded completeness check, scoped to MultiSelectFieldDef's own key set
    // (packages/types/src/fields.ts) — NOT a general FieldDefinition lockstep.
    // A full-union version would have to classify every property of all 20
    // FieldDefinition variants as forwarded or server-only. The earlier fix
    // closed the gaps for other variants (image's `capture`, embedded's
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
      "optionsAvailabilityQuery",
      "default", // array-valued for multiSelect — projectField's
      // isJsonSafeValue() now recurses into arrays/plain
      // objects instead of only string/number/boolean/null.
      "sensitive", // write-response redaction server-side AND the renderer's prefill block
    ] as const;

    const SERVER_ONLY_KEYS = [
      "access", // server-side authz check, not a renderer concern
      "pii", // PII classification, drives crypto/storage — not client-relevant
      "userOwned", // same: subject-key annotation, server/crypto-only
      "tenantOwned", // same: subject-key annotation, server/crypto-only
      "recordOwned", // same: subject-key annotation, server/crypto-only
      "anonymize", // retention-cleanup callback, never serializable to JSON
      "allowPlaintext", // PII-audit reason string, not a renderer concern
      "lookupable", // blind-index equality lookup, server-side query concern
      "subjectRef", // GDPR-hook-coverage marker, not a renderer concern
      "description", // AI-agent manifest hint, never rendered to the user
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
          optionsAvailabilityQuery: "ent:query:tag-availability",
          sensitive: true,
          access: { read: ["admin"] },
          pii: true,
          userOwned: { ownerField: "authorId" },
          tenantOwned: true,
          anonymize: () => "[ANONYMIZED]",
          allowPlaintext: "is_business_data",
          lookupable: true,
          subjectRef: true,
          description: "tags for the thing",
        },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
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

  test("text/longText: multiline survives the projection", () => {
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
      r.entity({ name: "thing", ...entity });
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

  test("multiline.rows that is not a positive integer fails the build with the field name", () => {
    for (const rows of [0, -3, 2.5]) {
      const entity = {
        fields: { notes: { type: "text", multiline: { rows } } },
      } as unknown as EntityDefinition;
      const f = defineFeature("ent", (r) => {
        r.entity({ name: "thing", ...entity });
      });
      expect(() => buildAppSchema(createRegistry([f]))).toThrow(
        /"thing" field "notes": multiline\.rows must be a positive integer/,
      );
    }
  });

  test("multiline.rows that is not a positive integer on a configEdit screen field fails the build", () => {
    const f = defineFeature("cfg", (r) => {
      r.config({ keys: { note: createTenantConfig("text", { default: "" }) } });
      r.screen({
        id: "settings",
        type: "configEdit",
        scope: "tenant",
        configKeys: { note: "cfg:config:note" },
        fields: { note: { type: "text", multiline: { rows: 0 } } } as never,
        layout: { sections: [{ title: "Basics", fields: ["note"] }] } as never,
      });
    });
    expect(() => buildAppSchema(createRegistry([f]))).toThrow(
      /"cfg:settings" field "note": multiline\.rows must be a positive integer/,
    );
  });

  test("text: writeOnly survives the projection (the renderer picks the masked input from it)", () => {
    const entity = {
      fields: {
        apiKey: { type: "text", sensitive: true, writeOnly: true },
        plain: { type: "text" },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["apiKey"]?.["writeOnly"]).toBe(true);
    expect(fields["plain"]?.["writeOnly"]).toBeUndefined();
  });

  test("a generated settings screen keeps writeOnly on a secret config key's field", () => {
    const vault = defineFeature("vault", (r) => {
      r.config({
        keys: {
          stripeSecret: createSystemConfig("text", {
            write: access.systemAdmin,
            backing: "secrets",
            mask: { title: "vault.stripe-secret" },
          }),
        },
      });
    });
    const app = buildAppSchema(createRegistry([vault]));
    const screens = app.features.flatMap((feature) => feature.screens ?? []);
    const settings = screens.find((candidate) => candidate.type === "configEdit");
    if (settings?.type !== "configEdit") throw new Error("no generated configEdit screen");
    expect(settings.fields["stripe-secret"]).toMatchObject({ type: "text", writeOnly: true });
  });

  test("hand-written configEdit text fields over an encrypted-at-rest key are projected writeOnly", () => {
    const vault = defineFeature("vault", (r) => {
      r.config({
        keys: {
          hookToken: createSystemConfig("text", { write: access.systemAdmin, backing: "secrets" }),
          note: createSystemConfig("text", { write: access.systemAdmin }),
        },
      });
      r.screen({
        id: "vault-settings",
        type: "configEdit",
        scope: "system",
        configKeys: { hookToken: "vault:config:hook-token", note: "vault:config:note" },
        fields: { hookToken: { type: "text" }, note: { type: "text" } },
        layout: { sections: [{ title: "Vault", fields: ["hookToken", "note"] }] },
      });
    });
    const app = buildAppSchema(createRegistry([vault]));
    const settings = app.features
      .find((feature) => feature.featureName === "vault")
      ?.screens?.find((candidate) => candidate.id === "vault-settings");
    if (settings?.type !== "configEdit") throw new Error("no configEdit screen");
    expect(settings.fields["hookToken"]).toMatchObject({ type: "text", writeOnly: true });
    expect(settings.fields["note"]).not.toHaveProperty("writeOnly");
  });

  test("number/date/timestamp/locatedTimestamp: min/max/locale survive the projection", () => {
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
      r.entity({ name: "thing", ...entity });
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

  test("image/images: capture survives the projection", () => {
    // Regression: `capture` decides whether a mobile file picker opens the
    // rear or front camera — never arrived, so it never applied.
    const entity = {
      fields: {
        idPhoto: { type: "image", capture: "environment" },
        avatar: { type: "image" },
        gallery: { type: "images", capture: "user" },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["idPhoto"]?.["capture"]).toBe("environment");
    expect(fields["avatar"]?.["capture"]).toBeUndefined();
    expect(fields["gallery"]?.["capture"]).toBe("user");
  });

  test("number unit (static and sibling-field form) and entity defaultCurrency survive the projection", () => {
    // Regression: the edit view-model reads `unit` and `entity.defaultCurrency`,
    // but the client schema never carried them — the suffix never rendered and
    // money fields always fell back to "EUR".
    const entity = {
      defaultCurrency: "USD",
      fields: {
        distance: { type: "number", unit: "mi" },
        mileage: { type: "number", unit: { field: "mileageUnit" } },
        mileageUnit: { type: "text" },
        count: { type: "number" },
        bogus: { type: "number", unit: { field: () => "km" } },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const projected = app.features[0]!.entities["thing"] as unknown as {
      defaultCurrency?: string;
      fields: Record<string, Record<string, unknown>>;
    };

    expect(projected.defaultCurrency).toBe("USD");
    expect(projected.fields["distance"]?.["unit"]).toBe("mi");
    expect(projected.fields["mileage"]?.["unit"]).toEqual({ field: "mileageUnit" });
    expect(projected.fields["count"]?.["unit"]).toBeUndefined();
    expect(projected.fields["bogus"]?.["unit"]).toBeUndefined();
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected);
  });

  test("number grouping survives the projection (false only if declared)", () => {
    const entity = {
      fields: {
        year: { type: "number", grouping: false },
        plain: { type: "number" },
      },
    } as unknown as EntityDefinition;
    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const projected = app.features[0]!.entities["thing"] as unknown as {
      fields: Record<string, Record<string, unknown>>;
    };
    expect(projected.fields["year"]?.["grouping"]).toBe(false);
    expect(projected.fields["plain"]?.["grouping"]).toBeUndefined();
  });

  test("entity lockedWhen survives the projection so the client can show locked records read-only", () => {
    const f = defineFeature("ent", (r) => {
      r.entity({
        name: "thing",
        ...({
          fields: { status: { type: "text" } },
          lockedWhen: { field: "status", eq: "closed" },
        } as unknown as EntityDefinition),
      });
    });
    const app = buildAppSchema(createRegistry([f]));
    expect(app.features[0]!.entities["thing"]!.lockedWhen).toEqual({
      field: "status",
      eq: "closed",
    });
  });

  test("entity without lockedWhen omits the key", () => {
    const f = defineFeature("ent", (r) => {
      r.entity({
        name: "thing",
        ...({ fields: { label: { type: "text" } } } as unknown as EntityDefinition),
      });
    });
    const app = buildAppSchema(createRegistry([f]));
    expect("lockedWhen" in app.features[0]!.entities["thing"]!).toBe(false);
  });

  test("entity without defaultCurrency omits the key", () => {
    const f = defineFeature("ent", (r) => {
      r.entity({
        name: "thing",
        ...({ fields: { label: { type: "text" } } } as unknown as EntityDefinition),
      });
    });
    const app = buildAppSchema(createRegistry([f]));
    expect("defaultCurrency" in app.features[0]!.entities["thing"]!).toBe(false);
  });

  test("money field's `currency: { kind: 'tenant' }` declaration survives the projection", () => {
    const entity = {
      defaultCurrency: "USD",
      fields: {
        price: { type: "money", currency: { kind: "tenant" } },
        cost: { type: "money" },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const projected = app.features[0]!.entities["thing"] as unknown as {
      fields: Record<string, Record<string, unknown>>;
    };

    expect(projected.fields["price"]?.["currency"]).toEqual({ kind: "tenant" });
    expect(projected.fields["cost"]?.["currency"]).toBeUndefined();
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected);
  });

  test("money field's `currency: { kind: 'literal', code }` declaration survives the projection", () => {
    const entity = {
      defaultCurrency: "USD",
      fields: { price: { type: "money", currency: { kind: "literal", code: "USD" } } },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const projected = app.features[0]!.entities["thing"] as unknown as {
      fields: Record<string, Record<string, unknown>>;
    };

    expect(projected.fields["price"]?.["currency"]).toEqual({ kind: "literal", code: "USD" });
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected);
  });

  test("text format, timestamp locatedBy, file accept/maxSize, image variants and decimal scale survive the projection", () => {
    // Regression: all of these are read by the edit view-model (password
    // masking, wall-clock input, upload constraints, preview variant, derived
    // embedded-cell rounding) but were missing from the client schema.
    const entity = {
      fields: {
        secret: { type: "text", format: "password" },
        pickupAt: { type: "timestamp", locatedBy: "pickupTz" },
        pickupTz: { type: "tz" },
        contract: { type: "file", accept: ["application/pdf"], maxSize: "5mb" },
        photo: {
          type: "image",
          accept: ["image/*"],
          maxSize: "10mb",
          variants: { thumb: { fit: "cover", size: { width: 120, height: 120 } } },
        },
        positions: {
          type: "embedded",
          multiple: true,
          schema: { price: { type: "decimal", scale: 2 } },
        },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    expect(fields["secret"]?.["format"]).toBe("password");
    expect(fields["pickupAt"]?.["locatedBy"]).toBe("pickupTz");
    expect(fields["contract"]?.["accept"]).toEqual(["application/pdf"]);
    expect(fields["contract"]?.["maxSize"]).toBe("5mb");
    expect(fields["photo"]?.["accept"]).toEqual(["image/*"]);
    expect(fields["photo"]?.["variants"]).toEqual({
      thumb: { fit: "cover", size: { width: 120, height: 120 } },
    });
    const positionsSchema = fields["positions"]?.["schema"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(positionsSchema["price"]?.["scale"]).toBe(2);
  });

  test("embedded: minItems/maxItems/derived/totals/totalsMatch survive the projection", () => {
    // Regression: `totals` carries "Renderer metadata: numeric sub-field
    // names to sum in a totals row" in its own doc-comment but was never
    // forwarded — same for the other embedded-list renderer hints.
    const entity = {
      fields: {
        lines: {
          type: "embedded",
          multiple: true,
          schema: {
            qty: { type: "number", required: true },
            amount: { type: "money" },
            status: { type: "select", options: ["open", "closed"] },
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
      r.entity({ name: "thing", ...entity });
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
    // `schema` itself — the embedded list's sub-field map — must
    // survive too, or computeEditViewModel iterates `undefined` and the
    // browser crashes on any entityEdit screen with an embedded list.
    const schema = fields["lines"]?.["schema"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(schema)).toEqual(["qty", "amount", "status"]);
    expect(schema["qty"]).toEqual({ type: "number", required: true });
    expect(schema["amount"]).toEqual({ type: "money" });
    expect(schema["status"]).toEqual({ type: "select", options: ["open", "closed"] });
  });

  test("embedded: derived/totalsMatch with a Function one level deep remain blocked", () => {
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
      r.entity({ name: "thing", ...entity });
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

  test("embedded: schema survives the projection, but a Function value of a sub-field is dropped", () => {
    // Regression: `schema` — the embedded list's sub-field map — was never
    // forwarded at all, crashing computeEditViewModel client-side
    // (Object.entries(undefined)). It's projected recursively per sub-field
    // (through projectField again), not via a blanket copy: a sub-field
    // carrying a non-JSON-safe value (e.g. a validator/renderer function)
    // must lose only that value, not the whole schema map.
    const entity = {
      fields: {
        lines: {
          type: "embedded",
          multiple: true,
          schema: {
            qty: { type: "number", required: true, default: () => 1 },
            amount: { type: "money" },
          },
        },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
    });
    const app = buildAppSchema(createRegistry([f]));
    const fields = (
      app.features[0]!.entities["thing"] as unknown as {
        fields: Record<string, Record<string, unknown>>;
      }
    ).fields;

    const schema = fields["lines"]?.["schema"] as Record<string, Record<string, unknown>>;
    expect(schema).toBeDefined();
    expect(schema["qty"]?.["type"]).toBe("number");
    expect(schema["qty"]?.["required"]).toBe(true);
    expect(schema["qty"]?.["default"]).toBeUndefined();
    expect(schema["amount"]).toEqual({ type: "money" });
  });

  test("default: JSON-safe Arrays/Objects survive the projection, non-JSON values remain blocked", () => {
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
      r.entity({ name: "thing", ...entity });
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

  test("AppSchema is safe through a JSON.stringify roundtrip", () => {
    // Contract smoke test: a function accidentally introduced by a project-
    // helper would make this check fail.
    const entity = {
      fields: {
        id: { type: "text", default: () => "x" },
        tags: {
          type: "multiSelect",
          options: ["a", "b"],
          display: "checkboxes",
          columns: 3,
          maxRows: 5,
        },
      },
    } as unknown as EntityDefinition;
    const f = defineFeature("ent", (r) => {
      r.entity({ name: "thing", ...entity });
      r.nav({ id: "n", label: "N" });
      r.workspace({
        id: "ws",
        label: "Ws",
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
    });
    const app = buildAppSchema(createRegistry([f]));
    const json = JSON.stringify(app);
    const parsed = JSON.parse(json);
    expect(parsed.features[0].featureName).toBe("ent");
    const tagsField = parsed.features[0].entities.thing.fields.tags;
    expect(tagsField.display).toBe("checkboxes");
    expect(tagsField.columns).toBe(3);
    expect(tagsField.maxRows).toBe(5);
  });

  test("FormatSpec-Renderer + FieldCondition-RowActions survive the JSON roundtrip unchanged", () => {
    // FormatSpec ({ format: "timestamp" } etc.) is JSON-safe, and
    // FieldCondition ({ field, eq/ne } | boolean) remains deep-equal to the
    // original after JSON.parse(JSON.stringify(app)).
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
      r.entity({ name: "event", ...entity });
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

    // toStrictEqual is required here: toEqual ignores undefined properties and
    // would not catch a silent drop by JSON.stringify.
    expect(roundTripped).toStrictEqual(app);

    const screen = roundTripped.features[0]?.screens[0];
    const cols = screen?.columns as Array<{ field?: string; renderer?: unknown }>;
    expect(cols?.find((c) => c.field === "startedAt")?.renderer).toEqual({
      format: "timestamp",
    });
    expect(cols?.find((c) => c.field === "priority")?.renderer).toEqual({
      format: "priority",
      prefix: "P",
    });

    // FieldCondition variants (eq, ne, and boolean) remain unchanged.
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

    // rowClick, a scalar flag, survives JSON projection rather than being
    // dropped.
    expect(actions?.find((a) => a.id === "open")?.rowClick).toBe(true);
  });

  test("derivedFields are projected into the client schema (valueType, without derive-fn)", () => {
    // Regression: projectEntity omitted derivedFields, so the client did not know
    // them and computeListViewModel threw "references unknown field" for every
    // derived entityList column (such as bauspar `phase`).
    // The executor attaches the value to the row server-side; the client only
    // needs the valueType.
    const contractEntity = {
      table: "contracts",
      fields: { name: { type: "text" } },
      derivedFields: {
        phase: { valueType: "text", derive: () => "saving" },
        balance: { valueType: "decimal", derive: () => 0 },
      },
    } as unknown as EntityDefinition;

    const f = defineFeature("credit", (r) => {
      r.entity({ name: "contract", ...contractEntity });
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
    // derive is server-only and must not cross into the browser bundle; the
    // JSON-safety guard rejects such function leaks.
    expect(entity?.derivedFields?.["phase"]).not.toHaveProperty("derive");
    expect(findNonJsonSafePath(app, "schema")).toBeNull();
  });

  // projectionList's searchable/sortable/paginated are derived from
  // the bound query handler's Zod schema, not authored — see
  // deriveProjectionListCapabilities in build-app-schema.ts.
  test("projectionList: search/sort/cursor in the query schema become derived capabilities", () => {
    const f = defineFeature("ledger", (r) => {
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({
          search: z.string().optional(),
          sort: z.string().optional(),
          cursor: z.string().optional(),
        }),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
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
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
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

  describe("projectionList over an entity-convention list query", () => {
    const listAccess = {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    };
    const plainEntity = createEntity({
      table: "plain_things",
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    });
    const searchableEntity = createEntity({
      table: "searchable_things",
      fields: {
        name: createTextField({ personal: false, reason: "test_fixture", searchable: true }),
      },
    });

    function derivedSearchable(entityName: string, entity: EntityDefinition): boolean | undefined {
      const f = defineFeature("ledger", (r) => {
        r.entity({ name: entityName, ...entity });
        r.queryHandler(defineEntityListHandler(entityName, entity, listAccess));
        r.screen({
          id: "thing-list",
          type: "projectionList",
          query: `ledger:query:${entityName}:list`,
          columns: ["name"],
        });
      });
      const screen = buildAppSchema(createRegistry([f])).features[0]?.screens.find(
        (s) => s.id === "thing-list",
      ) as ProjectionListScreenDefinition | undefined;
      return screen?.searchable;
    }

    test("an entity without searchable fields derives searchable: false (no search box)", () => {
      expect(derivedSearchable("plain", plainEntity)).toBe(false);
    });

    test("an entity with a searchable field still derives searchable: true", () => {
      expect(derivedSearchable("searchable", searchableEntity)).toBe(true);
    });
  });

  test("projectionList: a non-ZodObject query schema (z.union) derives no capability and doesn't throw", () => {
    const f = defineFeature("ledger", (r) => {
      r.queryHandler({
        name: "schedule:list",
        schema: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
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
      r.queryHandler({
        name: "schedule:list",
        schema: z.object({ search: z.string().optional() }),
        handler: async () => ({
          rows: [],
          nextCursor: null,
        }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
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
  test("finds a function outside PlatformComponent slots with a path", () => {
    const schema = { features: [{ label: () => "nope" }] };
    expect(findNonJsonSafePath(schema, "schema")).toBe("schema.features[0].label");
  });

  test("PlatformComponent slots ({ react, native }) are opaque — component functions allowed", () => {
    const schema = {
      features: [{ screens: [{ id: "s1", component: { react: () => null } }] }],
    };
    expect(findNonJsonSafePath(schema, "schema")).toBeNull();
  });

  test("catches undefined, bigint, and class instances", () => {
    expect(findNonJsonSafePath({ a: undefined }, "schema")).toBe("schema.a");
    expect(findNonJsonSafePath({ a: 1n }, "schema")).toBe("schema.a");
    expect(findNonJsonSafePath({ a: new Map() }, "schema")).toBe("schema.a");
    expect(findNonJsonSafePath({ a: Number.NaN }, "schema")).toBe("schema.a");
  });

  test("normal JSON schema passes without finding anything", () => {
    expect(
      findNonJsonSafePath({ features: [{ name: "x", count: 3, on: true, opt: null }] }, "schema"),
    ).toBeNull();
  });
});
