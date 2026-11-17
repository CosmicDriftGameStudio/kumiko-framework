import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { weakAssertionTestCounts } from "../guard-weak-assertions";

const ROOTS = [{ absPath: "/repo" }];
const FILE = "packages/a/src/__tests__/x.test.ts";

function countsFor(lines: readonly string[]): Record<string, number> {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(`/repo/${FILE}`, lines.join("\n"));
  return weakAssertionTestCounts([sf], ROOTS);
}

describe("weak-assertions guard", () => {
  test("counts tests whose only matchers are toBeDefined or toBeTruthy", () => {
    const counts = countsFor([
      'test("a", () => { expect(load()).toBeDefined(); });',
      'test("b", () => { expect(load()).toBeTruthy(); expect(other()).toBeDefined(); });',
      'it("c", async () => { const value = await load(); expect(value).toBeTruthy(); });',
    ]);
    expect(counts).toEqual({ [FILE]: 3 });
  });

  test("a test with another matcher or a modifier is not counted", () => {
    const counts = countsFor([
      'test("a", () => { expect(load()).toBeDefined(); expect(load().id).toBe("x"); });',
      'test("b", () => { expect(load()).not.toBeTruthy(); });',
      'test("c", async () => { await expect(load()).resolves.toBeDefined(); });',
    ]);
    expect(counts).toEqual({});
  });

  test("another assertion in the body makes the test strong", () => {
    const counts = countsFor([
      'test("a", async () => { await stack.http.writeOk("x", {}); expect(load()).toBeDefined(); });',
      'test("b", () => { screen.getByText("Saved"); expect(load()).toBeTruthy(); });',
      'function assertSaved() { expect(load()).toEqual({ id: "x" }); }',
      'test("c", () => { assertSaved(); expect(load()).toBeDefined(); });',
    ]);
    expect(counts).toEqual({});
  });

  test("tests without expect and describe blocks are not counted", () => {
    const counts = countsFor([
      'test("a", () => { doSomething(); });',
      'describe("group", () => { expect(load()).toBeDefined(); });',
    ]);
    expect(counts).toEqual({});
  });
});
