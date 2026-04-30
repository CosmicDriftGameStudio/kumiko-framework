// Roundtrip-Test: parse(file) → render(patterns) → parse(rendered) →
// equivalent pattern set. Catches drift between extractors.ts and
// render.ts — if a pattern's read & write paths disagree, the second
// parse either errors or produces a different shape.
//
// Equality is defined on the structural pattern data, NOT on
// SourceLocation: locations naturally shift between the original file
// (where the pattern came from) and the rendered file (where it ends
// up at canonical positions). We compare every other field.

import { Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { parseSourceFile } from "../parse";
import type { FeaturePattern } from "../patterns";
import { renderFeatureFile, renderPattern } from "../render";

const STATIC_FEATURE = `
import { defineFeature } from "@kumiko/framework/engine";

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
      if (k === "opaqueProps" && v && typeof v === "object") {
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
import { defineFeature } from "@kumiko/framework/engine";
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
  test("requires pattern emits canonical features-array", () => {
    const out = renderPattern({
      kind: "requires",
      source: { file: "x", start: { line: 1, column: 1 }, end: { line: 1, column: 1 }, raw: "" },
      featureNames: ["a", "b"],
    });
    expect(out).toMatch(/r\.requires\(\{ features: \[\s+"a",\s+"b",\s+\] \}\);/);
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

  test("metric pattern flattens shortName into the object", () => {
    const out = renderPattern({
      kind: "metric",
      source: { file: "x", start: { line: 1, column: 1 }, end: { line: 1, column: 1 }, raw: "" },
      shortName: "requests",
      options: { type: "counter" } as never,
    });
    expect(out).toMatch(/r\.metric\(\{\s+name: "requests",\s+type: "counter",\s+\}\);/);
  });
});
