import { describe, expect, test } from "bun:test";
import type { ConfigCascade, ConfigCascadeLevel } from "@cosmicdrift/kumiko-framework/engine";
import {
  mayViewInheritedValue,
  redactInheritedCascade,
  shouldRedactInherited,
} from "../read-redaction";

function level(
  source: ConfigCascadeLevel["source"],
  value: string | number | boolean | undefined,
  isActive = false,
): ConfigCascadeLevel {
  return { label: source, source, value, isActive, hasValue: value !== undefined };
}

function cascade(levels: ConfigCascadeLevel[]): ConfigCascade {
  const active = levels.find((l) => l.isActive);
  return { value: active?.value, source: active?.source ?? "missing", levels };
}

describe("read-redaction — viewer predicate", () => {
  test("only SystemAdmin may view the inherited platform value", () => {
    expect(mayViewInheritedValue(["SystemAdmin"])).toBe(true);
    expect(mayViewInheritedValue(["Admin", "TenantAdmin"])).toBe(false);
    expect(mayViewInheritedValue([])).toBe(false);
  });

  test("shouldRedactInherited requires inheritedToTenant:false AND a tenant-side viewer", () => {
    expect(shouldRedactInherited({ inheritedToTenant: false }, ["Admin"])).toBe(true);
    expect(shouldRedactInherited({ inheritedToTenant: false }, ["SystemAdmin"])).toBe(false);
    expect(shouldRedactInherited({ inheritedToTenant: undefined }, ["Admin"])).toBe(false);
    expect(shouldRedactInherited({ inheritedToTenant: true }, ["Admin"])).toBe(false);
  });
});

describe("read-redaction — cascade redaction strips every inherited platform rung", () => {
  test("strips system-row and falls through to missing", () => {
    const out = redactInheritedCascade(
      cascade([level("system-row", "smtp.internal", true), level("default", undefined)]),
    );
    const sys = out.levels.find((l) => l.source === "system-row");
    expect(sys?.value).toBeUndefined();
    expect(sys?.hasValue).toBe(false);
    expect(out.value).toBeUndefined();
    expect(out.source).toBe("missing");
  });

  test("strips the app-override rung too — the #376 leak via ENV-bridged value", () => {
    const out = redactInheritedCascade(
      cascade([
        level("system-row", "secret", true),
        level("app-override", "from-env"),
        level("default", undefined),
      ]),
    );
    // The platform env value must NOT become the new winner.
    expect(out.value).toBeUndefined();
    expect(out.source).toBe("missing");
    expect(out.levels.find((l) => l.source === "app-override")?.value).toBeUndefined();
    expect(out.levels.find((l) => l.source === "app-override")?.hasValue).toBe(false);
  });

  test("strips computed and static default rungs", () => {
    const out = redactInheritedCascade(
      cascade([
        level("system-row", "sys", true),
        level("computed", "plan-derived"),
        level("default", "schema-default"),
      ]),
    );
    expect(out.value).toBeUndefined();
    expect(out.source).toBe("missing");
    expect(out.levels.find((l) => l.source === "computed")?.hasValue).toBe(false);
    expect(out.levels.find((l) => l.source === "default")?.hasValue).toBe(false);
  });

  test("a tenant's own override survives; every platform rung is hidden", () => {
    const out = redactInheritedCascade(
      cascade([
        level("tenant-row", "tenant-value", true),
        level("system-row", "platform-default"),
        level("app-override", "from-env"),
        level("default", "schema-default"),
      ]),
    );
    expect(out.value).toBe("tenant-value");
    expect(out.source).toBe("tenant-row");
    expect(out.levels.find((l) => l.source === "tenant-row")?.isActive).toBe(true);
    for (const source of ["system-row", "app-override", "default"] as const) {
      expect(out.levels.find((l) => l.source === source)?.hasValue).toBe(false);
    }
  });

  test("a user's own override survives over tenant-row", () => {
    const out = redactInheritedCascade(
      cascade([
        level("user-row", "user-value", true),
        level("tenant-row", "tenant-value"),
        level("system-row", "platform"),
      ]),
    );
    expect(out.value).toBe("user-value");
    expect(out.source).toBe("user-row");
    expect(out.levels.find((l) => l.source === "tenant-row")?.value).toBe("tenant-value");
  });

  test("no-op when no platform rung carries a value", () => {
    const input = cascade([level("tenant-row", "x", true), level("default", undefined)]);
    expect(redactInheritedCascade(input)).toEqual(input);
  });
});
