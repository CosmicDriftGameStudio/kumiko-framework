import { describe, expect, test } from "bun:test";
import { checkFixture, presetPath } from "./biome-harness";

// Managed files are written with the template's formatting and verified against the template by
// `kumiko check managed`, so an app formatting with tabs must not get Biome format findings for them.
const SPACE_INDENTED = "export const value = {\n  key: 1,\n};\n";

describe("biome-app preset: managed template files", () => {
  const findings = checkFixture(
    {
      extends: [presetPath("biome-app.json")],
      formatter: { indentStyle: "tab" },
      files: { includes: ["src/**", "bin/**", "kumiko/**"] },
    },
    {
      "bin/kumiko.ts": SPACE_INDENTED,
      "kumiko/schema.ts": SPACE_INDENTED,
      "src/app.ts": SPACE_INDENTED,
    },
  );
  const formatFilesOf = (): string[] =>
    findings.filter((f) => f.category === "format").map((f) => f.file);

  test("bin/kumiko.ts and kumiko/schema.ts are exempt from formatting", () => {
    expect(formatFilesOf()).not.toContain("bin/kumiko.ts");
    expect(formatFilesOf()).not.toContain("kumiko/schema.ts");
  });

  test("other app files still get format findings", () => {
    expect(formatFilesOf()).toContain("src/app.ts");
  });
});
