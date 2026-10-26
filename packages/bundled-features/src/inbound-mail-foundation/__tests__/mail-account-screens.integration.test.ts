// The declarative mailbox screens drive the existing handlers: several
// mailboxes per tenant in one list, rename and disconnect through the exact
// payloads the screen's row action and form produce, and no credential in
// the listed rows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createInboundProviderInMemoryFeature } from "../../inbound-provider-inmemory/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { InboundMailFoundationHandlers, InboundMailFoundationQueries } from "../constants.ts";
import { quarantineEntity, seenMessageEntity, syncCursorEntity } from "../entities.ts";
import { MAIL_ACCOUNT_UPDATED_EVENT_QN } from "../events.ts";
import { createInboundMailFoundationFeature } from "../feature.ts";
import { mailAccountEditScreen, mailAccountListScreen } from "../screens.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createInboundMailFoundationFeature(),
      createInboundProviderInMemoryFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, syncCursorEntity);
  await unsafeCreateEntityTable(stack.db, seenMessageEntity);
  await unsafeCreateEntityTable(stack.db, quarantineEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

type ListedAccount = {
  readonly id: string;
  readonly displayName: string;
  readonly address: string;
  readonly status: string;
};

// The payload the list screen's disconnect row action sends for a row, derived from the
// screen definition so a changed mapping breaks this test instead of passing by hand-copy.
function disconnectPayloadFor(row: ListedAccount): Record<string, unknown> {
  const action = mailAccountListScreen.rowActions?.find(
    (candidate) => candidate.id === "disconnect",
  );
  if (
    action?.kind !== "writeHandler" ||
    action.payload === undefined ||
    !("map" in action.payload)
  ) {
    throw new Error("expected the disconnect row action to map row fields into the payload");
  }
  expect(action.handler).toBe(InboundMailFoundationHandlers.disconnectAccount);
  return Object.fromEntries(
    Object.entries(action.payload.map).map(([target, source]) => [
      target,
      (row as Record<string, unknown>)[source],
    ]),
  );
}

async function renameReasonsOf(accountId: string, tenantId: TenantId): Promise<unknown[]> {
  const events = await loadAggregate(stack.db, accountId, tenantId);
  return events
    .filter((event) => event.type === MAIL_ACCOUNT_UPDATED_EVENT_QN)
    .map((event) => (event.metadata.headers as { reason?: unknown } | undefined)?.reason);
}

describe("mailbox rename audit reason", () => {
  test("is derived from the caller role and ignores a client-supplied reason", async () => {
    const owner = createTestUser({
      id: 4711,
      tenantId: testTenantId(4711),
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const tenantAdmin = createTestUser({
      id: 4712,
      tenantId: owner.tenantId,
      roles: ["TenantAdmin"],
    });
    const { accountId } = (await stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Team",
        address: "t@tenant.example",
        scope: "shared",
      },
      owner,
    )) as { accountId: string };

    await stack.http.writeOk(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, displayName: "By tenant admin", reason: "watch_supervisor" },
      tenantAdmin,
    );
    await stack.http.writeOk(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, displayName: "By system admin" },
      owner,
    );

    expect(await renameReasonsOf(accountId, owner.tenantId)).toEqual([
      "tenant_admin",
      "system_admin",
    ]);
  });
});

describe("mailbox screens over the real handlers", () => {
  test("several mailboxes list, rename and disconnect via the screen payloads", async () => {
    const admin = createTestUser({
      id: 4701,
      tenantId: testTenantId(4701),
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const connect = async (displayName: string, address: string): Promise<string> => {
      const result = (await stack.http.writeOk(
        InboundMailFoundationHandlers.connectAccount,
        { provider: "inmemory", authMethod: "password", displayName, address, scope: "shared" },
        admin,
      )) as { accountId: string };
      return result.accountId;
    };
    const firstId = await connect("Team", "team@tenant.example");
    // A name pasted with spaces around it is stored trimmed.
    const secondId = await connect(" Billing", "billing@tenant.example");

    const listed = (await stack.http.queryOk(
      InboundMailFoundationQueries.listAccounts,
      {},
      admin,
    )) as { rows: readonly ListedAccount[] };
    expect(listed.rows.map((row) => row.id).sort()).toEqual([firstId, secondId].sort());
    for (const row of listed.rows) {
      expect(Object.keys(row).filter((key) => /secret|password|token/i.test(key))).toEqual([]);
    }

    // Screen wiring: the row action maps the row id to the handler's accountId,
    // the audit reason is derived server-side, not part of the form.
    expect(mailAccountListScreen.query).toBe(InboundMailFoundationQueries.listAccounts);
    expect(mailAccountEditScreen.handler).toBe(InboundMailFoundationHandlers.updateAccount);
    expect(mailAccountEditScreen.fields["reason"]).toBeUndefined();

    await stack.http.writeOk(
      InboundMailFoundationHandlers.updateAccount,
      { accountId: firstId, displayName: " Team inbox " },
      admin,
    );
    const secondRow = listed.rows.find((row) => row.id === secondId);
    if (secondRow === undefined) throw new Error("expected the second mailbox in the list");
    await stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      disconnectPayloadFor(secondRow),
      admin,
    );

    const screenListed = (await stack.http.queryOk(
      InboundMailFoundationQueries.listAccounts,
      { limit: 200 },
      admin,
    )) as { rows: readonly ListedAccount[] };
    expect(screenListed.rows).toHaveLength(2);
    const truncated = (await stack.http.queryOk(
      InboundMailFoundationQueries.listAccounts,
      { limit: 1 },
      admin,
    )) as { rows: readonly ListedAccount[] };
    expect(truncated.rows).toHaveLength(1);

    const after = (await stack.http.queryOk(
      InboundMailFoundationQueries.listAccounts,
      {},
      admin,
    )) as { rows: readonly ListedAccount[] };
    const byId = new Map(after.rows.map((row) => [row.id, row]));
    expect(byId.get(firstId)?.displayName).toBe("Team inbox");
    expect(byId.get(secondId)).toEqual(
      expect.objectContaining({ displayName: "Billing", status: "disconnected" }),
    );
  });

  test("a plain User is rejected on the screen's handlers", async () => {
    const admin = createTestUser({
      id: 4702,
      tenantId: testTenantId(4702),
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const user = createTestUser({ id: 4703, tenantId: testTenantId(4702), roles: ["User"] });
    const connected = (await stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Team",
        address: "team@other.example",
        scope: "shared",
      },
      admin,
    )) as { accountId: string };

    const disconnectErr = await stack.http.writeErr(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId: connected.accountId },
      user,
    );
    const updateErr = await stack.http.writeErr(
      InboundMailFoundationHandlers.updateAccount,
      { accountId: connected.accountId, displayName: "x" },
      user,
    );
    expect([disconnectErr.httpStatus, updateErr.httpStatus]).toEqual([403, 403]);
  });
});
