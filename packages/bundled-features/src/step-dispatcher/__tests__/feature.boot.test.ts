import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createSecretsFeature } from "../../secrets/index.js";
import { createStepDispatcherFeature } from "../feature.js";
import { WEBHOOK_AUTH_SECRET_KEY_PREFIX } from "../webhook-runner.js";

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

  // Stored webhook auth rows live under this exact prefix; a drift would orphan them.
  test("declares the webhook-auth secret namespace under WEBHOOK_AUTH_SECRET_KEY_PREFIX", () => {
    const namespaces = Object.values(createStepDispatcherFeature().secretNamespaces ?? {});
    expect(namespaces.map((namespace) => namespace.qualifiedPrefix)).toEqual([
      WEBHOOK_AUTH_SECRET_KEY_PREFIX,
    ]);
  });
});
