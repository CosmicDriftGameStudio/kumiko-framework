import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField } from "../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const OPEN_ACCESS = { openToAll: { reason: "test handler callable by any signed-in test user" } };

const targetFeature = defineFeature("fleet", (r) => {
  r.queryHandler({
    name: "vehicle:detail",
    schema: z.object({}),
    handler: async () => ({ name: "x" }),
    access: OPEN_ACCESS,
  });
  r.screen({
    id: "vehicle-detail",
    type: "projectionDetail",
    query: "fleet:query:vehicle:detail",
    layout: {
      mode: "tabs",
      sections: [
        { id: "overview", title: "Overview", fields: ["name"] },
        { id: "channels", title: "Channels", fields: ["name"] },
      ],
    },
  });
});

function metricFeature(navigate: { screen: string; tab?: string }) {
  return defineFeature("dash", (r) => {
    r.queryHandler({
      name: "summary",
      schema: z.object({}),
      handler: async () => ({ name: "x" }),
      access: OPEN_ACCESS,
    });
    r.screen({
      id: "summary",
      type: "projectionDetail",
      query: "dash:query:summary",
      layout: { sections: [{ title: "Summary", fields: ["name"] }] },
      metrics: [{ field: "name", label: "dash.metrics.name", navigate }],
    });
  });
}

function toolbarFeature(screen: string) {
  return defineFeature("shop", (r) => {
    r.entity({
      name: "product",
      ...createEntity({
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    });
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      toolbarActions: [{ kind: "navigate", id: "go", label: "shop.go", screen }],
    });
  });
}

describe("validateBoot — fully qualified navigate targets of another feature", () => {
  test("a metric navigate with the QN of a foreign screen boots", () => {
    expect(() =>
      validateBoot([targetFeature, metricFeature({ screen: "fleet:screen:vehicle-detail" })]),
    ).not.toThrow();
  });

  test("the tab of a QN target is validated against the foreign screen", () => {
    expect(() =>
      validateBoot([
        targetFeature,
        metricFeature({ screen: "fleet:screen:vehicle-detail", tab: "channels" }),
      ]),
    ).not.toThrow();
    expect(() =>
      validateBoot([
        targetFeature,
        metricFeature({ screen: "fleet:screen:vehicle-detail", tab: "unknown" }),
      ]),
    ).toThrow(/navigates to tab "unknown", which is not a section id on target screen/);
  });

  test("an unknown QN target is still rejected", () => {
    expect(() =>
      validateBoot([targetFeature, metricFeature({ screen: "fleet:screen:ghost" })]),
    ).toThrow(/navigate-target "fleet:screen:ghost" does not resolve/);
  });

  test("an entityList toolbar navigate accepts a foreign QN and rejects an unknown one", () => {
    expect(() =>
      validateBoot([targetFeature, toolbarFeature("fleet:screen:vehicle-detail")]),
    ).not.toThrow();
    expect(() => validateBoot([targetFeature, toolbarFeature("fleet:screen:ghost")])).toThrow(
      /navigate-target "fleet:screen:ghost" does not resolve/,
    );
  });
});
