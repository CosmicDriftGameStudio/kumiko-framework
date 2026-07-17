// Roundtrip-Test: parse(file) → render(patterns) → parse(rendered) →
// equivalent pattern set. Catches drift between extractors.ts and
// render.ts — if a pattern's read & write paths disagree, the second
// parse either errors or produces a different shape.
//
// Equality is defined on the structural pattern data, NOT on
// SourceLocation: locations naturally shift between the original file
// (where the pattern came from) and the rendered file (where it ends
// up at canonical positions). We compare every other field.

import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { parseSourceFile } from "../parse";
import type { FeaturePattern } from "../patterns";
import { renderFeatureFile, renderPattern } from "../render";

const STATIC_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.requires("auth", "tenant");
  r.toggleable({ default: true });

  r.entity("item", {
    fields: {
      name: { type: "text", required: true },
      sku: { type: "text" },
      onHand: { type: "number" },
    },
  });

  r.relation("item", "supplier", { kind: "belongsTo", to: "user" });

  r.metric("created", { type: "counter" });
  r.secret("apiKey", { description: "Stripe key" });
  r.claimKey("teamId", { type: "string" });

  r.referenceData(
    "category",
    [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    { upsertKey: "id" },
  );

  r.config({ keys: { maxRows: { type: "number", default: 50 } } });
});
`;

function parse(source: string): {
  featureName: string | undefined;
  patterns: readonly FeaturePattern[];
} {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
  const sf = project.createSourceFile(`f-${Math.random()}.ts`, source);
  const result = parseSourceFile(sf);
  expect(result.errors).toEqual([]);
  return { featureName: result.featureName, patterns: result.patterns };
}

// Strip SourceLocation fields recursively for equality checks.
//   - `source` (the whole-call location) is dropped entirely — its `.raw`
//     is the literal call text, which changes when the renderer rewrites
//     positional args into the canonical Object-Form.
//   - Body locations (handlerBody / fnBody / schemaSource / opaqueProps)
//     keep their `.raw` text, but whitespace is normalised (de-indented
//     to relative-zero on continuation lines). The body's *code* must
//     round-trip byte-for-byte; its *indentation* shifts because the
//     surrounding object-form sits one nesting level deeper than the
//     positional form, and the renderer reindents continuation lines
//     to match the new context.
const BODY_LOC_KEYS = new Set([
  "schemaSource",
  "handlerBody",
  "fnBody",
  "transformBody",
  "recipientBody",
  "dataBody",
  "defBody",
]);

function normalizeBodyRaw(raw: string): string {
  const lines = raw.split("\n");
  if (lines.length <= 1) return raw.trim();
  // Find the minimum leading whitespace over non-empty continuation lines.
  let minIndent = Infinity;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l.trim() === "") continue;
    const lead = l.match(/^\s*/)?.[0].length ?? 0;
    if (lead < minIndent) minIndent = lead;
  }
  if (!Number.isFinite(minIndent)) return raw;
  const head = lines[0] ?? "";
  const tail = lines
    .slice(1)
    .map((l) => (l && l.trim() !== "" ? l.slice(minIndent) : l))
    .join("\n");
  return `${head}\n${tail}`;
}

function stripLocations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLocations);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "source") continue; // drop entirely
      if (BODY_LOC_KEYS.has(k) && v && typeof v === "object" && "raw" in v) {
        out[k] = { raw: normalizeBodyRaw((v as { raw: string }).raw) };
        continue;
      }
      if ((k === "opaqueProps" || k === "migrations") && v && typeof v === "object") {
        const op: Record<string, unknown> = {};
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
          if (pv && typeof pv === "object" && "raw" in pv) {
            op[pk] = { raw: normalizeBodyRaw((pv as { raw: string }).raw) };
          } else {
            op[pk] = stripLocations(pv);
          }
        }
        out[k] = op;
        continue;
      }
      out[k] = stripLocations(v);
    }
    return out;
  }
  return value;
}

describe("render → parse roundtrip — static patterns", () => {
  const initial = parse(STATIC_FEATURE);

  test("featureName roundtrips", () => {
    expect(initial.featureName).toBe("inventory");
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    const reparsed = parse(rendered);
    expect(reparsed.featureName).toBe("inventory");
  });

  test("rendered file emits version header", () => {
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    expect(rendered.startsWith("// kumiko-feature-version: 1")).toBe(true);
  });

  test("pattern count is preserved", () => {
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    const reparsed = parse(rendered);
    expect(reparsed.patterns.length).toBe(initial.patterns.length);
  });

  test("pattern shapes are preserved (locations stripped)", () => {
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    const reparsed = parse(rendered);
    expect(reparsed.patterns.map(stripLocations)).toEqual(initial.patterns.map(stripLocations));
  });
});

const MIXED_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("workflow", (r) => {
  r.entity("step", { fields: { title: { type: "text", required: true } } });

  r.writeHandler(
    "step:create",
    z.object({ title: z.string() }),
    async (event, ctx) => {
      return { isSuccess: true, data: { id: "x" } };
    },
    { access: { roles: ["user"] } },
  );

  r.queryHandler(
    "step:list",
    z.object({}),
    async (q, ctx) => [],
    { access: { openToAll: true } },
  );

  r.hook("postSave", "step", async (event, ctx) => {
    console.log("step saved");
  });

  r.entityHook("postDelete", "step", async (event, ctx) => {
    console.log("step deleted");
  });

  r.defineEvent("stepCompleted", z.object({ id: z.string() }), { version: 1 });

  r.nav({ id: "steps", label: "Steps", screen: "workflow:screen:step-list" });
});
`;

