import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { BootRuleViolation } from "../boot-validator/boot-rule.ts";
import { defineFeature } from "../define-feature.ts";
import { collectDefinitionViolations } from "../definition-violations.ts";

const badNav = { id: "Bad_Id", label: "Home", screen: "demo:screen:home" };

describe("collectDefinitionViolations", () => {
  test("collects every violation of every feature in one load", async () => {
    const { violations, outcome } = await collectDefinitionViolations(async () => {
      defineFeature("alpha", (r) => {
        r.nav(badNav);
        r.describe("one");
        r.describe("two");
      });
      defineFeature("beta", (r) => {
        r.nav(badNav);
      });
      return "done";
    });
    expect(outcome).toEqual({ loaded: true, value: "done" });
    expect(violations.map((v) => [v.ruleId, v.feature, v.check])).toEqual([
      ["nav/id-not-kebab", "alpha", "r.nav"],
      ["feature/describe-twice", "alpha", "r.describe"],
      ["nav/id-not-kebab", "beta", "r.nav"],
    ]);
    expect(violations[0]?.fix).toBeDefined();
  });

  test("a failed value-returning method does not add its follow-up TypeError", async () => {
    const { violations, outcome } = await collectDefinitionViolations(async () => {
      defineFeature("alpha", (r) => {
        r.describe("one");
        r.describe("two");
        const event = r.defineEvent("ping", z.object({}), { piiFields: {} });
        return event.name.length;
      });
    });
    expect(outcome.loaded).toBe(true);
    expect(violations.map((v) => v.ruleId)).toEqual([
      "feature/describe-twice",
      "event/pii-stance-empty",
    ]);
  });

  test("a crash without an earlier violation is rethrown", async () => {
    const { violations, outcome } = await collectDefinitionViolations(async () => {
      defineFeature("alpha", () => {
        throw new TypeError("bug in feature code");
      });
    });
    expect(violations).toHaveLength(0);
    expect(outcome.loaded).toBe(false);
    expect(!outcome.loaded && outcome.thrown).toBeInstanceOf(TypeError);
  });

  test("the collector is reset after a throw, so defineFeature throws immediately again", async () => {
    await collectDefinitionViolations(async () => {
      throw new Error("load failed");
    });
    let thrown: unknown;
    try {
      defineFeature("alpha", (r) => {
        r.describe("one");
        r.describe("two");
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BootRuleViolation);
  });
});
