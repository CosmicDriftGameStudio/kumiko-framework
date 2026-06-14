import { describe, expect, test } from "bun:test";
import type { ConfigCascade, ConfigCascadeLevel } from "@cosmicdrift/kumiko-framework/engine";
import {
  mayViewInheritedSystemValue,
  redactInheritedSystemCascade,
  shouldRedactInheritedSystem,
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
  test("only SystemAdmin may view the inherited system value", () => {
    expect(mayViewInheritedSystemValue(["SystemAdmin"])).toBe(true);
    expect(mayViewInheritedSystemValue(["Admin", "TenantAdmin"])).toBe(false);
    expect(mayViewInheritedSystemValue([])).toBe(false);
  });

  test("shouldRedactInheritedSystem requires inheritedToTenant:false AND a tenant-side viewer", () => {
    expect(shouldRedactInheritedSystem({ inheritedToTenant: false }, ["Admin"])).toBe(true);
    expect(shouldRedactInheritedSystem({ inheritedToTenant: false }, ["SystemAdmin"])).toBe(false);
    expect(shouldRedactInheritedSystem({ inheritedToTenant: undefined }, ["Admin"])).toBe(false);
    expect(shouldRedactInheritedSystem({ inheritedToTenant: true }, ["Admin"])).toBe(false);
  });
});

describe("read-redaction — cascade redaction", () => {
  test("strips system-row value+hasValue and falls through to missing", () => {
    const out = redactInheritedSystemCascade(
      cascade([level("system-row", "smtp.internal", true), level("default", undefined)]),
    );
    const sys = out.levels.find((l) => l.source === "system-row");
    expect(sys?.value).toBeUndefined();
    expect(sys?.hasValue).toBe(false);
    expect(sys?.isActive).toBe(false);
    expect(out.value).toBeUndefined();
    expect(out.source).toBe("missing");
  });

  test("recomputes the winner to the next surviving level (app-override)", () => {
    const out = redactInheritedSystemCascade(
      cascade([
        level("system-row", "secret", true),
        level("app-override", "from-env"),
        level("default", undefined),
      ]),
    );
    expect(out.value).toBe("from-env");
    expect(out.source).toBe("app-override");
    expect(out.levels.find((l) => l.source === "system-row")?.value).toBeUndefined();
  });

  test("a tenant's own override stays the winner; only the system-row is hidden", () => {
    const out = redactInheritedSystemCascade(
      cascade([
        level("tenant-row", "tenant-value", true),
        level("system-row", "platform-default"),
        level("default", undefined),
      ]),
    );
    expect(out.value).toBe("tenant-value");
    expect(out.source).toBe("tenant-row");
    expect(out.levels.find((l) => l.source === "tenant-row")?.isActive).toBe(true);
    expect(out.levels.find((l) => l.source === "system-row")?.value).toBeUndefined();
    expect(out.levels.find((l) => l.source === "system-row")?.hasValue).toBe(false);
  });

  test("no-op when the cascade carries no system-row value", () => {
    const input = cascade([level("tenant-row", "x", true), level("default", undefined)]);
    expect(redactInheritedSystemCascade(input)).toEqual(input);
  });
});