describe("render → parse roundtrip — mixed patterns (header data + opaque bodies)", () => {
  const initial = parse(MIXED_FEATURE);

  test("opaque bodies (handler/fn/schema) round-trip byte-identical", () => {
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    const reparsed = parse(rendered);
    expect(reparsed.patterns.map(stripLocations)).toEqual(initial.patterns.map(stripLocations));
  });

  test("rendered file is parseable without errors and matches feature name", () => {
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    const reparsed = parse(rendered);
    expect(reparsed.featureName).toBe("workflow");
    expect(reparsed.patterns.length).toBe(initial.patterns.length);
  });
});

// Idempotence: render → parse → render should equal render-once. Stronger
// guarantee than parse → render → parse, because it pins that the renderer
// never depends on the input file's whitespace — its output is deterministic
// from the parsed FeaturePattern shape alone.
const RAW_REF_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const eventEntity = {
  fields: { name: { type: "text", required: true } },
};

function buildFields() {
  return { title: { type: "text" } };
}

const someFeature = { name: "mail-foundation" };

const eventListScreen = {
  id: "event-list",
  type: "entityList",
  entity: "event",
};

function makeHandler() {
  return { name: "task:create", schema: null, handler: () => {} };
}

defineFeature("refs", (r) => {
  r.requires(someFeature.name, "config");
  r.entity("event", eventEntity);
  r.entity("task", { fields: buildFields() });
  r.writeHandler(makeHandler());
  r.screen(eventListScreen);
});
`;

describe("render → parse roundtrip — unresolved references (raw-ref sentinel)", () => {
  const initial = parse(RAW_REF_FEATURE);

  test("parses requires + both entities + the opaque handler without error, keeping references unresolved", () => {
    expect(initial.patterns).toMatchObject([
      { kind: "requires", featureNames: [{ __raw: "someFeature.name" }, "config"] },
      { kind: "entity", entityName: "event", definition: { __raw: "eventEntity" } },
      { kind: "entity", entityName: "task", definition: { fields: { __raw: "buildFields()" } } },
      { kind: "writeHandler", handlerName: undefined },
      { kind: "screen", definition: { __raw: "eventListScreen" } },
    ]);
  });

  test("rendered output re-emits references verbatim, never inlines them", () => {
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    expect(rendered).toContain("someFeature.name");
    expect(rendered).toContain("eventEntity");
    expect(rendered).toContain("buildFields()");
    expect(rendered).toContain("r.writeHandler(makeHandler())");
    expect(rendered).toContain("r.screen(eventListScreen);");
    // Would only appear if buildFields()'s return value got inlined.
    expect(rendered).not.toContain("title:");
    expect(rendered).not.toContain("mail-foundation");
    expect(rendered).not.toContain("task:create");
    // Would only appear if the screen ref got resolved/inlined.
    expect(rendered).not.toContain("entityList");
  });

  test("pattern shape survives a full render → reparse cycle", () => {
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    const reparsed = parse(rendered);
    expect(reparsed.patterns.map(stripLocations)).toEqual(initial.patterns.map(stripLocations));
  });
});

describe("render idempotence", () => {
  test("rendered file → parse → render === rendered file", () => {
    const initial = parse(STATIC_FEATURE);
    const rendered1 = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    const reparsed = parse(rendered1);
    const rendered2 = renderFeatureFile({
      featureName: reparsed.featureName ?? "",
      patterns: reparsed.patterns,
    });
    expect(rendered2).toBe(rendered1);
  });
});

describe("renderPattern — single-pattern shape", () => {
  test("requires pattern emits canonical features-array (single-line for short input)", () => {
    const out = renderPattern({
      kind: "requires",
      source: { file: "x", start: { line: 1, column: 1 }, end: { line: 1, column: 1 }, raw: "" },
      featureNames: ["a", "b"],
    });
    expect(out).toBe('r.requires({ features: ["a", "b"] });');
  });

  test("entity pattern flattens name into the object", () => {
    const out = renderPattern({
      kind: "entity",
      source: { file: "x", start: { line: 1, column: 1 }, end: { line: 1, column: 1 }, raw: "" },
      entityName: "task",
      definition: {
        fields: { title: { type: "text", required: true } },
      } as never,
    });
    expect(out).toMatch(/r\.entity\(\{\s+name: "task",\s+fields:/);
  });

  test("metric pattern flattens shortName into the object (single-line)", () => {
    const out = renderPattern({
      kind: "metric",
      source: { file: "x", start: { line: 1, column: 1 }, end: { line: 1, column: 1 }, raw: "" },
      shortName: "requests",
      options: { type: "counter" } as never,
    });
    expect(out).toBe('r.metric({ name: "requests", type: "counter" });');
  });
});

// Regression guard for the class of bug the r.exposesApi/r.usesApi fold
// hit: a registrar-shape change (there, removing a method; here, adding a
// nested optional field) must survive the Designer's parse→render→parse
// cycle, not just a TS compile of the framework itself. r.screen()'s `nav`
// sugar is a generic nested object on an already-generic pattern (no
// per-field extractor/renderer), so this is the cheap case — but proving
// it beats assuming it.
const SCREEN_WITH_NAV_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("shop", (r) => {
  r.entity("product", { fields: { name: { type: "text" } } });
  r.screen({
    id: "products",
    type: "entityList",
    entity: "product",
    columns: ["name"],
    nav: { label: "shop:nav.products", icon: "box", order: 5 },
  });
});
`;

