// fw#2914 — proves the escape-hatch audit trail is wired end-to-end on the
// REAL production path: the registered "run-forget-cleanup" cron job (not
// runForgetCleanup called directly, not a hand-fed sink) forwards its
// JobContext's `_escapeHatchAuditSink` + `systemUser.id` down through
// runForgetCleanup → the per-entity `createEscapeHatchReporter` →
// ctx.db.unsafeRaw(reason) inside a declared-escapeHatch hook, so a
// declared raw-SQL use is actually attributed and audited instead of
// landing on the anonymous "<unattributed>" fallback.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type EscapeHatchUseEvent,
  EXT_USER_DATA,
  type JobContext,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, userEntity } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { createForgetSeeders, READ_TENANT_MEMBERSHIPS_DDL } from "./forget-test-helpers";

const FORGET_USER = "ffffffff-ffff-4fff-8fff-000000000001";
const TENANT_A = "00000000-0000-4000-8000-0000000000f9";

const AUDITED_REASON =
  "fw#2914 test: declared escapeHatch on the real run-forget-cleanup job path — must be audited, not <unattributed>";

const auditedHook: UserDataDeleteHook = async (ctx) => {
  await asRawClient(ctx.db.unsafeRaw(AUDITED_REASON)).unsafe(
    `DELETE FROM test_audited_entity WHERE tenant_id = $1`,
    [ctx.tenantId],
  );
};

const auditedFeature = defineFeature("test-audited-entity", (r) => {
  r.useExtension(EXT_USER_DATA, "audited-entity", {
    export: async () => null,
    delete: auditedHook,
    escapeHatch: { reason: AUDITED_REASON },
  });
});

const seed = (db: unknown) =>
  // biome-ignore lint/suspicious/noExplicitAny: dummy file-writer; these seeders never write binaries.
  createForgetSeeders(db as any, { write: async () => {} });

describe("escape-hatch audit :: real run-forget-cleanup job forwards _escapeHatchAuditSink + systemUser.id", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [
        createUserFeature(),
        createDataRetentionFeature(),
        createComplianceProfilesFeature(),
        authFoundationFeature,
        createSessionsFeature(),
        createUserDataRightsFeature(),
        auditedFeature,
      ],
    });
    await unsafeCreateEntityTable(stack.db, userEntity);
    await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
    await createEventsTable(stack.db);
    await asRawClient(stack.db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
    await asRawClient(stack.db).unsafe(`
      CREATE TABLE IF NOT EXISTS test_audited_entity (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL
      )
    `);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("declared hook's unsafeRaw use is reported with a qualified handler + the job's systemUser as actor", async () => {
    const job = stack.registry.getJob("user-data-rights:job:run-forget-cleanup");
    expect(job).toBeTruthy();

    await seed(stack.db).seedForgetUser(FORGET_USER);
    await seed(stack.db).seedMembership(FORGET_USER, TENANT_A);

    const events: EscapeHatchUseEvent[] = [];
    const systemUser = createSystemUser(TENANT_A);
    const noopLog: JobContext["log"] = {
      info() {},
      warn() {},
      error() {},
      debug() {},
      child(): JobContext["log"] {
        return this;
      },
    };

    await job?.handler({}, {
      db: createTenantDb(stack.db, TENANT_A, "tenant", undefined, undefined, undefined, {
        unsafeRaw: { reason: "executes overdue Art.17 forget requests across every tenant" },
      }),
      registry: stack.registry,
      systemUser,
      log: noopLog,
      _escapeHatchAuditSink: async (event: EscapeHatchUseEvent) => {
        events.push(event);
      },
    } as unknown as JobContext);

    const hit = events.find((e) => e.reason === AUDITED_REASON);
    expect(hit).toBeDefined();
    expect(hit?.handler).toBe("userData:audited-entity");
    expect(hit?.kind).toBe("unsafe-raw");
    expect(hit?.tenantId).toBe(TENANT_A);
    // The job's OWN systemUser.id, not "system"/"<unattributed>" — proves
    // ctx.systemUser.id really travels from the JobContext down to the
    // per-hook reporter instead of a hardcoded/default actor.
    expect(hit?.actor).toBe(systemUser.id);
    expect(hit?.actor).not.toBe("<unattributed>");
  });
});
