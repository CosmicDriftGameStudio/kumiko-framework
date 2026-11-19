import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { defineQueryHandler, defineWriteHandler } from "../../define-handler.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { BootRuleViolation, BootValidationError } from "../boot-rule.ts";
import { validateHandlerSystemScope } from "../handler-system-scope.ts";

const RULE_ID = "handler/system-scope-without-feature-system-scope";
const schema = z.object({});
const access = { roles: ["SystemAdmin"] };

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw");
}

function ruleIdOfThrown(fn: () => void): string {
  const error = thrownBy(fn);
  if (error instanceof BootRuleViolation) return error.rule.id;
  throw error;
}

function ruleIdsOf(fn: () => void): readonly string[] {
  const error = thrownBy(fn);
  if (error instanceof BootValidationError) return error.violations.map((v) => v.ruleId);
  throw error;
}

function queryFeature(options: {
  readonly featureScope: boolean;
  readonly marker: boolean;
}): FeatureDefinition {
  return defineFeature("scopeProbeQuery", (r) => {
    if (options.featureScope) r.systemScope();
    const handler = async () => ({});
    r.queryHandler(
      options.marker
        ? defineQueryHandler({ name: "probe", schema, access, systemScope: true, handler })
        : defineQueryHandler({ name: "probe", schema, access, handler }),
    );
  });
}

function writeFeature(): FeatureDefinition {
  return defineFeature("scopeProbeWrite", (r) => {
    r.writeHandler(
      defineWriteHandler({
        name: "probe",
        schema,
        access,
        systemScope: true,
        handler: async () => ({ isSuccess: true as const, data: {} }),
      }),
    );
  });
}

describe("handler systemScope marker", () => {
  test("a query handler with the marker in a feature without r.systemScope() is rejected", () => {
    const feature = queryFeature({ featureScope: false, marker: true });
    expect(ruleIdsOf(() => validateBoot([feature]))).toContain(RULE_ID);
  });

  test("a write handler with the marker in a feature without r.systemScope() is rejected", () => {
    expect(ruleIdsOf(() => validateBoot([writeFeature()]))).toContain(RULE_ID);
    expect(ruleIdOfThrown(() => validateHandlerSystemScope(writeFeature()))).toBe(RULE_ID);
  });

  test("the marker in an r.systemScope() feature is accepted", () => {
    const feature = queryFeature({ featureScope: true, marker: true });
    expect(() => validateBoot([feature])).not.toThrow();
    expect(() => validateHandlerSystemScope(feature)).not.toThrow();
  });

  test("no marker in a feature without r.systemScope() is accepted", () => {
    const feature = queryFeature({ featureScope: false, marker: false });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
