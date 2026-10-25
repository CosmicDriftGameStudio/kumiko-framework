// The search probe against a search service that fails, and the "latest run" empty text of a
// tenant whose finished run had nothing the caller may see.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createInMemorySearchAdapter,
  type SearchAdapter,
} from "@cosmicdrift/kumiko-framework/search";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  type EditRelatedListSection,
  evalFieldCondition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { BuiltInProbeKeys } from "../built-in-probes.ts";
import { ReadinessQueries, ReadinessWrites } from "../constants.ts";
import { ScreenTextKeys, systemCheckScreen } from "../screens.ts";
import { setupReadinessStack } from "./readiness-test-stack.ts";

const SEARCH_PROBE = "readiness:probe:search";

const unreachableSearch: SearchAdapter = {
  ...createInMemorySearchAdapter(),
  search: async () => {
    throw new Error("connect ECONNREFUSED meili.internal:7700");
  },
};

type Row = { probe: string; status: string; message: { i18nKey: string } };

let stack: TestStack;
let nextUser = 950;

beforeAll(async () => {
  stack = await setupReadinessStack({
    features: [],
    extraContext: { searchAdapter: unreachableSearch },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

function freshUser(role: "TenantAdmin" | "SystemAdmin") {
  nextUser += 1;
  return createTestUser({ id: nextUser, tenantId: testTenantId(nextUser), roles: [role] });
}

async function runAndReadLatest(user: ReturnType<typeof freshUser>) {
  await stack.http.writeOk(ReadinessWrites.runProbes, {}, user);
  await stack.drainJobs();
  return stack.http.queryOk<{ rows: Row[] }>(ReadinessQueries.latestResults, {}, user);
}

function latestEmptyTitleFor(summary: Readonly<Record<string, unknown>>): string | undefined {
  const latest = systemCheckScreen(false).layout.sections.find(
    (section): section is EditRelatedListSection =>
      section.kind === "relatedList" && section.id === "latest",
  );
  const emptyState = latest?.emptyState;
  return (
    emptyState?.variants?.find((variant) => evalFieldCondition(variant.when, summary)) ?? emptyState
  )?.title;
}

describe("search probe", () => {
  test("an unreachable search service fails with its own text and keeps the raw error out", async () => {
    const { rows } = await runAndReadLatest(freshUser("SystemAdmin"));

    const search = rows.find((row) => row.probe === SEARCH_PROBE);
    expect(search?.status).toBe("failed");
    expect(search?.message.i18nKey).toBe(BuiltInProbeKeys.searchUnavailable);
    expect(JSON.stringify(search)).not.toContain("meili.internal");
  });
});

describe("latest run empty text", () => {
  test("before the first run the screen asks to start a check", async () => {
    const admin = freshUser("TenantAdmin");

    const summary = await stack.http.queryOk<Record<string, unknown>>(
      ReadinessQueries.latestSummary,
      {},
      admin,
    );

    expect(latestEmptyTitleFor(summary)).toBe(ScreenTextKeys.latestEmpty);
  });

  test("a finished run without visible checks says there is nothing to check", async () => {
    const admin = freshUser("TenantAdmin");

    const { rows } = await runAndReadLatest(admin);
    const summary = await stack.http.queryOk<Record<string, unknown>>(
      ReadinessQueries.latestSummary,
      {},
      admin,
    );

    expect(rows).toEqual([]);
    expect(latestEmptyTitleFor(summary)).toBe(ScreenTextKeys.latestNothingToCheck);
  });
});
