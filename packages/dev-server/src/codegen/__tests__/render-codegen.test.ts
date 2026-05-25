import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderDefineFile, renderInlineSchemasFile, renderTypesAugmentation } from "../render";
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
});

describe("renderDefineFile", () => {
  test("emits defineWriteHandler wrapper with type reference", () => {
    const out = renderDefineFile();
    expect(out).toContain("defineWriteHandler");
    expect(out).toContain("types.generated.d.ts");
  });
});
