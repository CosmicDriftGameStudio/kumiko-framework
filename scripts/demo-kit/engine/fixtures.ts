import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_PREFIX = "$fixture:";

export function isFixtureRef(value: string): boolean {
  return value.startsWith(FIXTURE_PREFIX);
}

export function resolveFixture(demoDir: string, ref: string): string {
  if (!isFixtureRef(ref)) return ref;
  const name = ref.slice(FIXTURE_PREFIX.length);
  if (!name || name.includes("..") || name.includes("/")) {
    throw new Error(`resolveFixture: invalid fixture ref "${ref}"`);
  }
  const path = join(demoDir, "fixtures", name);
  return readFileSync(path, "utf8");
}
