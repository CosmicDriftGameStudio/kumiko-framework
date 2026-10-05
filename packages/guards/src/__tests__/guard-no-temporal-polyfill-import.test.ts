import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import { guard, isTemporalSingleSource } from "../guard-no-temporal-polyfill-import";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

const APP_FILE = "packages/app/src/features/booking/clock.ts";

describe("No-Temporal-Polyfill-Import Guard", () => {
  test("flags a named value import and names the replacement import", () => {
    const { violations } = guard.run(
      files({
        [APP_FILE]: `import { Temporal } from "temporal-polyfill";\nexport const now = () => Temporal.Now.instant();`,
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
    expect(violations[0]?.message).toContain("[temporal-polyfill]");
    expect(violations[0]?.message).toContain(
      'import { Temporal } from "@cosmicdrift/kumiko-types/temporal";',
    );
  });

  test("flags the side-effect global import", () => {
    const { violations } = guard.run(files({ [APP_FILE]: `import "temporal-polyfill/global";` }));
    expect(violations.map((v) => v.message)).toEqual([
      expect.stringContaining("[temporal-polyfill/global]"),
    ]);
  });

  test("flags re-exports, dynamic imports and require calls", () => {
    const { violations } = guard.run(
      files({
        [APP_FILE]: [
          `export { Temporal } from "temporal-polyfill";`,
          `export const lazy = () => import("temporal-polyfill");`,
          `export const legacy = () => require("temporal-polyfill");`,
        ].join("\n"),
      }),
    );
    expect(violations.map((v) => v.line)).toEqual([1, 2, 3]);
  });

  test("ignores type-only imports and the triple-slash types reference", () => {
    const { violations } = guard.run(
      files({
        [APP_FILE]: [
          `/// <reference types="temporal-polyfill/global" preserve="true" />`,
          `import type { Temporal } from "temporal-polyfill";`,
          `import { type Temporal as T } from "temporal-polyfill";`,
          `export type At = Temporal.Instant | T.PlainDate;`,
        ].join("\n"),
      }),
    );
    expect(violations).toEqual([]);
  });

  test("a mixed import with one value binding is still flagged", () => {
    const { violations } = guard.run(
      files({ [APP_FILE]: `import { type Temporal, Intl } from "temporal-polyfill";\nvoid Intl;` }),
    );
    expect(violations).toHaveLength(1);
  });

  test("imports from the kumiko single source pass", () => {
    const { violations } = guard.run(
      files({
        [APP_FILE]: `import { Temporal } from "@cosmicdrift/kumiko-types/temporal";\nexport const now = () => Temporal.Now.instant();`,
      }),
    );
    expect(violations).toEqual([]);
  });

  test("only kumiko-types' temporal module counts as the single source", () => {
    expect(isTemporalSingleSource("kumiko-framework", "packages/types/src/temporal.ts")).toBe(true);
    expect(isTemporalSingleSource("my-app", "packages/types/src/temporal.ts")).toBe(false);
    expect(isTemporalSingleSource(undefined, "packages/types/src/temporal.ts")).toBe(false);
    expect(isTemporalSingleSource("kumiko-framework", "packages/framework/src/time/x.ts")).toBe(
      false,
    );
  });
});
