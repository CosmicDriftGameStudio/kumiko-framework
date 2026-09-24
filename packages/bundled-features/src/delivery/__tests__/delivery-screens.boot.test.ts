import { describe, expect, test } from "bun:test";
import {
  access,
  createRegistry,
  defineFeature,
  isOpenToAllGranted,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config/feature";
import { createTenantFeature } from "../../tenant/feature";
import { DELIVERY_CHANNEL_EXTENSION, DELIVERY_LOG_SCREEN_ID } from "../constants";
import { collectChannels } from "../delivery-service";
import { createDeliveryFeature } from "../feature";

describe("delivery screens + handler access alignment", () => {
  const features = [createConfigFeature(), createTenantFeature(), createDeliveryFeature()];

  test("boot-validates with delivery-log screen registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("delivery-log screen is projectionList, access.admin-gated", () => {
    const delivery = createDeliveryFeature();
    const screen = delivery.screens[DELIVERY_LOG_SCREEN_ID];
    expect(screen?.type).toBe("projectionList");
    expect(rolesOf(screen?.access)).toEqual([...access.admin]);
  });

  test("delivery log handler shares access.admin", () => {
    const delivery = createDeliveryFeature();
    expect(rolesOf(delivery.queryHandlers["log"]?.access)).toEqual([...access.admin]);
  });

  test("access option narrows the delivery-log screen and its log handler together (#2033)", () => {
    const delivery = createDeliveryFeature({ access: access.systemAdmin });
    const screen = delivery.screens[DELIVERY_LOG_SCREEN_ID];
    expect(rolesOf(screen?.access)).toEqual([...access.systemAdmin]);
    expect(rolesOf(delivery.queryHandlers["log"]?.access)).toEqual([...access.systemAdmin]);
  });

  test("access option leaves the preferences handler openToAll — that's per-user, not an admin surface", () => {
    const delivery = createDeliveryFeature({ access: access.systemAdmin });
    const preferencesAccess = delivery.queryHandlers["preferences"]?.access;
    expect(preferencesAccess !== undefined && isOpenToAllGranted(preferencesAccess)).toBe(true);
  });

  test("collectChannels fails loud on a registration with invalid options", () => {
    const broken = defineFeature("broken-channel", (r) => {
      // @ts-expect-error resolve/send are required — proves the guard rejects a malformed options bag instead of silently dropping the channel
      r.useExtension(DELIVERY_CHANNEL_EXTENSION, "bad-entity", { anything: 1 });
    });
    const registry = createRegistry([...features, broken]);
    expect(() => collectChannels(registry)).toThrow(
      `${DELIVERY_CHANNEL_EXTENSION} registration for "bad-entity" has invalid options`,
    );
  });

  test("boot-validates with a narrowed access option", () => {
    expect(() =>
      validateBoot([
        createConfigFeature(),
        createTenantFeature(),
        createDeliveryFeature({ access: access.systemAdmin }),
      ]),
    ).not.toThrow();
  });
});
