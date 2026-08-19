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
    expect(
      preferencesAccess && "openToAll" in preferencesAccess && preferencesAccess.openToAll,
    ).toBe(true);
  });

  test("boot-validates with a narrowed access option", () => {
    expect(() =>
      validateBoot([createDeliveryFeature({ access: access.systemAdmin })]),
    ).not.toThrow();
  });
});
