import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { FeatureDefinition } from "../../types";
import { warnOnUniqueAccessRoles } from "../access-roles";

function fakeFeature(overrides: Partial<FeatureDefinition> & { name: string }): FeatureDefinition {
  return {
    writeHandlers: {},
    queryHandlers: {},
    streamHandlers: {},
    ...overrides,
  } as unknown as FeatureDefinition;
}

describe("warnOnUniqueAccessRoles", () => {
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn");
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("warns when a role is used by exactly one handler", () => {
    const features = [
      fakeFeature({
        name: "users",
        writeHandlers: {
          "create-user": { name: "create-user", access: { roles: ["Admin"] } },
        } as unknown as FeatureDefinition["writeHandlers"],
      }),
    ];

    warnOnUniqueAccessRoles(features);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("Admin");
    expect(msg).toContain("users:write:create-user");
  });

  test("does NOT warn when the same role is used by two different handlers", () => {
    const features = [
      fakeFeature({
        name: "users",
        writeHandlers: {
          "create-user": { name: "create-user", access: { roles: ["Admin"] } },
        } as unknown as FeatureDefinition["writeHandlers"],
      }),
      fakeFeature({
        name: "billing",
        queryHandlers: {
          "list-invoices": { name: "list-invoices", access: { roles: ["Admin"] } },
        } as unknown as FeatureDefinition["queryHandlers"],
      }),
    ];

    warnOnUniqueAccessRoles(features);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("does NOT warn for built-in roles 'all' or 'system' even when used by one handler", () => {
    const features = [
      fakeFeature({
        name: "misc",
        writeHandlers: {
          "open-endpoint": { name: "open-endpoint", access: { roles: ["all"] } },
        } as unknown as FeatureDefinition["writeHandlers"],
      }),
      fakeFeature({
        name: "admin-tools",
        streamHandlers: {
          "audit-log": { name: "audit-log", access: { roles: ["system"] } },
        } as unknown as FeatureDefinition["streamHandlers"],
      }),
    ];

    warnOnUniqueAccessRoles(features);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
