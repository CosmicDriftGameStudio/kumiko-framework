// ConfigCascadeView — Regression tests for production UX bugs
// (7) Source badges displayed raw i18n keys ("config.source.default")
// because no bundle defined them; (8) tenant admins saw every cascade level
// (System/App-Override/Computed) even though they can change only the tenant
// level. Keys now live under kumiko.config.* in kumikoDefaultTranslations,
// and non-system screens collapse levels above the screen scope into one
// neutral "Standard" row.

import { describe, expect, test } from "bun:test";
import type { ConfigCascade, ConfigCascadeLevel } from "@cosmicdrift/kumiko-framework/engine";
import userEvent from "@testing-library/user-event";
import { ConfigCascadeView } from "../components/config-cascade.tsx";
import { render, screen, within } from "./test-utils.tsx";

function level(overrides: Partial<ConfigCascadeLevel> & { source: ConfigCascadeLevel["source"] }) {
  return {
    label: overrides.source,
    value: undefined,
    isActive: false,
    hasValue: false,
    ...overrides,
  };
}

// Tenant-scope cascade returned by buildCascade: tenant-row, all operator
// levels, and default.
function tenantCascade(overrides?: {
  tenantValue?: string;
  systemActive?: boolean;
}): ConfigCascade {
  const tenantHasValue = overrides?.tenantValue !== undefined;
  const systemActive = overrides?.systemActive === true;
  return {
    value: overrides?.tenantValue ?? (systemActive ? "system-smtp" : "fallback"),
    source: tenantHasValue ? "tenant-row" : systemActive ? "system-row" : "default",
    levels: [
      level({
        source: "tenant-row",
        value: overrides?.tenantValue,
        hasValue: tenantHasValue,
        isActive: tenantHasValue,
      }),
      level({
        source: "system-row",
        value: systemActive ? "system-smtp" : undefined,
        hasValue: systemActive,
        isActive: !tenantHasValue && systemActive,
      }),
      level({ source: "app-override" }),
      level({ source: "computed" }),
      level({
        source: "default",
        value: "fallback",
        hasValue: true,
        isActive: !tenantHasValue && !systemActive,
      }),
    ],
  };
}

