import { beforeEach, describe, expect, it } from "bun:test";
import { getStep } from "../define-step";
import { buildCallFeatureStep } from "../steps/call-feature";
import type { PipelineCtx } from "../types/step";

const mockWrite = mock();
const mockWriteAs = mock();

const mockCtx = {
  write: mockWrite,
  writeAs: mockWriteAs,
  event: { type: "test", payload: { title: "test" } },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildCallFeatureStep", () => {
  it("returns a StepInstance with kind callFeature", () => {
    const step = buildCallFeatureStep("inner", {
      handler: "other-feature:write:handler",
      payload: { key: "val" },
    });
    expect(step.kind).toBe("callFeature");
    expect((step.args as { name: string }).name).toBe("inner");
    expect((step.args as { handler: string }).handler).toBe("other-feature:write:handler");
  });

  it("stores the result key from the name arg", () => {
    const step = buildCallFeatureStep("myCall", {
      handler: "feat:write:h",
      payload: {},
    });
    const def = getStep("callFeature");
    expect(def?.resultKey?.(step.args as { name: string })).toBe("myCall");
  });
});

describe("callFeature run", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("calls ctx.write with the resolved payload and handler name", async () => {
    const stepDef = getStep("callFeature");
    mockWrite.mockResolvedValue({
      isSuccess: true,
      data: { id: "abc-123" },
    });

    const result = await stepDef!.run(
      {
        name: "inner",
        handler: "other-feature:write:handler",
        payload: { title: "hello" },
      },
      mockCtx,
    );

    expect(mockWrite).toHaveBeenCalledWith("other-feature:write:handler", {
      title: "hello",
    });
    expect(result).toEqual({ id: "abc-123" });
  });

  it("resolves a function payload resolver before calling ctx.write", async () => {
    const stepDef = getStep("callFeature");
    const payloadFn = mock((ctx: PipelineCtx) => ({
      title: (ctx.event.payload as { title: string }).title,
    }));
    mockWrite.mockResolvedValue({
      isSuccess: true,
      data: { id: "abc" },
    });

    await stepDef!.run({ name: "inner", handler: "feat:write:h", payload: payloadFn }, mockCtx);

    expect(payloadFn).toHaveBeenCalledWith(mockCtx);
    expect(mockWrite).toHaveBeenCalledWith("feat:write:h", { title: "test" });
  });

  it("calls ctx.writeAs when opts.as is provided", async () => {
    const stepDef = getStep("callFeature");
    const adminUser = { id: "admin-id", tenantId: "t1", roles: ["Admin"] };
    mockWriteAs.mockResolvedValue({
      isSuccess: true,
      data: { id: "abc" },
    });

    await stepDef!.run(
      {
        name: "inner",
        handler: "feat:write:h",
        payload: {},
        as: adminUser,
      },
      mockCtx,
    );

    expect(mockWriteAs).toHaveBeenCalledWith(adminUser, "feat:write:h", {});
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("preserves WriteFailure as error cause when the sub-handler returns failure", async () => {
    const stepDef = getStep("callFeature");
    const writeError = {
      code: "validation_error",
      message: "title is required",
      details: [{ path: ["title"], message: "required" }],
    };
    mockWrite.mockResolvedValue({
      isSuccess: false,
      error: writeError,
    });

    try {
      await stepDef!.run({ name: "inner", handler: "feat:write:h", payload: {} }, mockCtx);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/returned failure/);
      expect((err as Error & { cause?: unknown }).cause).toEqual(writeError);
    }
  });
});
