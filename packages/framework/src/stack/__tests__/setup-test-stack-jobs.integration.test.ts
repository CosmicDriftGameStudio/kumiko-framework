// Drives the manual `ctx.jobRunner.dispatch(...)` path a write handler
// uses directly — distinct from the auto-trigger path covered by
// entrypoint-job-wiring.integration.test.ts, which reads a different
// context slot and isn't guaranteed by this test passing.

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../engine";
import { InternalError, writeFailure } from "../../errors";
import { waitFor } from "../../testing";
import { setupTestStack, type TestStack } from "../test-stack";
import { TestUsers } from "../test-users";

const jobRuns: Array<{ name: string; payload: Record<string, unknown> }> = [];

const manualDispatchFeature = defineFeature("manualdispatch", (r) => {
  r.writeHandler(
    "create",
    z.object({ note: z.string() }),
    async (event, ctx) => {
      // Exact repro from #983: bracket-access, dynamic context extension —
      // not a typed HandlerContext field (mirrors trigger.write.ts).
      const jobRunner = ctx["jobRunner"] as
        | { dispatch: (name: string, payload: Record<string, unknown>) => Promise<string> }
        | undefined;
      if (!jobRunner) {
        return writeFailure(new InternalError({ message: "no jobRunner on ctx" }));
      }
      await jobRunner.dispatch("manualdispatch:job:record", { note: event.payload.note });
      return { isSuccess: true as const, data: { id: 1, note: event.payload.note } };
    },
    { access: { openToAll: true } },
  );
  r.job("record", { trigger: { manual: true }, runIn: "worker" }, async (payload) => {
    jobRuns.push({ name: "manualdispatch:job:record", payload });
  });
});

// kumiko-framework#1232: setupTestStack used to hand jobs a bare
// `{ db, registry }` context literal — nothing else buildServer's request
// path gets (tracer/meter, searchAdapter, ...). A job could pass in tests
// while reading a field only prod's context has, then break silently on
// deploy. This job records which fields actually arrived.
const jobContextFields: Array<{
  hasTracer: boolean;
  hasSearchAdapter: boolean;
  hasEffectiveFeatures: boolean;
}> = [];

const jobContextFeature = defineFeature("jobcontextcheck", (r) => {
  r.job("record", { trigger: { manual: true }, runIn: "worker" }, async (_payload, context) => {
    jobContextFields.push({
      hasTracer: context.tracer !== undefined,
      hasSearchAdapter: context.searchAdapter !== undefined,
      hasEffectiveFeatures: context.effectiveFeatures !== undefined,
    });
  });
});

let stack: TestStack | undefined;

afterEach(async () => {
  if (stack) await stack.cleanup();
  stack = undefined;
});

describe("setupTestStack({ jobs }) wires ctx.jobRunner for manual dispatch", () => {
  test("write handler's ctx.jobRunner.dispatch(...) works end-to-end", async () => {
    jobRuns.length = 0;
    stack = await setupTestStack({
      features: [manualDispatchFeature],
      // consumerLane: this test has no separate consumer (unlike runDevApp's
      // startDevJobRunners), so it must be the one running the job.
      jobs: { consumerLane: "worker" },
    });

    await stack.http.writeOk("manualdispatch:write:create", { note: "hi" }, TestUsers.admin);

    await waitFor(() => {
      const run = jobRuns.find((e) => e.name === "manualdispatch:job:record");
      expect(run).toBeDefined();
      expect(run?.payload["note"]).toBe("hi");
    });
  });

  test("without `jobs` opt-in, ctx.jobRunner stays undefined (no-op, not a throw)", async () => {
    stack = await setupTestStack({ features: [manualDispatchFeature] });
    expect(stack.jobRunner).toBeUndefined();

    // The handler itself guards against a missing jobRunner (writeFailure,
    // not a thrown TypeError) — same contract as trigger.write.ts's cast.
    const err = await stack.http.writeErr(
      "manualdispatch:write:create",
      { note: "hi" },
      TestUsers.admin,
    );
    expect(err.code).toBe("internal_error");
  });
});

describe("setupTestStack({ jobs }) job context matches the request-path context", () => {
  test("job handler's context carries tracer + searchAdapter + effectiveFeatures, not a reduced literal", async () => {
    jobContextFields.length = 0;
    stack = await setupTestStack({
      features: [jobContextFeature],
      jobs: { consumerLane: "worker" },
      effectiveFeatures: () => new Set(["jobcontextcheck"]),
    });

    await stack.jobRunner?.dispatch("jobcontextcheck:job:record");

    await waitFor(() => {
      expect(jobContextFields.length).toBeGreaterThan(0);
    });
    expect(jobContextFields[0]).toEqual({
      hasTracer: true,
      hasSearchAdapter: true,
      hasEffectiveFeatures: true,
    });
  });
});
