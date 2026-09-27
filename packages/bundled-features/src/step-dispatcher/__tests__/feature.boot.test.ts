import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createSecretsFeature } from "../../secrets";
import { createStepDispatcherFeature } from "../feature";

describe("step-dispatcher (fw#2068)", () => {
  test("does not declare systemScope — no handler reads ctx.db/ctx.systemDb", () => {
    expect(createStepDispatcherFeature().systemScope).toBeFalsy();
  });

  test("boot-validates alongside the secrets feature it requires", () => {
    expect(() =>
      validateBoot([createStepDispatcherFeature(), createSecretsFeature()]),
    ).not.toThrow();
  });

  test("boot-validation rejects step-dispatcher without secrets mounted", () => {
    expect(() => validateBoot([createStepDispatcherFeature()])).toThrow(/secrets/);
  });
});
