import { describe, expect, test } from "bun:test";
import {
  createTenantDb,
  createUncheckedSystemDb,
  type DbRunner,
} from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/stack";
import { requireSystemDb } from "../feature";

// requireSystemDb only reads ctx.systemDb, so a partial HandlerContext is
// enough to exercise it without constructing a full dispatcher context.
function fakeCtx(systemDb: HandlerContext["systemDb"]): HandlerContext {
  return { systemDb } as unknown as HandlerContext;
}

function unusedRunner(): DbRunner {
  return {
    unsafe: async () => {
      throw new Error("requireSystemDb tests must not reach the DB");
    },
    begin: async () => {
      throw new Error("requireSystemDb tests must not reach the DB");
    },
  } as DbRunner;
}

describe("requireSystemDb", () => {
  test("throws InternalError naming the handler when ctx.systemDb is missing", () => {
    expect(() => requireSystemDb(fakeCtx(undefined), "config:write:set")).toThrow(
      /config:write:set.*ctx\.systemDb missing/,
    );
  });

  test("returns ctx.systemDb unchanged when present", () => {
    const tenantId = testTenantId(1);
    const systemDb = createUncheckedSystemDb(createTenantDb(unusedRunner(), tenantId, "system"));

    expect(requireSystemDb(fakeCtx(systemDb), "config:write:reset")).toBe(systemDb);
  });
});
