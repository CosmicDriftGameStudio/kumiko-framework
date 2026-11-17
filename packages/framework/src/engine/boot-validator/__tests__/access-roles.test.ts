import { beforeEach, describe, expect, test } from "bun:test";
import type { FeatureDefinition } from "../../types/index.ts";
import { warnOnUniqueAccessRoles } from "../access-roles.ts";
import type { BootWarning, BootWarningSink } from "../boot-warning.ts";

function fakeFeature(overrides: Partial<FeatureDefinition> & { name: string }): FeatureDefinition {
  return {
    writeHandlers: {},
    queryHandlers: {},
    streamHandlers: {},
    ...overrides,
  } as unknown as FeatureDefinition;
}

describe("warnOnUniqueAccessRoles", () => {
  let warnings: BootWarning[];
  const warn: BootWarningSink = (warning) => {
    warnings.push(warning);
  };

  beforeEach(() => {
    warnings = [];
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

    warnOnUniqueAccessRoles(warn, features);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "access/unique-role" });
    const msg = warnings[0]!.message;
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

    warnOnUniqueAccessRoles(warn, features);

    expect(warnings).toHaveLength(0);
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

    warnOnUniqueAccessRoles(warn, features);

    expect(warnings).toHaveLength(0);
  });
});
