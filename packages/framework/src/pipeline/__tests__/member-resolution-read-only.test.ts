// createUncheckedSystemDb's grantedUnsafeRawRunner (db/tenant-db.ts) hands out a
// raw runner without a grant check. Under a resolved member principal that door
// is closed only because applyMemberResolutionReadOnly drops systemDb and
// dbOutsideTransaction — this pins that, plus the write surfaces it neutralizes.
import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "../../engine/types";
import { AccessDeniedError, FrameworkReasons } from "../../errors";
import { applyMemberResolutionReadOnly } from "../dispatch-shared";

const DROPPED_SURFACES = ["systemDb", "dbOutsideTransaction", "runPreSave", "files", "derivatives"];

const DENIED_CALLS = [
  "write",
  "writeAs",
  "queryAs",
  "appendEvent",
  "unsafeAppendEvent",
  "tryAppendEvent",
  "fetchForWriting",
  "archiveStream",
  "restoreStream",
  "snapshotAggregate",
  "queryAsMember",
  "resolveActiveMembership",
  "notify",
];

function readOnlyContext(): Record<string, unknown> {
  const wired = Object.fromEntries(
    [...DROPPED_SURFACES, ...DENIED_CALLS, "scheduleAfterCommit"].map((key) => [
      key,
      () => "escalated",
    ]),
  );
  // @cast-boundary test stub — applyMemberResolutionReadOnly only spreads and overwrites.
  const ctx = { ...wired, jobRunner: { handleEvent: () => "ran" } } as unknown as HandlerContext;
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
  });

  test.each(DENIED_CALLS)("%s rejects with the member-resolution reason", async (call) => {
    // @cast-boundary test stub — every denied surface is a call returning a promise.
    const denied = surface(readOnlyContext(), call) as () => Promise<unknown>;

    const error = await denied().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(AccessDeniedError);
    // @cast-boundary narrowed by the assertion above.
    expect((error as AccessDeniedError).details).toMatchObject({
      reason: FrameworkReasons.memberResolutionReadOnly,
    });
  });

  test("scheduleAfterCommit and the jobRunner proxy throw synchronously", () => {
    const readOnly = readOnlyContext();
    // @cast-boundary test stub — sync surfaces, not promise-returning.
    const scheduleAfterCommit = surface(readOnly, "scheduleAfterCommit") as () => void;
    // @cast-boundary test stub — denyingJobRunnerProxy throws on any property read.
    const jobRunner = surface(readOnly, "jobRunner") as { handleEvent: unknown };

    expect(() => scheduleAfterCommit()).toThrow(AccessDeniedError);
    expect(() => jobRunner.handleEvent).toThrow(AccessDeniedError);
  });
});
