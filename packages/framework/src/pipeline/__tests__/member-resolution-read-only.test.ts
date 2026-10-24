// createUncheckedSystemDb's grantedUnsafeRawRunner (db/tenant-db.ts) hands out a
// raw runner without a grant check. Under a resolved member principal that door
// is closed only because applyMemberResolutionReadOnly drops systemDb and
// dbOutsideTransaction — this pins that, plus the write surfaces it neutralizes.
import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "../../engine/types/index.ts";
import { AccessDeniedError, FrameworkReasons } from "../../errors/index.ts";
import { applyMemberResolutionReadOnly } from "../dispatch-shared.ts";

const DROPPED_SURFACES = ["systemDb", "crossTenantReads", "runPreSave", "files", "derivatives"];

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

const stubCall = () => "escalated";

function readOnlyContext(): Record<string, unknown> {
  const namespaces = Object.fromEntries(
    ["dispatch", "events", "auth"].map((namespace) => [
      namespace,
      Object.fromEntries(
        DENIED_CALLS.filter(([owner]) => owner === namespace).map(([, member]) => [
          member,
          stubCall,
        ]),
      ),
    ]),
  );
  const wired = Object.fromEntries(
    [...DROPPED_SURFACES, "notify", "scheduleAfterCommit", "scheduleAfterRollback"].map((key) => [
      key,
      stubCall,
    ]),
  );
  const db = Object.defineProperty({}, "outsideTransaction", {
    value: { escalated: true },
    enumerable: false,
    configurable: true,
  });
  // @cast-boundary test stub — applyMemberResolutionReadOnly only spreads and overwrites.
  const ctx = {
    ...wired,
    ...namespaces,
    db,
    jobRunner: { handleEvent: () => "ran" },
  } as unknown as HandlerContext;
  return applyMemberResolutionReadOnly(ctx) as unknown as Record<string, unknown>;
}

function readOnlyContextWithRedis(): Record<string, unknown> {
  const redis = { get: () => "value", set: () => "escalated" };
  // @cast-boundary test stub — applyMemberResolutionReadOnly only spreads and wraps redis.
  const ctx = { redis, jobRunner: { handleEvent: () => "ran" } } as unknown as HandlerContext;
  return applyMemberResolutionReadOnly(ctx) as unknown as Record<string, unknown>;
}

function surface(readOnly: Record<string, unknown>, key: string): unknown {
  return readOnly[key];
}

describe("applyMemberResolutionReadOnly", () => {
  test("drops every surface that could reach an unchecked system-scope db", () => {
    const readOnly = readOnlyContext();

    for (const key of DROPPED_SURFACES) {
      expect(surface(readOnly, key)).toBeUndefined();
    }
    expect(Reflect.get(readOnly["db"] as object, "outsideTransaction")).toBeUndefined();
  });

  test.each([...DENIED_CALLS, ["", "notify"] as const])(
    "%s.%s rejects with the member-resolution reason",
    async (namespace, member) => {
      const owner = namespace === "" ? readOnlyContext() : surface(readOnlyContext(), namespace);
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

  test("scheduleAfterCommit, scheduleAfterRollback and the jobRunner proxy throw synchronously", () => {
    const readOnly = readOnlyContext();
    // @cast-boundary test stub — sync surfaces, not promise-returning.
    const schedulers = ["scheduleAfterCommit", "scheduleAfterRollback"].map(
      (key) => surface(readOnly, key) as () => void,
    );
    // @cast-boundary test stub — denyingJobRunnerProxy throws on any property read.
    const jobRunner = surface(readOnly, "jobRunner") as { handleEvent: unknown };

    for (const schedule of schedulers) expect(() => schedule()).toThrow(AccessDeniedError);
    expect(() => jobRunner.handleEvent).toThrow(AccessDeniedError);
  });

  test("allowlisted proxies stay awaitable and inspectable but deny other reads", async () => {
    const readOnly = readOnlyContextWithRedis();
    const redis = readOnly["redis"] as object;

    expect(Reflect.get(redis, "then")).toBeUndefined();
    expect(Reflect.get(redis, Symbol.toPrimitive)).toBeUndefined();
    expect(await Promise.resolve(redis)).toBe(redis);
    expect(() => Reflect.get(redis, "set")).toThrow(AccessDeniedError);
    expect(typeof Reflect.get(redis, "get")).toBe("function");
  });
});
