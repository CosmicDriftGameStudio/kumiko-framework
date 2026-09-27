import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("validateBoot — ToolbarAction.tab", () => {
  test("entityList toolbar navigate + unknown tab throws with the action id", () => {
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
      r.entity(
        "car",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "car-list",
        type: "entityList",
        entity: "car",
        columns: ["name"],
        toolbarActions: [
          {
            kind: "navigate",
            id: "view-channels",
            label: "app.actions.viewChannels",
            screen: "vehicle-detail",
            tab: "unknown",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /toolbarAction "view-channels".*navigates to tab "unknown", which is not a section id on target screen/,
    );
  });

  test("entityList toolbar navigate + known tab boots cleanly", () => {
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
      r.entity(
        "car",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "car-list",
        type: "entityList",
        entity: "car",
        columns: ["name"],
        toolbarActions: [
          {
            kind: "navigate",
            id: "view-channels",
            label: "app.actions.viewChannels",
            screen: "vehicle-detail",
            tab: "channels",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("entityList toolbar navigate targeting a non-tabs projectionDetail throws", () => {
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
      r.entity(
        "car",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "car-list",
        type: "entityList",
        entity: "car",
        columns: ["name"],
        toolbarActions: [
          {
            kind: "navigate",
            id: "view-channels",
            label: "app.actions.viewChannels",
            screen: "vehicle-detail",
            tab: "overview",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /is not a projectionDetail with layout.mode "tabs"/,
    );
  });

  test("projectionList toolbar navigate + unknown tab throws", () => {
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
      r.queryHandler("car:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "car-projection-list",
        type: "projectionList",
        query: "app:query:car:list",
        columns: ["name"],
        toolbarActions: [
          {
            kind: "navigate",
            id: "view-channels",
            label: "app.actions.viewChannels",
            screen: "vehicle-detail",
            tab: "unknown",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /toolbarAction "view-channels".*navigates to tab "unknown", which is not a section id on target screen/,
    );
  });

  test("relatedList section toolbar navigate + unknown tab throws", () => {
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
      r.queryHandler("lease:detail", z.object({}), async () => ({ id: "1" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.queryHandler(
        "lease:positions",
        z.object({}),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
      );
      r.screen({
        id: "lease-detail",
        type: "projectionDetail",
        query: "app:query:lease:detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Positions",
              query: "app:query:lease:positions",
              columns: ["id"],
              toolbarActions: [
                {
                  kind: "navigate",
                  id: "view-channels",
                  label: "app.actions.viewChannels",
                  screen: "vehicle-detail",
                  tab: "unknown",
                },
              ],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /toolbarAction "view-channels".*navigates to tab "unknown", which is not a section id on target screen/,
    );
  });
});
