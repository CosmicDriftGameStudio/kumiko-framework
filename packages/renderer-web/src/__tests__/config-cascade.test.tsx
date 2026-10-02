// ConfigCascadeView — Regression zu den Prod-UX-Bugs 2026-06-07
// (publicstatus Bugs 7+8): (7) Source-Badges zeigten ROHE i18n-Keys
// ("config.source.default"), weil kein Bundle die Keys kannte; (8) ein
// Tenant-Admin sah ALLE Cascade-Ebenen (System/App-Override/Computed)
// obwohl er nur die Tenant-Ebene beeinflussen kann. Jetzt: Keys leben
// als kumiko.config.* in kumikoDefaultTranslations, und Nicht-System-
// Screens kollabieren alles oberhalb des Screen-Scopes zu EINER
// neutralen "Standard"-Zeile (Bug-Bash 3 #11: ein durchgängiger Begriff).

import { describe, expect, test } from "bun:test";
import type { ConfigCascade, ConfigCascadeLevel } from "@cosmicdrift/kumiko-framework/engine";
import userEvent from "@testing-library/user-event";
import { ConfigCascadeView } from "../components/config-cascade.js";
import { render, screen, within } from "./test-utils.js";

function level(overrides: Partial<ConfigCascadeLevel> & { source: ConfigCascadeLevel["source"] }) {
  return {
    label: overrides.source,
    value: undefined,
    isActive: false,
    hasValue: false,
    ...overrides,
  };
}

// Tenant-Scope-Key wie ihn buildCascade liefert: tenant-row + alle
// Operator-Ebenen + default.
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
  test("Herkunftssatz und Panel zeigen übersetzte Labels, keine rohen Keys", async () => {
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
  test("screenScope=tenant: Operator-Ebenen sind unsichtbar, EIN neutraler Standard-Fallback bleibt", async () => {
    const user = userEvent.setup();
    // tenant-Override → aufklappbar; das Panel muss die Operator-Ebenen
    // trotzdem verbergen (Scope-Filter), nur Tenant + Standard zeigen.
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

  test("screenScope=tenant mit aktivem System-Wert: nur der Standard-Hinweis, nicht aufklappbar", async () => {
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

  test("Reset-Button erscheint nur bei eigener Überschreibung, ohne Aufklappen", async () => {
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

  test("reines Default-Feld (kein Override, ein Wert): nicht aufklappbar, kein Button/Panel/Reset", async () => {
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

  test("ungesetzt und required: roter Hinweis statt Standard", () => {
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

describe("ConfigCascadeView — Herkunftssatz mit Default-Wert", () => {
  test("eigener Wert: Satz nennt den Standard inline", () => {
    const view = render(
      <ConfigCascadeView cascade={tenantCascade({ tenantValue: "acme" })} screenScope="tenant" />,
    );
    expect(view.container.textContent).toContain("Set for this tenant. Default is fallback.");
  });

  test("leerer Default: Satz ohne Standard-Klausel", () => {
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

  test("Disclosure entfällt bei höchstens zwei Ebenen im Tenant-Scope", () => {
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
