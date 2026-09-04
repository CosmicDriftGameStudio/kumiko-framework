import { describe, expect, test } from "bun:test";
import {
  computeDefinitionFingerprint,
  defineWorkflow,
  type WorkflowTrigger,
} from "../define-workflow";
import { stepsPipeline } from "../pipeline";
import type { PipelineDef } from "../types/step";

const pipe = (build: PipelineDef["build"]): PipelineDef => ({ __kind: "pipeline", build });
const eventTrigger: WorkflowTrigger = { kind: "event", eventType: "user.signed-up" };

describe("defineWorkflow", () => {
  test("maps input into a WorkflowDefinition", () => {
    const steps = pipe(() => []);
    const wf = defineWorkflow({ name: "onboard", trigger: eventTrigger, steps });

    expect(wf.__kind).toBe("workflow");
    expect(wf.name).toBe("onboard");
    expect(wf.trigger).toEqual(eventTrigger);
    // pipelineDef is no longer `steps` by reference — defineWorkflow rebuilds
    // it to carry the (possibly absent) branded awaits map — but the
    // closure itself must be the exact same function.
    expect(wf.pipelineDef.__kind).toBe("pipeline");
    expect(wf.pipelineDef.build).toBe(steps.build);
    expect(wf.awaits).toBeUndefined();
    expect(wf.pipelineDef.awaits).toBeUndefined();
  });

  test("brands the declared awaits map onto both the definition and the pipelineDef", () => {
    const wf = defineWorkflow({
      name: "order-fulfillment",
      trigger: eventTrigger,
      awaits: { shipped: "order.shipped", cancelled: "order.cancelled" },
      steps: stepsPipeline(() => []),
    });

    expect(wf.awaits).toEqual({ shipped: "order.shipped", cancelled: "order.cancelled" });
    expect(wf.pipelineDef.awaits).toEqual({
      shipped: "order.shipped",
      cancelled: "order.cancelled",
    });
  });
});

describe("computeDefinitionFingerprint", () => {
  const base = { name: "wf", trigger: eventTrigger, pipelineDef: pipe(() => []) };

  test("is deterministic and a sha256 hex digest", () => {
    const a = computeDefinitionFingerprint(base);
    const b = computeDefinitionFingerprint({ ...base, pipelineDef: pipe(() => []) });

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  test("changes when the closure source changes — the in-flight drift detector", () => {
    const before = computeDefinitionFingerprint(base);
    // runtime-distinct body (`as never` + comments are stripped by the
    // transpiler, so the difference must survive into emitted source).
    const after = computeDefinitionFingerprint({
      ...base,
      pipelineDef: pipe(() => [{} as never]),
    });

    expect(after).not.toBe(before);
  });

  test("changes when name or trigger changes", () => {
    const fp = computeDefinitionFingerprint(base);
    expect(computeDefinitionFingerprint({ ...base, name: "other" })).not.toBe(fp);
    expect(
      computeDefinitionFingerprint({
        ...base,
        trigger: { kind: "cron", schedule: "0 0 * * *" },
      }),
    ).not.toBe(fp);
  });
});
