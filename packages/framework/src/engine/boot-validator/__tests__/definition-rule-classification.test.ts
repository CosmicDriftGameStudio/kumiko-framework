import { describe, expect, test } from "bun:test";
import type { ProbeOptions } from "@cosmicdrift/kumiko-types/probe";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import { createDecimalField } from "../../factories.ts";
import { from } from "../../ownership.ts";
import { assignableAppRolesFromUsages } from "../../role-assignment.ts";
import { BootRuleViolation } from "../boot-rule.ts";

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw");
}

function expectRule(fn: () => void, ruleId: string, messagePart: string): void {
  const thrown = thrownBy(fn);
  expect(thrown).toBeInstanceOf(BootRuleViolation);
  if (!(thrown instanceof BootRuleViolation)) return;
  expect(thrown.rule.id).toBe(ruleId);
  expect(thrown.message).toContain(messagePart);
}

const probe: ProbeOptions = {
  name: "Not Kebab",
  scope: "tenant",
  cost: "free",
  area: "probe.area",
  label: "probe.label",
  run: async () => ({ status: "ok", message: { key: "probe.ok" } }),
};

describe("definition layer rules", () => {
  test("feature: r.describe twice", () => {
    expectRule(
      () =>
        defineFeature("demo", (r) => {
          r.describe("one");
          r.describe("two");
        }),
      "feature/describe-twice",
      "r.describe() called twice",
    );
  });

  test("feature: dedupeOptions with a nested object", () => {
    expectRule(
      () => defineFeature("demo", () => undefined, { dedupeOptions: { nested: {} } }),
      "feature/dedupe-options-not-comparable",
      "dedupeOptions.nested must be a primitive",
    );
  });

  test("registrar: positional call of an object-form method", () => {
    expectRule(
      () =>
        defineFeature("demo", (r) => {
          // @ts-expect-error untyped JS callers pass strings
          r.requires("other");
        }),
      "registrar/options-object-required",
      "r.requires() takes one options object",
    );
  });

  test("ui extensions: nav id not kebab-case", () => {
    expectRule(
      () =>
        defineFeature("demo", (r) => {
          r.nav({ id: "Bad_Id", label: "Home", screen: "demo:screen:home" });
        }),
      "nav/id-not-kebab",
      'Nav id "Bad_Id" must be kebab-case',
    );
  });

  test("config events jobs: envSchema twice", () => {
    expectRule(
      () =>
        defineFeature("demo", (r) => {
          r.envSchema(z.object({}));
          r.envSchema(z.object({}));
        }),
      "env-schema/declared-twice",
      "r.envSchema() called twice",
    );
  });

  test("handlers: write handler without access", () => {
    expectRule(
      () =>
        defineFeature("demo", (r) => {
          // @ts-expect-error access is required
          r.writeHandler({
            name: "task:close",
            schema: z.object({}),
            handler: async () => ({ isSuccess: true, data: null }),
          });
        }),
      "handler/access-rule-required",
      "requires an access rule",
    );
  });

  test("probes: probe name not kebab-case", () => {
    expectRule(
      () =>
        defineFeature("demo", (r) => {
          r.probe(probe);
        }),
      "probe/name-not-kebab",
      'name "Not Kebab" must be kebab-case',
    );
  });

  test("webhook events: name not kebab-case", () => {
    expectRule(
      () =>
        defineFeature("demo", (r) => {
          r.defineWebhookEvent({
            name: "Not Kebab",
            description: "Something happened.",
            payload: z.object({}),
            version: 1,
          });
        }),
      "webhook-event/name-not-kebab",
      "name must be kebab-case",
    );
  });

  test("events: empty piiFields object", () => {
    expectRule(
      () =>
        defineFeature("demo", (r) => {
          r.defineEvent("ping", z.object({}), { piiFields: {} });
        }),
      "event/pii-stance-empty",
      "piiFields: {} is not a stance",
    );
  });

  test("field factories: decimal scale above precision", () => {
    expectRule(
      () => createDecimalField({ precision: 2, scale: 4 }),
      "field/decimal-precision-scale-invalid",
      "createDecimalField: precision/scale must be integers",
    );
  });

  test("ownership from(): ref without a colon", () => {
    expectRule(() => from("nocolon"), "ownership/from-ref-without-colon", "no colon found");
  });

  test("role assignment: empty role name", () => {
    expectRule(
      () => assignableAppRolesFromUsages([{ entityName: "" }]),
      "role/assignable-name-empty",
      "role name must not be empty",
    );
  });
});

describe("definition layer outside collect mode", () => {
  test("defineFeature throws at the first of two violations", () => {
    const thrown = thrownBy(() =>
      defineFeature("demo", (r) => {
        r.describe("one");
        r.describe("two");
        r.nav({ id: "Bad_Id", label: "Home", screen: "demo:screen:home" });
      }),
    );
    expect(thrown).toBeInstanceOf(BootRuleViolation);
    expect(thrown instanceof BootRuleViolation && thrown.rule.id).toBe("feature/describe-twice");
  });
});
