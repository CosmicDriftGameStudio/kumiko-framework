import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import type { RepoRoot } from "../_lib/roots";
import { guard } from "../guard-seed-runtime-imports";

const ROOTS: readonly RepoRoot[] = [
  {
    name: "seed-app",
    absPath: "/repo",
    kind: "app",
    manifest: { kind: "app", sourceRoots: ["src"], testGlobs: [] },
    manifestSource: "derived",
  },
];

function messagesFor(code: string, filePath = "/repo/seeds/demo.ts"): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(filePath, code);
  return guard.run([sf], ROOTS).violations.map((v) => v.message);
}

describe("seed-runtime-imports guard", () => {
  test.each([
    ['import { x } from "@cosmicdrift/kumiko-framework/engine";', "runtime import of"],
    ['import { y } from "../src/y";', "leaves seeds/"],
    ['export const load = () => import("@cosmicdrift/kumiko-framework/db");', "runtime import of"],
    ['export { z } from "../src/z";', "leaves seeds/"],
  ])("flags %s", (code, expected) => {
    expect(messagesFor(code)).toEqual([expect.stringContaining(expected)]);
  });

  test.each([
    ['import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";'],
    ['import { type TenantId } from "@cosmicdrift/kumiko-framework/engine";'],
    ['import { h } from "./_helpers";'],
    ['import { readFileSync } from "node:fs";'],
  ])("allows %s", (code) => {
    expect(messagesFor(code)).toEqual([]);
  });

  test("ignores files outside seeds/", () => {
    expect(
      messagesFor('import { x } from "@cosmicdrift/kumiko-framework/engine";', "/repo/src/x.ts"),
    ).toEqual([]);
  });
});
