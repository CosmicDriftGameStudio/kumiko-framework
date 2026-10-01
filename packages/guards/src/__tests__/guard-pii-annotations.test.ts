import { describe, expect, spyOn, test } from "bun:test";
import { Project } from "ts-morph";
import { scan } from "../guard-pii-annotations";

describe("PII-Annotations Guard scan", () => {
  test("returns findings without logging", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
    project.createSourceFile(
      "packages/bundled-features/src/rogue/entity.ts",
      `import { createTextField } from "../factories";
export const fields = { email: createTextField() };`,
    );
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { findings } = scan(project.getSourceFiles(), []);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.fieldName).toBe("email");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
