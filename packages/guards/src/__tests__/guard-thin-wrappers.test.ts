import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "ts-morph";
import { check, collectFindings, type Finding } from "../guard-thin-wrappers";
import { fixtureRoot } from "./parent-workspace-fixture";

function findingsFor(code: string): Finding[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("sample.ts", code);
  return collectFindings(sf);
}

function findingFor(code: string, fnName: string): Finding | undefined {
  return findingsFor(code).find((f) => f.fnName === fnName);
}

describe("collectFindings — detected thin wrappers", () => {
  test("concise arrow: x => target(x)", () => {
    const f = findingFor("const aliasA = (x: number) => target(x);", "aliasA");
    expect(f?.callee).toBe("target");
    expect(f?.markerReason).toBeNull();
  });

  test("block with a single return statement: { return target(); }", () => {
    const f = findingFor("function aliasB() { return target(); }", "aliasB");
    expect(f?.callee).toBe("target");
  });

  test("block with a single expression statement: { target(); }", () => {
    const f = findingFor("const aliasC = () => { target(); };", "aliasC");
    expect(f?.callee).toBe("target");
  });

  test("@wrapper-known marker reason is captured", () => {
    const f = findingFor(
      "// @wrapper-known semantic-alias\nfunction aliasD() { return target(); }",
      "aliasD",
    );
    expect(f?.callee).toBe("target");
    expect(f?.markerReason).toBe("semantic-alias");
  });
});

describe("collectFindings — excluded patterns (the detection bug fixes)", () => {
  test("self-recursion is not a wrapper", () => {
    expect(findingFor("function recurse() { return recurse(); }", "recurse")).toBeUndefined();
  });

  test("switch body is not a single-delegation wrapper", () => {
    const code = "function withSwitch(x: number) { switch (x) { case 1: return target(); } }";
    expect(findingFor(code, "withSwitch")).toBeUndefined();
  });

  test("factory returning a function is not a wrapper", () => {
    expect(
      findingFor("function makeThing() { return () => target(); }", "makeThing"),
    ).toBeUndefined();
  });

  test("method chain (two distinct callees) is not a wrapper", () => {
    const code = "const chain = (x: number) => builder.build(x).attach(y);";
    expect(findingFor(code, "chain")).toBeUndefined();
  });

  test("regex .test() is not a call to a function named 'test'", () => {
    const code = "function isTsFile(name: string) { return /\\.tsx?$/.test(name); }";
    expect(findingFor(code, "isTsFile")).toBeUndefined();
  });

  test("control case: a plain function call is still a wrapper", () => {
    const f = findingFor("function isThing(name: string) { return someHelper(name); }", "isThing");
    expect(f?.callee).toBe("someHelper");
  });
});

describe("check.run — RepoCheck seam (warning-only)", () => {
  test("unmarked wrapper is a warning, never a violation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "thin-wrapper-guard-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "src", "alias.ts"),
        "export function alias() { return target(); }\nfunction target() { return 1; }\n",
      );
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const outcome = await check.run([root]);
      expect(outcome.violations).toEqual([]);
      expect(outcome.warnings).toHaveLength(1);
      expect(outcome.warnings?.[0]?.message).toBe("alias → target");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("notApplicable when no root resolves", async () => {
    const outcome = await check.run([]);
    expect(outcome.notApplicable).toBe(true);
  });
});
