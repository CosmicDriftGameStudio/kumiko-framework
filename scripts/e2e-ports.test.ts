import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_PORTS } from "../samples/e2e/e2e-ports";

test("every E2E config owns a distinct port", () => {
  const owners = new Map<number, string[]>();
  for (const [key, port] of Object.entries(E2E_PORTS)) {
    owners.set(port, [...(owners.get(port) ?? []), key]);
  }
  const collisions = [...owners].filter(([, keys]) => keys.length > 1);
  expect(collisions).toEqual([]);
});

test("no recipe e2e config or agent example hard-codes a registry port", () => {
  const registryByPort = new Map(Object.entries(E2E_PORTS).map(([key, port]) => [port, key]));
  const root = join(import.meta.dir, "..");
  const files = [
    ...new Bun.Glob("samples/recipes/*/e2e/*.ts").scanSync({ cwd: root }),
    ...new Bun.Glob("packages/framework/agents/examples/*.md").scanSync({ cwd: root }),
  ];
  const hardCodedPort = /const PORT = (\d+)|\["PORT"\] \?\? (\d+)/g;
  const clashes: string[] = [];
  for (const file of files) {
    for (const match of readFileSync(join(root, file), "utf-8").matchAll(hardCodedPort)) {
      const owner = registryByPort.get(Number(match[1] ?? match[2]));
      if (owner) clashes.push(`${file} uses the port of ${owner}`);
    }
  }
  expect(clashes).toEqual([]);
});
