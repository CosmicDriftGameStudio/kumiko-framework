// Delegates to createTestDb. "Bun" is historical; the aliases
// BunTestDb/createBunTestDb keep migrated test files importable.

import {
  type CreateTestDbOptions,
  createTestDb,
  type TestDb,
} from "@cosmicdrift/kumiko-testing/stack";

export type { TestDb };
export type BunTestDb = TestDb;

export async function createBunTestDb(baseUrl?: string): Promise<TestDb> {
  const opts: CreateTestDbOptions = baseUrl ? { baseUrl } : {};
  return createTestDb(opts);
}

export { createTestDb };
