import { randomBytes } from "node:crypto";
import { createEncryptionProvider, type DbConnection } from "@kumiko/framework/db";
import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createConfigFeature } from "../../config";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { TierEngineHandlers, TierEngineQueries } from "../constants";
import { tierAssignmentEntity } from "../entity";
import { tierEngineFeature } from "../feature";

// --- Setup ---

let stack: TestStack;
let db: DbConnection;
let resolver: ConfigResolver;

const systemAdmin = TestUsers.systemAdmin;
let assignmentId: string;

const configFeature = createConfigFeature();
const tenantFeature = createTenantFeature();
const testEncryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createEncryptionProvider(testEncryptionKey);
  resolver = createConfigResolver({ encryption });

  stack = await setupTestStack({
    features: [configFeature, tenantFeature, tierEngineFeature],
    extraContext: { configResolver: resolver, configEncryption: encryption },
  });
  db = stack.db;

  await createEntityTable(db, tenantEntity);
  await createEntityTable(db, tierAssignmentEntity);
  await pushTables(db, { configValuesTable });
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

// --- Scenario 1: create tier-assignment ---

describe("scenario 1: create", () => {
  test("admin creates a tier-assignment for the calling tenant", async () => {
    const result = await stack.http.writeOk(
      TierEngineHandlers.create,
      { tier: "pro" },
      systemAdmin,
    );

    const data = result!["data"] as Record<string, unknown>;
    expect(data["tier"]).toBe("pro");
    expect(typeof data["id"]).toBe("string");
    expect(result!["isNew"]).toBe(true);

    assignmentId = data["id"] as string;
  });
});

// --- Scenario 2: update tier ---

describe("scenario 2: update", () => {
  test("admin updates the tier value", async () => {
    const result = await stack.http.writeOk(
      TierEngineHandlers.update,
      { id: assignmentId, version: 1, changes: { tier: "business" } },
      systemAdmin,
    );

    const data = result!["data"] as Record<string, unknown>;
    expect(data["tier"]).toBe("business");
    expect(result!["isNew"]).toBe(false);
  });
});

// --- Scenario 3: get-active-tier convenience query ---

describe("scenario 3: get-active-tier", () => {
  test("returns the current tier for the calling tenant", async () => {
    const result = await stack.http.queryOk<Record<string, unknown> | null>(
      TierEngineQueries.getActiveTier,
      {},
      systemAdmin,
    );

    expect(result).not.toBeNull();
    expect(result!["tier"]).toBe("business");
  });
});

// --- Scenario 4: list returns the tenant's assignments ---

describe("scenario 4: list", () => {
  test("returns the tier-assignment(s) for the calling tenant", async () => {
    const result = await stack.http.queryOk<{
      rows: Record<string, unknown>[];
      nextCursor: string | null;
    }>(TierEngineQueries.list, {}, systemAdmin);

    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!["tier"]).toBe("business");
  });
});
