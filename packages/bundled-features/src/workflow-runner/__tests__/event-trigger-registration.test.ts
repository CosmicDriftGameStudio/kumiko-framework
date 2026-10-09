import { describe, expect, test } from "bun:test";
import {
  defineFeature,
  defineWorkflow,
  type StepInstance,
  stepsPipeline,
  type WorkflowDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { registerEventTrigger } from "../event-trigger.js";

function eventWorkflow(
  name: string,
  buildSteps: (r: Parameters<Parameters<typeof stepsPipeline>[0]>[0]["r"]) => StepInstance[],
): WorkflowDefinition {
  return defineWorkflow({
    name,
    trigger: { kind: "event", eventType: `${name}.fired` },
    steps: stepsPipeline(({ r }) => buildSteps(r)),
  });
}

function register(workflow: WorkflowDefinition): void {
  defineFeature(`${workflow.name}-feature`, (r) => {
    registerEventTrigger(r, workflow);
  });
}

describe("registerEventTrigger step validation", () => {
  test("accepts the step vocabulary the MSP apply context can drive", () => {
    const workflow = eventWorkflow("reg-ok", (r) => [
      r.step.compute("x", () => 1),
      r.step.wait({ for: "PT1H" }),
      r.step.retry({ times: 2, backoff: "linear", do: [r.step.compute("y", () => 2)] }),
      r.step.return({ isSuccess: true, data: undefined }),
    ]);

    expect(() => register(workflow)).not.toThrow();
  });

  test("rejects an unknown step kind at registration", () => {
    const workflow = eventWorkflow("reg-unknown", () => [
      { kind: "does.not.exist", args: {} },
    ]);

    expect(() => register(workflow)).toThrow(/unknown step kind "does\.not\.exist"/);
  });

  test("rejects a step that needs a handler context, also when nested in a sub-list", () => {
    const workflow = eventWorkflow("reg-unsupported", (r) => [
      r.step.retry({
        times: 2,
        backoff: "linear",
        do: [r.step.callFeature("other:write:thing", { handler: "other:write:thing", payload: {} })],
      }),
    ]);

    expect(() => register(workflow)).toThrow(/uses step "callFeature"/);
  });

  test("a closure that reads the event payload at build time fails loudly", () => {
    const workflow = defineWorkflow({
      name: "reg-payload-read",
      trigger: { kind: "event", eventType: "reg-payload-read.fired" },
      steps: stepsPipeline(({ event, r }) => {
        const mustExist = (event.payload as { nested: { value: number } }).nested.value;
        return [r.step.compute("x", () => mustExist)];
      }),
    });

    expect(() => register(workflow)).toThrow(/closure threw at registration/);
  });
});
