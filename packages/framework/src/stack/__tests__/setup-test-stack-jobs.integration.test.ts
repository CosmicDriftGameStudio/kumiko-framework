// Regression test for #983 — a write handler calling `ctx["jobRunner"]
// .dispatch(...)` directly (the documented pattern, e.g. bundled jobs
// feature's trigger.write.ts) threw `TypeError: undefined is not an
// object` under both `setupTestStack` and `runDevApp`, because neither
// built a JobRunner nor merged one into the dispatcher's context.
//
// Two things had to be fixed together (see dispatch-shared.ts and
// test-stack.ts for the respective commits):
//   1. `setupTestStack({ jobs: {...} })` now builds a real JobRunner and
//      merges it into dispatcherOptions — this test's `jobs: {}` opt-in.
//   2. `buildHandlerContext` (packages/framework/src/pipeline/dispatch-
//      shared.ts) never spread `DispatchContext.jobRunner` into the
//      handler-facing ctx at all — a gap that predates this issue and
//      affects the prod entrypoint too, not just dev/test. Fixed there,
//      not band-aided into `context:` here — otherwise test/dev would
//      pass while prod's `ctx.jobRunner` stayed undefined.
//
// This test drives the manual-dispatch repro from the issue, not the
// auto-trigger path (already covered by entrypoint-job-wiring.integration
// .test.ts) — the two paths read from different context slots and a fix
// for one doesn't guarantee the other.

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
      jobs: {},
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
