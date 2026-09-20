import { expect, test } from "bun:test";
import { E2E_PORTS } from "./e2e-ports";

test("every E2E config owns a distinct port", () => {
  const owners = new Map<number, string[]>();
  for (const [key, port] of Object.entries(E2E_PORTS)) {
    owners.set(port, [...(owners.get(port) ?? []), key]);
  }
  const collisions = [...owners].filter(([, keys]) => keys.length > 1);
  expect(collisions).toEqual([]);
});
