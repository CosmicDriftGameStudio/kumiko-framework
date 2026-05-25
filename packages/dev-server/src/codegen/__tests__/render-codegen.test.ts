import { describe, expect, test } from "bun:test";
import { renderDefineFile, renderInlineSchemasFile, renderTypesAugmentation } from "../render";

describe("renderTypesAugmentation", () => {
  test("emits empty augmentation when no events", () => {
    const out = renderTypesAugmentation([], "/tmp/app/.kumiko");
    expect(out).toContain("interface KumikoEventTypeMap");
    expect(out).toContain("no r.defineEvent calls discovered yet");
  });
});

describe("renderInlineSchemasFile", () => {
  test("returns undefined when no inline schemas", () => {
    expect(renderInlineSchemasFile([])).toBeUndefined();
  });
});

describe("renderDefineFile", () => {
  test("emits defineWriteHandler wrapper with type reference", () => {
    const out = renderDefineFile();
    expect(out).toContain("defineWriteHandler");
    expect(out).toContain("types.generated.d.ts");
  });
});
