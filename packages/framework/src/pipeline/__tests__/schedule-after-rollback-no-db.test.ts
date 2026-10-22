// Without a DB connection the batch runs sequentially with no transaction; a failed command must
// still give its ctx.scheduleAfterRollback callbacks a chance to run.
import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import { UnprocessableError, writeFailure } from "../../errors/index.ts";
import { createTestUser } from "../../seeding/seed-users.ts";
import { createDispatcher } from "../dispatcher.ts";

const rolledBackLabels: string[] = [];

const feature = defineFeature("nodb", (r) => {
  r.writeHandler({
    name: "ok",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => {
      ctx.scheduleAfterRollback?.(async () => {
        rolledBackLabels.push(event.payload.label);
      });
      return { isSuccess: true, data: {} };
    },
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "fail",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => {
      ctx.scheduleAfterRollback?.(async () => {
        rolledBackLabels.push(event.payload.label);
      });
      return writeFailure(new UnprocessableError("handler_rejected"));
    },
    access: { roles: ["Admin"] },
  });
});

function dispatcherWithoutDb() {
  return createDispatcher(createRegistry([feature]), {});
}

describe("ctx.scheduleAfterRollback without a transaction", () => {
  test("runs exactly once when the command fails", async () => {
    rolledBackLabels.length = 0;
    const result = await dispatcherWithoutDb().write(
      "nodb:write:fail",
      { label: "f1" },
      createTestUser(),
    );

    expect(result.isSuccess).toBe(false);
    expect(rolledBackLabels).toEqual(["f1"]);
  });

  test("does not run when the command succeeds", async () => {
    rolledBackLabels.length = 0;
    const result = await dispatcherWithoutDb().write(
      "nodb:write:ok",
      { label: "s1" },
      createTestUser(),
    );

    expect(result).toEqual({ isSuccess: true, data: {} });
    expect(rolledBackLabels).toEqual([]);
  });
});
