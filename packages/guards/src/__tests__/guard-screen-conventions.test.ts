import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import { guard } from "../guard-screen-conventions";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

function screenWithSection(section: string): SourceFile[] {
  return files({
    "packages/bundled-features/src/demo/screens.ts": `
      export const demo: ProjectionDetailScreenDefinition = {
        id: "demo",
        type: "projectionDetail",
        layout: { sections: [${section}] },
      };
    `,
  });
}

describe("Screen-Conventions Guard relatedList", () => {
  test("flags a relatedList section without rowClick or rowActions", () => {
    const { violations } = guard.run(
      screenWithSection(`{ kind: "relatedList", title: "t", query: "a:query:b", columns: [] }`),
    );
    expect(violations).toHaveLength(1);
  });

  test("accepts a section that declares itself readOnly", () => {
    const { violations } = guard.run(
      screenWithSection(
        `{ kind: "relatedList", readOnly: true, title: "t", query: "a:query:b", columns: [] }`,
      ),
    );
    expect(violations).toHaveLength(0);
  });

  test("accepts a section with rowActions", () => {
    const { violations } = guard.run(
      screenWithSection(
        `{ kind: "relatedList", title: "t", query: "a:query:b", columns: [], rowActions: [] }`,
      ),
    );
    expect(violations).toHaveLength(0);
  });
});
