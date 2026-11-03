import { describe, expect, test } from "bun:test";
import { withEnv } from "../../helpers/with-env.ts";
import {
  createTestRunId,
  runIdOfTestDatabase,
  runIdOfTestRedisKey,
  TEST_RUN_ID_ENV,
  testDatabaseName,
  testRunQueueNamePrefix,
} from "../test-run.ts";

describe("test run ids", () => {
  test("keys, queues and databases of a run resolve back to its id", async () => {
    const runId = createTestRunId();
    await withEnv({ [TEST_RUN_ID_ENV]: runId }, () => {
      expect(runIdOfTestRedisKey(`kt:${runId}:1a2b3c4d:rate`)).toBe(runId);
      expect(runIdOfTestRedisKey(`bull:${testRunQueueNamePrefix("chat-alerts")}-worker:meta`)).toBe(
        runId,
      );
      expect(runIdOfTestDatabase(testDatabaseName())).toBe(runId);
      expect(runIdOfTestDatabase(`kumiko_test_tpl_${runId}_0123456789abcdef`)).toBe(runId);
    });
  });

  test("legacy and hand-named keys and databases belong to no run", () => {
    expect(runIdOfTestRedisKey("kt:1a2b3c4d:rate")).toBeUndefined();
    expect(runIdOfTestRedisKey("bull:kt-1a2b3c4d-api:meta")).toBeUndefined();
    expect(runIdOfTestRedisKey("bull:publicstatus-chat-alerts-0f3e-api:meta")).toBeUndefined();
    expect(runIdOfTestDatabase("kumiko_test_1a2b3c4d")).toBeUndefined();
    expect(runIdOfTestDatabase("kumiko_test_tpl_1a2b3c4d_0123456789abcdef")).toBeUndefined();
    expect(runIdOfTestDatabase("kumiko_test_dboutage_1a2b3c4d")).toBeUndefined();
  });

  test("outside a runner the database name carries no run id", async () => {
    await withEnv({ [TEST_RUN_ID_ENV]: undefined }, () => {
      expect(runIdOfTestDatabase(testDatabaseName())).toBeUndefined();
    });
  });
});
