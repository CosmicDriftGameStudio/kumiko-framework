import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderDefineFile,
  renderInlineSchemasFile,
  renderTypesAugmentation,
  renderWriteHandlerTypes,
} from "../render";
import type { ScannedEvent } from "../scan-events";

describe("renderTypesAugmentation", () => {
  test("emits empty augmentation when no events", () => {
    const out = renderTypesAugmentation([], "/tmp/app/.kumiko");
    expect(out).toContain("interface KumikoEventTypeMap");
    expect(out).toContain("no r.defineEvent calls discovered yet");
  });
});

describe("renderInlineSchemasFile", () => {
  test("returns undefined when no inline schemas", () => {
    expect(renderInlineSchemasFile([], "/tmp/app")).toBeUndefined();
  });

  test("uses app-root-relative paths in source comments", () => {
    const appRoot = mkdtempSync(join(tmpdir(), "kumiko-codegen-"));
    const featurePath = join(appRoot, "src", "feature.ts");
    mkdirSync(join(appRoot, "src"), { recursive: true });
    writeFileSync(featurePath, "// stub", "utf-8");
    const events: ScannedEvent[] = [
      {
        qualifiedName: "inventory:event:product-archived",
        schemaSource: {
          kind: "inline",
          schemaSource: "z.object({ reason: z.string() })",
          generatedConstName: "_kg_inventory__productArchived",
        },
        featureFilePath: featurePath,
        source: { file: featurePath, line: 92 },
      },
    ];
    const out = renderInlineSchemasFile(events, appRoot);
    expect(out).toContain("// inventory:event:product-archived — from src/feature.ts:92");
    expect(out).not.toContain(appRoot);
  });

  test("falls back to the bare filename when a feature file is outside the app root", () => {
    // A bundled-feature file lives in node_modules, outside the app root —
    // relative() would emit `../../..`. The comment falls back to basename.
    const appRoot = join(tmpdir(), "kumiko-codegen-app");
    const featurePath = join(tmpdir(), "node_modules", "pkg", "dist", "feature.ts");
    const events: ScannedEvent[] = [
      {
        qualifiedName: "bundled:event:thing-happened",
        schemaSource: {
          kind: "inline",
          schemaSource: "z.object({ id: z.string() })",
          generatedConstName: "_kg_bundled__thingHappened",
        },
        featureFilePath: featurePath,
        source: { file: featurePath, line: 7 },
      },
    ];
    const out = renderInlineSchemasFile(events, appRoot);
    expect(out).toContain("// bundled:event:thing-happened — from feature.ts:7");
    expect(out).not.toContain("..");
  });
});

describe("renderDefineFile", () => {
  test("emits defineWriteHandler wrapper with type reference", () => {
    const out = renderDefineFile();
    expect(out).toContain("defineWriteHandler");
    expect(out).toContain("types.generated.d.ts");
  });

  test("emits createTypedDispatcher when handler QNs provided", () => {
    const out = renderDefineFile(["tenant:write:create", "tenant:write:update"]);
    expect(out).toContain("export type TypedDispatcher");
    expect(out).toContain("export function createTypedDispatcher");
    expect(out).toContain('import type { WriteHandlerQn } from "./types.generated"');
    expect(out).toContain("export type { WriteHandlerQn };");
  });
});

describe("renderWriteHandlerTypes", () => {
  test("emits union type lines", () => {
    const out = renderWriteHandlerTypes(["tenant:write:create"]);
    expect(out).toContain("export type WriteHandlerQn =");
    expect(out).toContain('| "tenant:write:create"');
  });
});
