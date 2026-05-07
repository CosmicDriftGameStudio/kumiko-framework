// M.1.1 vertical-slice test — proves the pipeline form compiles to a
// callable handler that produces a WriteResult.
//
// Scope: defineWriteHandler({ perform: pipeline(...) }) → handler(event, ctx)
//        runs through the pipeline-runner, executes a single
//        r.step.return, and lands the resolver's WriteResult on the
//        caller. Dispatcher integration is intentionally NOT covered here
//        — that lives in pipeline-handler-integration.integration.ts in
//        the next slice.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineWriteHandler } from "../define-handler";
import { pipeline } from "../pipeline";
import "../steps/return";
import { parseTenantId, SYSTEM_TENANT_ID } from "../types/identifiers";
import type { HandlerContext, SessionUser, WriteEvent } from "../types/handlers";

function buildSessionUser(): SessionUser {
  // Minimal SessionUser shape — system tenant + system role keep the
  // test independent of the auth feature's claim machinery.
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: parseTenantId(SYSTEM_TENANT_ID) ?? SYSTEM_TENANT_ID,
    roles: ["User"] as const,
  };
}

function buildMinimalCtx(): HandlerContext {
  // The return-step doesn't read any ctx field — we hand the runner a
  // minimal cast so we can exercise the compile-to-handler path without
  // standing up the full dispatcher. Real-ctx integration is the job of
  // the next test (pipeline-handler-integration.integration.ts).
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
      user: buildSessionUser(),
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
      { type: "demo:static", payload: {}, user: buildSessionUser() },
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
      { type: "demo:freeform", payload: { n: 21 }, user: buildSessionUser() },
      buildMinimalCtx(),
    );
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ doubled: 42 });
    }
  });

  it("surfaces an explicit error when a pipeline ends without r.step.return", async () => {
    // No-step pipelines should fail loudly — silent fallthrough would mask
    // the most common authoring mistake (forgotten r.step.return at the end).
    const handlerDef = defineWriteHandler({
      name: "demo:no-return",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, never>(() => []),
    });

    await expect(
      handlerDef.handler(
        { type: "demo:no-return", payload: {}, user: buildSessionUser() },
        buildMinimalCtx(),
      ),
    ).rejects.toThrow(/r\.step\.return/);
  });
});
