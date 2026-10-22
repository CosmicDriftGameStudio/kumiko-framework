import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient, type DbConnection, tableExists } from "@cosmicdrift/kumiko-framework/db";
import {
  createDbConnection,
  listDatabaseNamesWithPrefix,
} from "@cosmicdrift/kumiko-framework/internal/stack-support";
import { noteFeature } from "../../__tests__/note-feature.ts";
import { withEnv } from "../../helpers/with-env.ts";
import { runWithTestDbTemplates } from "../../integration-runner.ts";
import {
  adminUrlOf,
  buildTestDbTemplate,
  dropTestDbTemplates,
  ensureTestDbTemplate,
  requireEnv,
  TEST_DB_TEMPLATE_RUN_ENV,
  testDbTemplatePrefix,
} from "../db.ts";
import { setupTestStack } from "../test-stack.ts";

async function templateNamesOfRun(runId: string): Promise<readonly string[]> {
  const admin = createDbConnection({
    url: adminUrlOf(requireEnv("TEST_DATABASE_URL")),
    maxConnections: 1,
  });
  try {
    return await listDatabaseNamesWithPrefix(admin.db, testDbTemplatePrefix(runId));
  } finally {
    await admin.close();
  }
}

async function currentDatabaseOf(db: DbConnection): Promise<string | undefined> {
  const rows = await asRawClient(db).unsafe<{ name: string }>("SELECT current_database() AS name");
  return rows[0]?.name;
}

function runIdOfCurrentRun(): string {
  const runId = process.env[TEST_DB_TEMPLATE_RUN_ENV];
  if (runId === undefined) throw new Error(`${TEST_DB_TEMPLATE_RUN_ENV} is not set inside the run`);
  return runId;
}

describe("setupTestStack inside an integration run", () => {
  test("parallel stacks with one schema clone a single template, each into its own database", async () => {
    let runId = "";
    let templatesDuringRun: readonly string[] = [];
    const exitCode = await runWithTestDbTemplates(async () => {
      runId = runIdOfCurrentRun();
      const [first, second] = await Promise.all([
        setupTestStack({ features: [noteFeature] }),
        setupTestStack({ features: [noteFeature] }),
      ]);
      try {
        templatesDuringRun = await templateNamesOfRun(runId);
        const firstDb = await currentDatabaseOf(first.db);
        const secondDb = await currentDatabaseOf(second.db);
        expect(firstDb).not.toBe(secondDb);
        expect(templatesDuringRun).not.toContain(firstDb);
        expect(templatesDuringRun).not.toContain(secondDb);
        expect(await tableExists(first.db, "public.read_testing_notes")).toBe(true);
        expect(await tableExists(second.db, "public.read_testing_notes")).toBe(true);
      } finally {
        await first.cleanup();
        await second.cleanup();
      }
      return 0;
    });

    expect(exitCode).toBe(0);
    expect(templatesDuringRun).toHaveLength(1);
    expect(await templateNamesOfRun(runId)).toEqual([]);
  });

  test("a stack outside a run builds its schema in place", async () => {
    const stack = await withEnv({ [TEST_DB_TEMPLATE_RUN_ENV]: undefined }, () =>
      setupTestStack({ features: [noteFeature] }),
    );
    try {
      expect(await tableExists(stack.db, "public.read_testing_notes")).toBe(true);
    } finally {
      await stack.cleanup();
    }
  });
});

describe("test db template build", () => {
  test("two builds of one template name across the lock build the schema once", async () => {
    const runId = randomBytes(4).toString("hex");
    const templateName = `${testDbTemplatePrefix(runId)}shared`;
    let schemaBuilds = 0;
    const buildSchema = async (): Promise<void> => {
      schemaBuilds++;
      await new Promise((resolve) => setTimeout(resolve, 50));
    };
    try {
      await Promise.all([
        buildTestDbTemplate(templateName, buildSchema),
        buildTestDbTemplate(templateName, buildSchema),
      ]);
      expect(schemaBuilds).toBe(1);
      expect(await templateNamesOfRun(runId)).toEqual([templateName]);
    } finally {
      await dropTestDbTemplates(requireEnv("TEST_DATABASE_URL"), runId);
    }
  });

  test("a failed build is retried and leaves no build database behind", async () => {
    const runId = randomBytes(4).toString("hex");
    const templateName = `${testDbTemplatePrefix(runId)}retry`;
    try {
      await expect(
        ensureTestDbTemplate(templateName, async () => {
          throw new Error("schema build failed");
        }),
      ).rejects.toThrow("schema build failed");
      // The cache entry is cleared by a microtask-chained catch; yield once before retrying.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await ensureTestDbTemplate(templateName, async () => undefined);
      expect(await templateNamesOfRun(runId)).toEqual([templateName]);
    } finally {
      await dropTestDbTemplates(requireEnv("TEST_DATABASE_URL"), runId);
    }
  });
});
