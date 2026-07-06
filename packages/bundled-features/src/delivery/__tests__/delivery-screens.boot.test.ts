import { describe, expect, test } from "bun:test";
import { access, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { DELIVERY_LOG_SCREEN_ID } from "../constants";
import { createDeliveryFeature } from "../feature";

describe("delivery screens + handler access alignment", () => {
  const features = [createDeliveryFeature()];

  test("boot-validates with delivery-log screen registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("delivery-log screen is custom, access.admin-gated", () => {
    const delivery = createDeliveryFeature();
    const screen = delivery.screens[DELIVERY_LOG_SCREEN_ID];
    expect(screen?.type).toBe("custom");
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(access.admin);
    }
  });

  test("delivery log handler shares access.admin", () => {
    const delivery = createDeliveryFeature();
    expect(rolesOf(delivery.queryHandlers["log"]?.access)).toEqual([...access.admin]);
  });
});
