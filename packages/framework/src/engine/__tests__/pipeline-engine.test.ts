// Pipeline-engine unit tests — defineWriteHandler({ perform: pipeline(...) })
// boundary, run-pipeline runner contract, defineStep registry guards.
// Sub-step-builders (branch, forEach) live in pipeline-sub-pipelines.test.ts;
// boot-validator in validate-projection-allowlist.test.ts.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { TestUsers } from "../../stack";
import { defineWriteHandler } from "../define-handler";
import { defineStep } from "../define-step";
import { pipeline } from "../pipeline";
import type { WriteEvent } from "../types/handlers";
import { buildMinimalCtx } from "./_pipeline-test-utils";

describe("pipeline engine (return / compute / registry guards)", () => {
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
      handler: async (event) => ({
        isSuccess: true as const,
        data: { doubled: event.payload.n * 2 },
      }),
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

  it("threads compute results into subsequent step resolvers via steps.<name>", async () => {
    const handlerDef = defineWriteHandler({
      name: "demo:thread",
      schema: z.object({ base: z.number() }),
      access: { roles: ["User"] },
      perform: pipeline<{ base: number }, { sum: number }>(({ event, r }) => [
        r.step.compute("offset", () => 10),
        r.step.compute("doubledBase", () => event.payload.base * 2),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: {
            sum: (steps["offset"] as number) + (steps["doubledBase"] as number),
          },
        })),
      ]),
    });

    const result = await handlerDef.handler(
      { type: "demo:thread", payload: { base: 5 }, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.data).toEqual({ sum: 20 });
    }
  });

  it("re-evaluates compute resolvers per pipeline run (not at build time)", async () => {
    let counter = 0;
    const handlerDef = defineWriteHandler({
      name: "demo:fresh",
      schema: z.object({}),
      access: { roles: ["User"] },
      perform: pipeline<Record<string, never>, { tick: number }>(({ r }) => [
        r.step.compute("tick", () => ++counter),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: { tick: steps["tick"] as number },
        })),
      ]),
    });

    const a = await handlerDef.handler(
      { type: "demo:fresh", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    const b = await handlerDef.handler(
      { type: "demo:fresh", payload: {}, user: TestUsers.admin },
      buildMinimalCtx(),
    );
    if (a.isSuccess && b.isSuccess) {
      expect(a.data.tick).toBe(1);
      expect(b.data.tick).toBe(2);
    }
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

  it("defineWriteHandler throws a clear runtime error when both handler+perform are set (#3)", () => {
    // Type-system rejects this via discriminated union (handler?: never /
    // perform?: never), but the error message ('Type X not assignable to
    // undefined') is opaque. The runtime guard fires regardless of how
    // the type-error was bypassed (any-cast, generated code, JS-call) and
    // names BOTH fields explicitly.
    // Deliberately bypass the discriminated union via `as never` so the
    // runtime guard is what's under test (the type-system path already
    // rejects the conflict).
    const conflictingDef = {
      name: "demo:both",
      schema: z.object({}),
      access: { roles: ["User"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
      perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
        r.step.return({ isSuccess: true as const, data: { ok: true } }),
      ]),
    } as unknown as Parameters<typeof defineWriteHandler>[0];
    expect(() => defineWriteHandler(conflictingDef)).toThrow(
      /both `handler` and `perform` are set/,
    );
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
