// createUncheckedSystemDb's grantedUnsafeRawRunner (db/tenant-db.ts) hands out a
// raw runner without a grant check. Under a resolved member principal that door
// is closed only because applyMemberResolutionReadOnly drops systemDb and
// dbOutsideTransaction — this pins that, plus the write surfaces it neutralizes.
import { describe, expect, test } from "bun:test";
import { stubHandlerContext } from "../../engine/__tests__/handler-context-stub.ts";
import type { HandlerContext } from "../../engine/types/index.ts";
import { AccessDeniedError, FrameworkReasons } from "../../errors/index.ts";
import { applyMemberResolutionReadOnly } from "../handler-context-member-resolution.ts";

// [namespace, member] pairs; "notify" is the one denied call that stays top-level.
const DENIED_CALLS: ReadonlyArray<readonly [string, string]> = [
  ["dispatch", "write"],
  ["dispatch", "writeAs"],
  ["dispatch", "queryAs"],
  ["dispatch", "queryAsMember"],
  ["events", "append"],
  ["events", "unsafeAppend"],
  ["events", "tryAppend"],
  ["events", "fetchForWriting"],
  ["events", "archive"],
  ["events", "restore"],
  ["events", "snapshot"],
  ["auth", "resolveActiveMembership"],
];

const stubCall = async () => "escalated";

// A context wired with every escalation surface a handler could otherwise reach.
function fullyWiredContext(): HandlerContext {
  const base = stubHandlerContext();
  const db = Object.defineProperty(base.db, "outsideTransaction", {
    value: { escalated: true },
    enumerable: false,
    configurable: true,
  });
  // @cast-boundary test stub — the surfaces below only need to exist, not to work.
  const stub = <T>(): T => stubCall as unknown as T;
  return {
    ...base,
    db,
    systemDb: stub(),
    crossTenantReads: stub(),
    notify: stub(),
    lifecycle: { runPreSave: stub(), afterCommit: stub(), afterRollback: stub() },
    tenants: { config: stub(), writeTarget: stub() },
    services: {
      ...base.services,
      files: stub(),
      derivatives: stub(),
      _fileProviderResolver: stub(),
      _notifyFactory: stub(),
      _notifyInTransactionFactory: stub(),
      _notifyAfterCommitFactory: stub(),
      jobRunner: { handleEvent: async () => {} },
      extensions: { custom: "kept" },
    },
  };
}

function readOnlyContext(): HandlerContext {
  return applyMemberResolutionReadOnly(fullyWiredContext());
}

describe("applyMemberResolutionReadOnly", () => {
  test("drops every surface that could reach an unchecked system-scope db", () => {
    const readOnly = readOnlyContext();

    expect(readOnly.systemDb).toBeUndefined();
    expect(readOnly.crossTenantReads).toBeUndefined();
    expect(readOnly.lifecycle.runPreSave).toBeUndefined();
    expect(readOnly.tenants.writeTarget).toBeUndefined();
    expect(readOnly.services.files).toBeUndefined();
    expect(readOnly.services.derivatives).toBeUndefined();
    expect(Reflect.get(readOnly.db, "outsideTransaction")).toBeUndefined();
  });

  test("drops the factories that would rebuild file storage or notify", () => {
    const { services } = readOnlyContext();

    expect(services._fileProviderResolver).toBeUndefined();
    expect(services._notifyFactory).toBeUndefined();
    expect(services._notifyInTransactionFactory).toBeUndefined();
    expect(services._notifyAfterCommitFactory).toBeUndefined();
  });

  test.each([...DENIED_CALLS, ["", "notify"] as const])(
    "%s.%s rejects with the member-resolution reason",
    async (namespace, member) => {
      const readOnly = readOnlyContext();
      const owner = namespace === "" ? readOnly : Reflect.get(readOnly, namespace);
      // @cast-boundary test stub — every denied surface is a call returning a promise.
      const denied = Reflect.get(owner as object, member) as () => Promise<unknown>;

      const error = await denied().then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(AccessDeniedError);
      // @cast-boundary narrowed by the assertion above.
      expect((error as AccessDeniedError).details).toMatchObject({
        reason: FrameworkReasons.memberResolutionReadOnly,
      });
    },
  );

  test("lifecycle.afterCommit, lifecycle.afterRollback and the jobRunner proxy throw synchronously", () => {
    const { lifecycle, services } = readOnlyContext();
    const { afterCommit, afterRollback } = lifecycle;

    expect(() => afterCommit?.(async () => {})).toThrow(AccessDeniedError);
    expect(() => afterRollback?.(async () => {})).toThrow(AccessDeniedError);
    expect(() => services.jobRunner?.handleEvent).toThrow(AccessDeniedError);
  });

  test("allowlisted proxies stay awaitable and inspectable but deny other reads", async () => {
    const redis = { get: () => "value", set: () => "escalated" };
    const base = stubHandlerContext();
    // @cast-boundary test stub — only the redis methods under test are present.
    const wired = { ...base, services: { ...base.services, redis } } as unknown as HandlerContext;
    const proxied = applyMemberResolutionReadOnly(wired).services.redis;

    expect(Reflect.get(proxied ?? {}, "then")).toBeUndefined();
    expect(Reflect.get(proxied ?? {}, Symbol.toPrimitive)).toBeUndefined();
    expect(await Promise.resolve(proxied)).toBe(proxied);
    expect(() => Reflect.get(proxied ?? {}, "set")).toThrow(AccessDeniedError);
    expect(typeof Reflect.get(proxied ?? {}, "get")).toBe("function");
  });

  test("extensions pass through unchanged", () => {
    expect(readOnlyContext().services.extensions).toEqual({ custom: "kept" });
  });
});
