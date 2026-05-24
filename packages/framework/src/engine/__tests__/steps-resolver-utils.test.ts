import { describe, expect, it, mock } from "bun:test";
import { resolveOptional, resolveRequired } from "../steps/_resolver-utils";
import type { PipelineCtx } from "../types/step";

const dummyCtx = {} as unknown as PipelineCtx;

describe("resolveRequired", () => {
  it("returns a static value as-is", () => {
    expect(resolveRequired("hello", dummyCtx)).toBe("hello");
    expect(resolveRequired(42, dummyCtx)).toBe(42);
    expect(resolveRequired(null, dummyCtx)).toBeNull();
    expect(resolveRequired({ key: "val" }, dummyCtx)).toEqual({ key: "val" });
  });

  it("calls a function resolver with the ctx and returns its result", () => {
    const fn = mock((_ctx: PipelineCtx) => "from-fn");
    expect(resolveRequired(fn, dummyCtx)).toBe("from-fn");
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(dummyCtx);
  });

  it("passes the full ctx to the resolver function", () => {
    const ctx = { event: { type: "test" }, steps: { x: 1 }, scope: {} } as unknown as PipelineCtx;
    const fn = mock((c: PipelineCtx) => c.event.type);
    expect(resolveRequired(fn, ctx)).toBe("test");
  });
});

describe("resolveOptional", () => {
  it("returns the static value when defined", () => {
    expect(resolveOptional("hello", dummyCtx)).toBe("hello");
    expect(resolveOptional(0, dummyCtx)).toBe(0);
    expect(resolveOptional(false, dummyCtx)).toBe(false);
    expect(resolveOptional("", dummyCtx)).toBe("");
  });

  it("returns undefined when arg is undefined", () => {
    expect(resolveOptional(undefined, dummyCtx)).toBeUndefined();
  });

  it("calls a function resolver when defined", () => {
    const fn = mock(() => "resolved");
    expect(resolveOptional(fn, dummyCtx)).toBe("resolved");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("returns undefined for undefined function resolver", () => {
    expect(resolveOptional(undefined, dummyCtx)).toBeUndefined();
  });
});
