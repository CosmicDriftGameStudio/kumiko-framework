// Delegiert an createTestDb. "Bun" im Namen ist historisch; die Aliase
// BunTestDb/createBunTestDb halten die migrierten Test-Files importierbar.

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
