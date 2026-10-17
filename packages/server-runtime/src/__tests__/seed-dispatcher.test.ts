import { describe, expect, test } from "bun:test";
import {
  createSystemUser,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { Dispatcher } from "@cosmicdrift/kumiko-framework/pipeline";
import { withSeedErrorContext } from "../seed-dispatcher.js";

const user = createSystemUser("00000000-0000-4000-8000-000000000001" as TenantId);

function dispatcherReturning(result: WriteResult): Pick<Dispatcher, "write"> {
  return { write: async () => result };
}

describe("withSeedErrorContext", () => {
  test("adds handler name and cause message to a masked internal error", async () => {
    const dispatcher = withSeedErrorContext(
      dispatcherReturning(writeFailure(new InternalError({ cause: new Error("boom in seed") }))),
    );
    const result = await dispatcher.write("probe:write:explode", {}, user);
    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) return;
    expect(result.error.code).toBe("internal_error");
    expect(result.error.message).toBe("internal error (probe:write:explode: boom in seed)");
  });

  test("leaves typed errors untouched", async () => {
    const typed = writeFailure(new NotFoundError("thing", "1"));
    const dispatcher = withSeedErrorContext(dispatcherReturning(typed));
    expect(await dispatcher.write("probe:write:x", {}, user)).toBe(typed);
  });

  test("leaves successes untouched", async () => {
    const ok = { isSuccess: true as const, data: undefined };
    const dispatcher = withSeedErrorContext(dispatcherReturning(ok));
    expect(await dispatcher.write("probe:write:x", {}, user)).toBe(ok);
  });
});
