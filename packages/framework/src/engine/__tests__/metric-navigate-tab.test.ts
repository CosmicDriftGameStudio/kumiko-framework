import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

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
});
