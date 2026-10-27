// The mailbox probe checks every shared mailbox and the starter's own; another user's personal
// mailbox never shows up. An auth failure from the provider turns the row red with a fixed text.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { type TestStack, unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { InboundMailFoundationHandlers } from "../../inbound-mail-foundation/constants.ts";
import { seenMessageEntity, syncCursorEntity } from "../../inbound-mail-foundation/entities.ts";
import { createInboundMailFoundationFeature } from "../../inbound-mail-foundation/feature.ts";
import { ingestFailureEntity } from "../../inbound-mail-foundation/ingest-failures.ts";
import { InboundAuthError } from "../../inbound-mail-foundation/provider-errors.ts";
import { quarantineEntity } from "../../inbound-mail-foundation/quarantine-entities.ts";
import {
  createInboundProviderInMemoryFeature,
  failNextVerifyWith,
  resetInboundInMemory,
} from "../../inbound-provider-inmemory/index.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { ReadinessQueries, ReadinessWrites } from "../constants.ts";
import { setupReadinessStack } from "./readiness-test-stack.ts";

const PROBE = "inbound-mail-foundation:probe:mailboxes";
const PROBE_KEYS = {
  reachable: "inbound-mail-foundation.probe.mailbox.reachable",
  authFailed: "inbound-mail-foundation.probe.mailbox.auth-failed",
};

type Row = {
  probe: string;
  status: string;
  targetId?: string;
  label: { i18nKey: string; i18nParams?: { name: string } };
  message: { i18nKey: string };
};

let stack: TestStack;
let nextTenant = 1100;

beforeAll(async () => {
  stack = await setupReadinessStack({
    features: [
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      createInboundProviderInMemoryFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, syncCursorEntity);
  await unsafeCreateEntityTable(stack.db, seenMessageEntity);
  await unsafeCreateEntityTable(stack.db, quarantineEntity);
  await unsafeCreateEntityTable(stack.db, ingestFailureEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => resetInboundInMemory());

function tenantWithTwoAdmins() {
  nextTenant += 1;
  const tenantId = testTenantId(nextTenant);
  return {
    starter: createTestUser({ id: nextTenant, tenantId, roles: ["TenantAdmin"] }),
    colleague: createTestUser({ id: nextTenant + 1000, tenantId, roles: ["TenantAdmin"] }),
  };
}

async function connect(
  user: ReturnType<typeof createTestUser>,
  displayName: string,
  scope: "shared" | "user",
): Promise<string> {
  const { accountId } = await stack.http.writeOk<{ accountId: string }>(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "inmemory",
      authMethod: "password",
      displayName,
      address: `${displayName.toLowerCase()}@secret-mailbox.example`,
      scope,
    },
    user,
  );
  return accountId;
}

async function mailboxRows(user: ReturnType<typeof createTestUser>): Promise<Row[]> {
  await stack.http.writeOk(ReadinessWrites.runProbes, {}, user);
  await stack.drainJobs();
  const { rows } = await stack.http.queryOk<{ rows: Row[] }>(
    ReadinessQueries.latestResults,
    {},
    user,
  );
  return rows.filter((row) => row.probe === PROBE);
}

describe("mailbox probe", () => {
  test("checks shared and own mailboxes, hides another user's, and never stores an address", async () => {
    const { starter, colleague } = tenantWithTwoAdmins();
    await connect(starter, "Team", "shared");
    await connect(starter, "Mine", "user");
    await connect(colleague, "Theirs", "user");

    const rows = await mailboxRows(starter);

    expect(rows.map((row) => row.label.i18nParams?.name).sort()).toEqual(["Mine", "Team"]);
    expect(
      rows.every((row) => row.status === "ok" && row.message.i18nKey === PROBE_KEYS.reachable),
    ).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("secret-mailbox.example");
  });

  test("an auth failure from the provider turns that mailbox red with the fixed text", async () => {
    const { starter } = tenantWithTwoAdmins();
    const brokenId = await connect(starter, "Broken", "shared");
    await connect(starter, "Fine", "shared");
    failNextVerifyWith(brokenId, new InboundAuthError("IMAP auth failed at host: bad password"));

    const rows = await mailboxRows(starter);

    const broken = rows.find((row) => row.targetId === brokenId);
    expect(broken?.status).toBe("failed");
    expect(broken?.message.i18nKey).toBe(PROBE_KEYS.authFailed);
    expect(rows.filter((row) => row.status === "ok")).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("bad password");
  });

  test("a tenant without mailboxes gets the no-targets row", async () => {
    const { starter } = tenantWithTwoAdmins();

    const rows = await mailboxRows(starter);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("skipped");
  });
});
