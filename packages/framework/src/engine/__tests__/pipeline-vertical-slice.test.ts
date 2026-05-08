// M.1.1 vertical-slice test — proves the pipeline form compiles to a
// callable handler that produces a WriteResult.
//
// Scope: defineWriteHandler({ perform: pipeline(...) }) → handler(event, ctx)
//        runs through the pipeline-runner, executes a single
//        r.step.return, and lands the resolver's WriteResult on the
//        caller. Dispatcher integration is exercised by
//        pipeline-handler.integration.ts (real Postgres + JWT + HTTP).

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineStep } from "../define-step";
import { defineWriteHandler } from "../define-handler";
import { pipeline } from "../pipeline";
import { TestUsers } from "../../stack";
import type { HandlerContext, WriteEvent } from "../types/handlers";

function buildMinimalCtx(): HandlerContext {
  // The return-step doesn't read any ctx field — the runner needs an
  // object-shaped ctx but no surface beyond that. Real-ctx integration
  // is the job of pipeline-handler.integration.ts.
  return {} as HandlerContext;
}

describe("pipeline (M.1.1 vertical slice)", () => {
  it("compiles a perform-block into a callable handler that returns the resolver's WriteResult", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:noop",
      schema: z.object({ greeting: z.string() }),
      access: { roles: ["User"] },
      perform: pipeline<{ greeting: string }, { echoed: string }>(({ event, r }) => [
        r.step.return(() => ({
          isSuccess: true as const,
          data: { echoed: event.payload.greeting },
        })),
      ]),
    });

    expect(typeof handlerDef.handler).toBe("function");
    expect(handlerDef.perform).toBeDefined();
    expect(handlerDef.perform?.__kind).toBe("pipeline");

    const event: WriteEvent<{ greeting: string }> = {
      type: "demo:noop",
      payload: { greeting: "hello" },
      user: TestUsers.admin,
    };

    const result = await handlerDef.handler(event, buildMinimalCtx());
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ echoed: "hello" });
    }
  });

  it("supports a static (non-resolver) WriteResult passed to r.step.return", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:static",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { ok: boolean }>(({ r }) => [
        r.step.return({ isSuccess: true as const, data: { ok: true } }),
      ]),
    });

    const result = await handlerDef.handler(
      { type: "demo:static", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(result).toEqual({ isSuccess: true, data: { ok: true } });
  });

  it("preserves the free-form handler path unchanged", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:freeform",
      schema: z.object({ n: z.number() }),
      access: { roles: ["User"] },
      handler: async (event) => ({ isSuccess: true as const, data: { doubled: event.payload.n * 2 } }),
    });

    expect(handlerDef.perform).toBeUndefined();

    const result = await handlerDef.handler(
      { type: "demo:freeform", payload: { n: 21 }, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ doubled: 42 });
    }
  });

  it("surfaces an explicit error when a pipeline ends without r.step.return", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:no-return",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, never>(() => []),
    });

    await expect(
      handlerDef.handler(
        { type: "demo:no-return", payload: {}, user: TestUsers.admin },
        buildMinimalCtx(),
      ),
    ).rejects.toThrow(/r\.step\.return/);
  });

  it("rejects a step with an unknown kind at runtime", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:unknown-kind",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, never>(() => [
        // Hand-crafted instance with a kind that's never been registered —
        // simulates a typo in a future step-builder factory.
        { kind: "this-step-does-not-exist", args: {} },
      ]),
    });

    await expect(
      handlerDef.handler(
        { type: "demo:unknown-kind", payload: {}, user: TestUsers.admin },
        buildMinimalCtx(),
      ),
    ).rejects.toThrow(/Unknown step kind "this-step-does-not-exist"/);
  });

  it("defineStep throws when the same kind is registered with a different definition", () => {
    // Unique-per-run kind so this test is safe under vitest --watch
    // (where the file may re-execute in the same process). Without the
    // unique-kind, the first defineStep call on the second run would
    // already throw against the registration left from the first run.
    const kind = `test-only:duplicate-guard:${randomUUID()}`;

    defineStep({ kind, defaultFailureStrategy: "throw", run: () => undefined });

    expect(() =>
      defineStep({ kind, defaultFailureStrategy: "throw", run: () => "different" }),
    ).toThrow(/already registered/);
  });
});
