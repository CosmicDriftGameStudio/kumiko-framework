// The beforeTransaction phase has no write need at all. ctx.db.outsideTransaction was already
// dropped; ctx.systemDb.outsideTransaction (r.systemScope() handlers) was a second door to the same
// durable writes and is pinned shut here, next to the surfaces the reservation phase also denies.
import { describe, expect, test } from "bun:test";
import type { NotifyFn, NotifyOptions } from "@cosmicdrift/kumiko-types/handlers";
import type { DbRunner } from "../../db/connection.ts";
import { createTenantDb, createUncheckedSystemDb } from "../../db/tenant-db.ts";
import { stubHandlerContext } from "../../engine/__tests__/handler-context-stub.ts";
import type { HandlerContext } from "../../engine/types/index.ts";

import { InternalError } from "../../errors/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import { attachOutsideTransaction } from "../attach-outside-transaction.ts";
import {
  applyBeforeTransactionReadOnly,
  denyTransactionBoundSurfaces,
} from "../handler-context-phase-denials.ts";

const own = testTenantId(1);
const dispatchedNotify: NotifyFn = async () => ({ kind: "dispatched", deliveries: [] });
const NOTIFY_OPTIONS = {} satisfies NotifyOptions;

// @cast-boundary test stub — no check below executes a query
const unusedRunner = {
  unsafe: async () => {
    throw new Error("before-transaction tests must not reach the DB");
  },
} as unknown as DbRunner;

function systemModeDb() {
  return createTenantDb({
    db: unusedRunner,
    tenantId: own,
    mode: "system",
    reason: "test builds the system-mode source of the unchecked system db",
  });
}

function systemScopeContext(): HandlerContext {
  const outsideDb = systemModeDb();
  const db = systemModeDb();
  const base = stubHandlerContext({ tenantId: own });
  return {
    ...base,
    db: attachOutsideTransaction(db, outsideDb),
    systemDb: createUncheckedSystemDb(db, outsideDb),
    notify: dispatchedNotify,
    lifecycle: {
      runPreSave: async (_handler, changes) => changes,
      afterCommit: () => {},
      afterRollback: () => {},
      signal: new AbortController().signal,
    },
    services: {
      ...base.services,
      jobRunner: { handleEvent: async () => {} },
      _notifyFactory: () => dispatchedNotify,
      _notifyInTransactionFactory: () => dispatchedNotify,
      _notifyAfterCommitFactory: () => dispatchedNotify,
    },
  };
}

function expectNoNotifyFactories(services: HandlerContext["services"]): void {
  expect(services._notifyFactory).toBeUndefined();
  expect(services._notifyInTransactionFactory).toBeUndefined();
  expect(services._notifyAfterCommitFactory).toBeUndefined();
}

describe("applyBeforeTransactionReadOnly", () => {
  test("closes ctx.systemDb.outsideTransaction without replacing the systemDb", () => {
    const wired = systemScopeContext();
    expect(wired.systemDb?.outsideTransaction).toBeDefined();

    const phased = applyBeforeTransactionReadOnly(wired);

    expect(phased.systemDb).toBe(wired.systemDb);
    expect(phased.systemDb?.outsideTransaction).toBeUndefined();
    expect(Reflect.get(phased.db, "outsideTransaction")).toBeUndefined();
  });

  test("the systemDb stays usable for in-transaction checks", () => {
    const wired = systemScopeContext();
    const phased = applyBeforeTransactionReadOnly(wired);

    expect(phased.systemDb?.assertTenantMatch(own)).toBe(wired.systemDb?.assertTenantMatch(own));
  });

  test("denies the surfaces bound to the not-yet-open transaction", () => {
    const phased = applyBeforeTransactionReadOnly(systemScopeContext());

    expect(() => phased.lifecycle.afterCommit?.(async () => {})).toThrow(InternalError);
    expect(() => phased.lifecycle.afterRollback?.(async () => {})).toThrow(InternalError);
    expect(() => phased.services.jobRunner?.handleEvent).toThrow(InternalError);
    expect(() => phased.dispatch.write("any:write", {})).toThrow(InternalError);
    expect(() => phased.notify?.("any:notification", NOTIFY_OPTIONS)).toThrow(InternalError);
    expectNoNotifyFactories(phased.services);
  });

  test("keeps the cancellation signal and the preSave runner", () => {
    const wired = systemScopeContext();
    const phased = applyBeforeTransactionReadOnly(wired);

    expect(phased.lifecycle.signal).toBe(wired.lifecycle.signal);
    expect(phased.lifecycle.runPreSave).toBe(wired.lifecycle.runPreSave);
  });
});

describe("denyTransactionBoundSurfaces (reservation phase)", () => {
  test("keeps the outside-transaction handles reservations write through", () => {
    const wired = systemScopeContext();
    const phased = denyTransactionBoundSurfaces(wired);

    expect(phased.systemDb?.outsideTransaction).toBeDefined();
    expect(Reflect.get(phased.db, "outsideTransaction")).toBeDefined();
    expect(() => phased.lifecycle.afterCommit?.(async () => {})).toThrow(InternalError);
    expectNoNotifyFactories(phased.services);
  });
});
