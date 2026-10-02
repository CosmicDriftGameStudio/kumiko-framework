import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture.js";
import { validateBoot as validateBootRaw } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("validateBoot — MetricNavigate.tab (cross-screen)", () => {
  test("metric navigate.screen + valid tab boots cleanly", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("vehicle:detail", z.object({}), async () => ({ name: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "vehicle-detail",
        type: "projectionDetail",
        query: "app:query:vehicle:detail",
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", fields: ["name"] },
            { id: "channels", title: "Channels", fields: ["name"] },
          ],
        },
      });
      r.queryHandler("fleet:summary", z.object({}), async () => ({ name: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "fleet-summary",
        type: "projectionDetail",
        query: "app:query:fleet:summary",
        layout: { sections: [{ title: "Summary", fields: ["name"] }] },
        metrics: [
          {
            field: "name",
            label: "app.metrics.name",
            navigate: { screen: "vehicle-detail", tab: "channels" },
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("metric navigate.screen + unknown tab throws with the metric field name", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("vehicle:detail", z.object({}), async () => ({ name: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "vehicle-detail",
        type: "projectionDetail",
        query: "app:query:vehicle:detail",
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", fields: ["name"] },
            { id: "channels", title: "Channels", fields: ["name"] },
          ],
        },
      });
      r.queryHandler("fleet:summary", z.object({}), async () => ({ name: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "fleet-summary",
        type: "projectionDetail",
        query: "app:query:fleet:summary",
        layout: { sections: [{ title: "Summary", fields: ["name"] }] },
        metrics: [
          {
            field: "name",
            label: "app.metrics.name",
            navigate: { screen: "vehicle-detail", tab: "unknown" },
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /metric "name" navigates to tab "unknown", which is not a section id on target screen/,
    );
  });

  test("metric navigate.entity + entityId + unknown tab throws", () => {
    const feature = defineFeature("app", (r) => {
      r.entity(
        "vehicle",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.queryHandler("vehicle:detail", z.object({}), async () => ({ name: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "vehicle-detail",
        type: "projectionDetail",
        detailFor: "vehicle",
        query: "app:query:vehicle:detail",
        layout: {
          mode: "tabs",
          sections: [
            { id: "overview", title: "Overview", fields: ["name"] },
            { id: "channels", title: "Channels", fields: ["name"] },
          ],
        },
      });
      r.queryHandler("fleet:summary", z.object({}), async () => ({ name: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "fleet-summary",
        type: "projectionDetail",
        query: "app:query:fleet:summary",
        layout: { sections: [{ title: "Summary", fields: ["name"] }] },
        metrics: [
          {
            field: "name",
            label: "app.metrics.name",
            navigate: { entity: "vehicle", entityId: "vehicleId", tab: "unknown" },
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /metric "name" navigates to tab "unknown", which is not a section id on target screen/,
    );
  });

  test("metric navigate.screen targeting a non-tabs projectionDetail throws", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("vehicle:detail", z.object({}), async () => ({ name: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "vehicle-detail",
        type: "projectionDetail",
        query: "app:query:vehicle:detail",
        layout: { sections: [{ title: "Overview", fields: ["name"] }] },
      });
      r.queryHandler("fleet:summary", z.object({}), async () => ({ name: "x" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "fleet-summary",
        type: "projectionDetail",
        query: "app:query:fleet:summary",
        layout: { sections: [{ title: "Summary", fields: ["name"] }] },
        metrics: [
          {
            field: "name",
            label: "app.metrics.name",
            navigate: { screen: "vehicle-detail", tab: "overview" },
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /is not a projectionDetail with layout.mode "tabs"/,
    );
  });

  describe("metric navigate without tab", () => {
    function featureWithMetricNavigate(navigate: Record<string, string>) {
      return defineFeature("app", (r) => {
        r.entity(
          "vehicle",
          createEntity({
            table: "Vehicles",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        );
        r.queryHandler("vehicle:detail", z.object({}), async () => ({ name: "x" }), {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "vehicle-detail",
          type: "projectionDetail",
          detailFor: "vehicle",
          query: "app:query:vehicle:detail",
          layout: { sections: [{ title: "Main", fields: ["name"] }] },
        });
        r.queryHandler("fleet:summary", z.object({}), async () => ({ name: "x", vehicleId: "1" }), {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "fleet-summary",
          type: "projectionDetail",
          query: "app:query:fleet:summary",
          layout: { sections: [{ title: "Summary", fields: ["name"] }] },
          metrics: [{ field: "name", label: "app.metrics.name", navigate }],
        });
      });
    }

    test("an unknown navigate.screen throws", () => {
      expect(() => validateBoot([featureWithMetricNavigate({ screen: "ghost" })])).toThrow(
        /metric "name".*navigate-target "ghost" does not resolve/,
      );
    });

    test("navigate.entity without entityId throws", () => {
      expect(() => validateBoot([featureWithMetricNavigate({ entity: "vehicle" })])).toThrow(
        /metric "name".*needs an explicit "entityId"/,
      );
    });

    test("a known navigate.screen and an entity with entityId boot", () => {
      expect(() =>
        validateBoot([featureWithMetricNavigate({ screen: "vehicle-detail" })]),
      ).not.toThrow();
      expect(() =>
        validateBoot([featureWithMetricNavigate({ entity: "vehicle", entityId: "vehicleId" })]),
      ).not.toThrow();
    });
  });
});
