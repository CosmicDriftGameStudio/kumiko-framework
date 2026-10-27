import { describe, expect, it } from "bun:test";
import { transformContentCollectionFormatSource } from "../scripts/codemod/content-collection-format.ts";

describe("content-collection-format codemod", () => {
  it("rewrites editor formats in both collection vocabularies and keeps storage literals", () => {
    const input = [
      `const feature = createTemplateResolverFeature({`,
      `  collections: [`,
      `    { id: "a", kind: "snippet", contentFormat: "rich" },`,
      `    { id: "b", kind: "snippet", contentFormat: "markdown" },`,
      `    { id: "c", kind: "snippet", contentFormat: "plain" },`,
      `  ],`,
      `});`,
      `r.contentCollection({ id: "d", kind: "snippet", contentFormat: "rich" });`,
      `await write("template-resolver:write:set", { contentFormat: "markdown" });`,
      `const seed = { contentFormat: "rich", body: "x" };`,
      `other({ collections: [{ contentFormat: "markdown" }] });`,
    ].join("\n");
    const { output, rewrites, manual } = transformContentCollectionFormatSource(input);
    expect(rewrites).toHaveLength(3);
    expect(manual).toHaveLength(0);
    expect(output).toContain(`{ id: "a", kind: "snippet", contentFormat: "document" }`);
    expect(output).toContain(`{ id: "b", kind: "snippet", contentFormat: "document" }`);
    expect(output).toContain(`{ id: "c", kind: "snippet", contentFormat: "plain" }`);
    expect(output).toContain(`{ id: "d", kind: "snippet", contentFormat: "document" }`);
    expect(output).toContain(`{ contentFormat: "markdown" });`);
    expect(output).toContain(`const seed = { contentFormat: "rich", body: "x" };`);
    expect(output).toContain(`other({ collections: [{ contentFormat: "markdown" }] });`);
  });

  it("leaves sources without collection declarations untouched", () => {
    const input = `const x = { contentFormat: "markdown" };\n`;
    expect(transformContentCollectionFormatSource(input).output).toBe(input);
  });
});
