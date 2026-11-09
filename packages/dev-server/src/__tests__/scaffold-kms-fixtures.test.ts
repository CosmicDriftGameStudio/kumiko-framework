// The feature-ast codemod fixtures `new-*` must stay byte-identical to what the scaffolds emit,
// otherwise the codemod test proves a shape no new app has.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldApp } from "../scaffold-app.ts";

const FIXTURES = join(
  import.meta.dir,
  "../../../feature-ast/src/__tests__/fixtures/scaffold-kms-mode",
);
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function scaffold(name: string, starter: "demo" | "blank"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "scaffold-kms-"));
  roots.push(root);
  const destination = join(root, name);
  await scaffoldApp({ name, destination, starter, frameworkVersion: "0.1.0" });
  return destination;
}

describe("feature-ast scaffold-kms-mode fixtures match the scaffold output", () => {
  test("demo starter: bin/main.ts and bin/kumiko.ts", async () => {
    const destination = await scaffold("demoapp", "demo");
    expect(readFileSync(join(destination, "bin/main.ts"), "utf8")).toBe(
      fixture("new-demo-main.txt"),
    );
    expect(readFileSync(join(destination, "bin/kumiko.ts"), "utf8")).toBe(
      fixture("new-kumiko.txt"),
    );
  });

  test("blank starter: bin/main.ts and bin/kumiko.ts", async () => {
    const destination = await scaffold("blankapp", "blank");
    expect(readFileSync(join(destination, "bin/main.ts"), "utf8")).toBe(
      fixture("new-blank-main.txt"),
    );
    expect(readFileSync(join(destination, "bin/kumiko.ts"), "utf8")).toBe(
      fixture("new-kumiko.txt"),
    );
  });
});
