import { beforeEach, describe, expect, it, mock } from "bun:test";
import { getStep } from "../define-step";
import {
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
} from "../steps/_step-dispatch-constants";
import { buildWebhookSendStep } from "../steps/webhook-send";
import type { PipelineCtx } from "../types/step";

const mockUnsafeAppendEvent = mock();

const mockCtx = {
  unsafeAppendEvent: mockUnsafeAppendEvent,
  event: { type: "test", payload: { url: "https://hooks.example/test" } },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildWebhookSendStep", () => {
  it("returns a StepInstance with kind webhook.send", () => {
    const step = buildWebhookSendStep({
      url: "https://hooks.example/test",
      mode: "deferred",
    });
    expect(step.kind).toBe("webhook.send");
  });

  it("requires mode to be deferred", () => {
    const step = buildWebhookSendStep({
      url: "https://hooks.example/test",
      mode: "deferred",
    });
    expect((step.args as { mode: string }).mode).toBe("deferred");
  });

  it("accepts optional method, headers, body, auth, retry", () => {
    const step = buildWebhookSendStep({
      url: "https://hooks.example/test",
      method: "PUT",
      headers: { "X-Custom": "val" },
      body: { event: "test" },
      auth: { kind: "bearer", secretRef: "MY_SECRET" },
      retry: { times: 5, backoff: "linear" },
      mode: "deferred",
    });
    expect((step.args as { method: string }).method).toBe("PUT");
    expect((step.args as { retry: { times: number } }).retry.times).toBe(5);
  });
});

describe("webhook.send run", () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it("appends a step.dispatch-requested system event with the webhook spec", async () => {
    const stepDef = getStep("webhook.send");
    expect(stepDef).toBeDefined();

    await stepDef!.run(
      {
        url: "https://hooks.example/test",
        mode: "deferred",
        method: "POST",
        body: { event: "incident-opened", id: "abc" },
      },
      mockCtx,
    );

    expect(mockUnsafeAppendEvent).toHaveBeenCalledOnce();
    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];

    expect(eventArg.aggregateType).toBe(STEP_DISPATCH_AGGREGATE_TYPE);
    expect(eventArg.type).toBe(STEP_DISPATCH_REQUESTED_TYPE);
    expect(eventArg.payload.stepKind).toBe("webhook.send");
    expect(eventArg.payload.spec.url).toBe("https://hooks.example/test");
    expect(eventArg.payload.spec.body).toEqual({ event: "incident-opened", id: "abc" });
  });

  it("resolves function-based url and body resolvers", async () => {
    const stepDef = getStep("webhook.send");
    const urlFn = mock(() => "https://hooks.example/dynamic");
    const bodyFn = mock(() => ({ key: "value" }));

    await stepDef!.run(
      {
        url: urlFn,
        mode: "deferred",
        body: bodyFn,
      },
      mockCtx,
    );

    expect(urlFn).toHaveBeenCalledWith(mockCtx);
    expect(bodyFn).toHaveBeenCalledWith(mockCtx);
    expect(mockUnsafeAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          spec: expect.objectContaining({
            url: "https://hooks.example/dynamic",
            body: { key: "value" },
          }),
        }),
      }),
    );
  });

  it("defaults method to POST when not specified", async () => {
    const stepDef = getStep("webhook.send");

    await stepDef!.run({ url: "https://hooks.example/test", mode: "deferred" }, mockCtx);

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.payload.spec.method).toBe("POST");
  });

  it("defaults retry to 3x exponential when not specified", async () => {
    const stepDef = getStep("webhook.send");

    await stepDef!.run({ url: "https://hooks.example/test", mode: "deferred" }, mockCtx);

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.payload.retry).toEqual({ times: 3, backoff: "exponential" });
  });

  it("passes auth config through when provided", async () => {
    const stepDef = getStep("webhook.send");
    const auth = { kind: "bearer" as const, secretRef: "WEBHOOK_TOKEN" };

    await stepDef!.run({ url: "https://hooks.example/secured", mode: "deferred", auth }, mockCtx);

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.payload.spec.auth).toEqual(auth);
  });
});
