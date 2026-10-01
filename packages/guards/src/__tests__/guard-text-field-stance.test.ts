import { describe, expect, spyOn, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import { scan } from "../guard-text-field-stance";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

const NO_STANCE_CALL = `
	import { createTextField } from "../factories";
	export const f = createTextField();
`;

describe("Text-Field Personal-Stance Guard", () => {
  test("flags createTextField()/createLongTextField() without a personal stance", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/entity.ts": NO_STANCE_CALL,
    });
    const { findings } = scan(sfs, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.callee).toBe("createTextField");
  });

  test("the two throw-test files that deliberately call the factory without a stance are exempt by exact repo-relative path", () => {
    const sfs = files({
      "packages/framework/src/engine/__tests__/factories-long-text.test.ts": NO_STANCE_CALL,
      "packages/framework/src/engine/__tests__/factories-personal.test.ts": NO_STANCE_CALL,
    });
    const { findings } = scan(sfs, []);
    expect(findings).toHaveLength(0);
  });

  test("a different file with the same basename as an allowlisted throw-test file is NOT exempt", () => {
    const sfs = files({
      "packages/bundled-features/src/__tests__/factories-long-text.test.ts": NO_STANCE_CALL,
    });
    const { findings } = scan(sfs, []);
    expect(findings).toHaveLength(1);
  });

  test("an annotated call is not flagged", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/entity.ts": `
				import { createTextField } from "../factories";
				export const f = createTextField({ personal: "self", find: "none" });
			`,
    });
    expect(scan(sfs, []).findings).toHaveLength(0);
  });

  test("scan returns findings without logging", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const sfs = files({ "packages/bundled-features/src/rogue/entity.ts": NO_STANCE_CALL });
      expect(scan(sfs, []).findings).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