describe("ConfigCascadeView — i18n (Bug 7)", () => {
  test("Origin sentence and panel show translated labels, not raw keys", async () => {
    const user = userEvent.setup();
    const view = render(
      <ConfigCascadeView cascade={tenantCascade({ tenantValue: "acme" })} screenScope="tenant" />,
    );
    expect(view.container.textContent).toContain("Set for this tenant");
    expect(view.container.textContent).not.toContain("config.source");
    expect(view.container.textContent).not.toContain("kumiko.config");

    await user.click(screen.getByRole("button", { name: "Show all levels" }));
    expect(view.container.textContent).not.toContain("config.source");
    expect(view.container.textContent).not.toContain("kumiko.config");
    expect(view.container.textContent).toContain("in use");
    expect(screen.getByRole("button", { name: "Hide levels" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });
});

describe("ConfigCascadeView — Scope-Filter (Bug 8)", () => {
  test("screenScope=tenant: Operator levels are hidden, one neutral default fallback remains", async () => {
    const user = userEvent.setup();
    // A tenant override remains expandable, but scope filtering hides the
    // operator levels and shows only Tenant and Standard.
    const view = render(
      <ConfigCascadeView cascade={tenantCascade({ tenantValue: "acme" })} screenScope="tenant" />,
    );
    await user.click(screen.getByRole("button", { name: "Show all levels" }));

    const panel = within(view.container.querySelector("ul") as HTMLElement);
    expect(panel.getByText("Tenant")).toBeTruthy();
    expect(panel.getByText("Default")).toBeTruthy();
    expect(panel.queryByText("Platform")).toBeNull();
    expect(panel.queryByText("App override")).toBeNull();
    expect(panel.queryByText("Computed")).toBeNull();
    expect(panel.getByText("fallback")).toBeTruthy();
  });

  test("screenScope=tenant with active system value: only the default hint, not expandable", async () => {
    const view = render(
      <ConfigCascadeView cascade={tenantCascade({ systemActive: true })} screenScope="tenant" />,
    );
    // The operator source stays masked as "Uses the default". With only one
    // value level there is nothing to expand.
    expect(view.container.textContent).toContain("Uses the default");
    expect(view.container.textContent).not.toContain("Platform");
    expect(view.queryByRole("button")).toBeNull();
  });

  test("screenScope=system: Operator sieht weiterhin die volle Cascade", async () => {
    const user = userEvent.setup();
    const view = render(
      <ConfigCascadeView cascade={tenantCascade({ systemActive: true })} screenScope="system" />,
    );
    await user.click(screen.getByRole("button", { name: "Show all levels" }));
    expect(view.container.textContent).toContain("Platform");
    expect(view.container.textContent).toContain("App override");
    expect(view.container.textContent).toContain("Computed");
    expect(view.container.textContent).toContain("Default");
  });

  test("Reset button appears only for an own override, without expanding", async () => {
    const user = userEvent.setup();
    const resets: { key: string; scope: string }[] = [];
    render(
      <ConfigCascadeView
        cascade={tenantCascade({ tenantValue: "acme" })}
        screenScope="tenant"
        qualifiedKey="branding.title"
        onReset={(key, scope) => resets.push({ key, scope })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(resets).toEqual([{ key: "branding.title", scope: "tenant" }]);
  });

  test("Pure default field (no override, one value): not expandable, no button/panel/reset", async () => {
    const view = render(
      <ConfigCascadeView
        cascade={tenantCascade()}
        screenScope="tenant"
        qualifiedKey="branding.title"
        onReset={() => undefined}
      />,
    );
    expect(view.queryByRole("button")).toBeNull();
    expect(view.container.textContent).toContain("Uses the default");
  });

  test("Unset and required: red hint instead of default", () => {
    const empty: ConfigCascade = {
      value: undefined,
      source: "missing",
      levels: [level({ source: "tenant-row" }), level({ source: "missing", isActive: true })],
    };
    const view = render(<ConfigCascadeView cascade={empty} screenScope="tenant" required />);
    expect(view.container.textContent).toContain("Not set. Required.");
    expect(view.queryByRole("button")).toBeNull();
  });
});

describe("ConfigCascadeView — origin sentence with default value", () => {
  test("Own value: sentence states the default inline", () => {
    const view = render(
      <ConfigCascadeView cascade={tenantCascade({ tenantValue: "acme" })} screenScope="tenant" />,
    );
    expect(view.container.textContent).toContain("Set for this tenant. Default is fallback.");
  });

  test("Empty default: sentence without default clause", () => {
    const emptyDefault: ConfigCascade = {
      value: "acme",
      source: "tenant-row",
      levels: [
        level({ source: "tenant-row", value: "acme", hasValue: true, isActive: true }),
        level({ source: "default", value: "", hasValue: true }),
      ],
    };
    const view = render(<ConfigCascadeView cascade={emptyDefault} screenScope="tenant" />);
    expect(view.container.textContent).toContain("Set for this tenant.");
    expect(view.container.textContent).not.toContain("Default is");
  });

  test("Disclosure omitted with at most two levels in tenant scope", () => {
    const twoLevels: ConfigCascade = {
      value: "acme",
      source: "tenant-row",
      levels: [
        level({ source: "tenant-row", value: "acme", hasValue: true, isActive: true }),
        level({ source: "default", value: "fallback", hasValue: true }),
      ],
    };
    const view = render(<ConfigCascadeView cascade={twoLevels} screenScope="tenant" />);
    expect(view.queryByRole("button", { name: "Show all levels" })).toBeNull();
  });
});

describe("ConfigCascadeView — renderValue", () => {
  test("origin line and level rows show the rendered label, not the stored value", async () => {
    const user = userEvent.setup();
    const labels: Record<string, string> = { acme: "Acme Mail", fallback: "Built-in mail" };
    const view = render(
      <ConfigCascadeView
        cascade={tenantCascade({ tenantValue: "acme" })}
        screenScope="tenant"
        renderValue={(value) => <b>{labels[String(value)]}</b>}
      />,
    );
    expect(view.container.textContent).toContain("Built-in mail");
    expect(view.container.textContent).not.toContain("fallback");

    await user.click(screen.getByRole("button", { name: "Show all levels" }));
    expect(view.container.textContent).toContain("Acme Mail");
    expect(view.container.textContent).not.toContain("acme");
  });
});
