import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import type { SelectFieldDef } from "@cosmicdrift/kumiko-types/fields";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { createTenantConfig } from "../config-helpers.ts";
import { defineFeature } from "../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const heartbeatOnly = (options: readonly string[]) => ({
  options,
  when: { field: "kind", eq: "heartbeat" },
});

function monitorFeature(interval: Omit<SelectFieldDef, "type">) {
  return defineFeature("monitoring", (r) => {
    r.entity({
      name: "monitor",
      fields: {
        kind: { type: "select", options: ["http", "heartbeat"] },
        interval: { type: "select", ...interval },
      },
    });
  });
}

const base = { options: ["60", "300", "3600"], default: "300" } as const;

describe("validateBoot — select conditionalOptions on entity fields", () => {
  test("a valid rule boots", () => {
    const feature = monitorFeature({ ...base, conditionalOptions: [heartbeatOnly(["3600"])] });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test.each([
    ["eq", { field: "kind", eq: "hearbeat" }],
    ["ne", { field: "kind", ne: "hearbeat" }],
    ["in", { field: "kind", in: ["http", "hearbeat"] }],
    ["notIn", { field: "kind", notIn: ["hearbeat"] }],
  ] as const)(
    "a when.%s value that is not an option of the condition field throws",
    (_op, when) => {
      const feature = monitorFeature({
        ...base,
        conditionalOptions: [{ options: ["3600"], when }],
      });
      expect(() => validateBoot([feature])).toThrow(
        /conditionalOptions\[0\]\.when value "hearbeat" which is not an option of "kind"/,
      );
    },
  );

  test("an empty rule throws", () => {
    const feature = monitorFeature({ ...base, conditionalOptions: [heartbeatOnly([])] });
    expect(() => validateBoot([feature])).toThrow(/empty conditionalOptions\[0\]\.options/);
  });

  test("an option that is not in options throws", () => {
    const feature = monitorFeature({ ...base, conditionalOptions: [heartbeatOnly(["999"])] });
    expect(() => validateBoot([feature])).toThrow(
      /"999" in conditionalOptions\[0\] which is not in options/,
    );
  });

  test("an option in two rules throws", () => {
    const feature = monitorFeature({
      ...base,
      conditionalOptions: [
        heartbeatOnly(["3600"]),
        { options: ["3600"], when: { field: "kind", ne: "http" } },
      ],
    });
    expect(() => validateBoot([feature])).toThrow(
      /"3600" in conditionalOptions\[0\] and conditionalOptions\[1\]/,
    );
  });

  test("a condition on an unknown field throws", () => {
    const feature = monitorFeature({
      ...base,
      conditionalOptions: [{ options: ["3600"], when: { field: "ghost", eq: "x" } }],
    });
    expect(() => validateBoot([feature])).toThrow(/when\.field "ghost" which is not a field/);
  });

  test("a condition on the field itself throws", () => {
    const feature = monitorFeature({
      ...base,
      conditionalOptions: [{ options: ["3600"], when: { field: "interval", eq: "60" } }],
    });
    expect(() => validateBoot([feature])).toThrow(/\.when on its own field/);
  });

  test("a default inside a rule throws", () => {
    const feature = monitorFeature({
      options: ["60", "3600"],
      default: "3600",
      conditionalOptions: [heartbeatOnly(["3600"])],
    });
    expect(() => validateBoot([feature])).toThrow(/default "3600" inside conditionalOptions\[0\]/);
  });

  test("combined with optionsQuery throws", () => {
    const feature = monitorFeature({
      options: [],
      optionsQuery: "monitoring:query:intervals",
      conditionalOptions: [heartbeatOnly(["3600"])],
    });
    expect(() => validateBoot([feature])).toThrow(/optionsQuery/);
  });
});

describe("validateBoot — conditionalOptions outside entity fields", () => {
  const rule = [{ options: ["b"], when: { field: "other", eq: "x" } }];

  test("a screen form select field throws", () => {
    const feature = defineFeature("shop", (r) => {
      r.writeHandler({
        name: "restock",
        schema: { _type: "stub" } as never,
        handler: async () => ({ isSuccess: true, data: {} }) as never,
        access: { openToAll: { reason: "test handler" } },
      });
      r.screen({
        id: "restock-form",
        type: "actionForm",
        handler: "shop:write:restock",
        fields: {
          pick: { type: "select", options: ["a", "b"], conditionalOptions: rule },
        } as never,
        layout: { sections: [{ fields: ["pick"] }] } as never,
      });
    });
    expect(() => validateBoot([feature])).toThrow(/only supported on entity select fields/);
  });

  test("a config key throws", () => {
    const feature = defineFeature("shop", (r) => {
      r.config({
        keys: {
          pick: {
            ...createTenantConfig("select", { options: ["a", "b"] }),
            conditionalOptions: rule,
          } as never,
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/only supported on entity select fields/);
  });
});