describe("render → parse roundtrip — r.screen({ nav }) inline sugar", () => {
  test("nested nav object survives parse → render → parse unchanged", () => {
    const initial = parse(SCREEN_WITH_NAV_FEATURE);
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    const reparsed = parse(rendered);
    expect(reparsed.patterns.map(stripLocations)).toEqual(initial.patterns.map(stripLocations));

    const screenPattern = reparsed.patterns.find((p) => p.kind === "screen");
    expect(screenPattern?.kind).toBe("screen");
    if (screenPattern?.kind === "screen") {
      expect(screenPattern.definition).toMatchObject({
        nav: { label: "shop:nav.products", icon: "box", order: 5 },
      });
    }
  });
});

const DEFINE_EVENT_WITH_MIGRATIONS_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("billing", (r) => {
  r.defineEvent("invoicePaid", z.object({ totalCents: z.number() }), {
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        transform: (payload) => ({ totalCents: Math.round(payload.total * 100) }),
      },
    ],
  });
});
`;

describe("render → parse roundtrip — r.defineEvent({ migrations }) fold", () => {
  test("migrations array survives parse → render → parse unchanged", () => {
    const initial = parse(DEFINE_EVENT_WITH_MIGRATIONS_FEATURE);
    const rendered = renderFeatureFile({
      featureName: initial.featureName ?? "",
      patterns: initial.patterns,
    });
    const reparsed = parse(rendered);
    expect(reparsed.patterns.map(stripLocations)).toEqual(initial.patterns.map(stripLocations));

    const eventPattern = reparsed.patterns.find((p) => p.kind === "defineEvent");
    expect(eventPattern?.kind).toBe("defineEvent");
    if (eventPattern?.kind === "defineEvent") {
      expect(eventPattern.version).toBe(2);
      expect(Object.keys(eventPattern.migrations ?? {})).toEqual(["1"]);
    }
  });
});
