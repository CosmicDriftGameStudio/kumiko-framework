import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createStepDispatcherFeature } from "../feature";

describe("step-dispatcher (fw#2068)", () => {
  test("does not declare systemScope — no handler reads ctx.db/ctx.systemDb", () => {
    expect(createStepDispatcherFeature().systemScope).toBeFalsy();
  });

  test("boot-validates standalone", () => {
    expect(() => validateBoot([createStepDispatcherFeature()])).not.toThrow();
  });
});
