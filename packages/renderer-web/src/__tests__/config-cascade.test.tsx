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
import { ConfigCascadeView } from "../components/config-cascade";
import { render, screen } from "./test-utils";

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
  test("Source-Badges zeigen übersetzte Labels, keine rohen Keys", async () => {
    const user = userEvent.setup();
    const view = render(
      <ConfigCascadeView cascade={tenantCascade({ tenantValue: "acme" })} screenScope="tenant" />,
    );
    // Collapsed-Header: aktive Ebene = Tenant.
    expect(view.container.textContent).toContain("Tenant");
    expect(view.container.textContent).not.toContain("config.source");

    await user.click(screen.getByRole("button"));
    expect(view.container.textContent).not.toContain("config.source");
    expect(view.container.textContent).not.toContain("config.cascade");
    // activeMarker übersetzt.
    expect(view.container.textContent).toContain("active");
  });
});

describe("ConfigCascadeView — Scope-Filter (Bug 8)", () => {
  test("screenScope=tenant: Operator-Ebenen sind unsichtbar, EIN neutraler Standard-Fallback bleibt", async () => {
    const user = userEvent.setup();
    const view = render(<ConfigCascadeView cascade={tenantCascade()} screenScope="tenant" />);
    await user.click(screen.getByRole("button"));

    // Sichtbar: Tenant-Zeile + genau eine neutrale "Standard"-Zeile (Bug-Bash 3
    // #11: ein durchgängiger Begriff, EN-Locale → "Default").
    expect(view.container.textContent).toContain("Tenant");
    expect(view.container.textContent).toContain("Default");
    // Unsichtbar: alles was nur der Operator steuert.
    expect(view.container.textContent).not.toContain("System");
    expect(view.container.textContent).not.toContain("App override");
    expect(view.container.textContent).not.toContain("Computed");
    // Der deklarierte Default erscheint als Wert der neutralen Standard-Zeile,
    // nicht als eigene Operator-Ebene.
    expect(view.container.textContent).toContain("fallback");
  });

  test("screenScope=tenant mit aktivem System-Wert: Standard-Zeile zeigt den effektiven Wert, nicht die Quelle", async () => {
    const user = userEvent.setup();
    const view = render(
      <ConfigCascadeView cascade={tenantCascade({ systemActive: true })} screenScope="tenant" />,
    );
    // Collapsed-Header leakt die Operator-Quelle nicht …
    expect(view.container.textContent).toContain("Default");
    expect(view.container.textContent).toContain("system-smtp");
    expect(view.container.textContent).not.toContain("System");

    // … und expanded genauso: effektiver Wert sichtbar, Quelle neutral.
    await user.click(screen.getAllByRole("button")[0] as HTMLElement);
    expect(view.container.textContent).toContain("system-smtp");
    expect(view.container.textContent).not.toContain("System");
  });

  test("screenScope=system: Operator sieht weiterhin die volle Cascade", async () => {
    const user = userEvent.setup();
    const view = render(
      <ConfigCascadeView cascade={tenantCascade({ systemActive: true })} screenScope="system" />,
    );
    await user.click(screen.getByRole("button"));
    expect(view.container.textContent).toContain("System");
    expect(view.container.textContent).toContain("App override");
    expect(view.container.textContent).toContain("Computed");
    expect(view.container.textContent).toContain("Default");
  });

  test("Reset-Button erscheint nur bei eigener Überschreibung und nennt den Scope übersetzt", async () => {
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
    await user.click(screen.getByRole("button"));
    const reset = screen.getByText("Reset override (Tenant)");
    await user.click(reset);
    expect(resets).toEqual([{ key: "branding.title", scope: "tenant" }]);
  });

  test("ohne eigene Überschreibung: kein Reset-Button", async () => {
    const user = userEvent.setup();
    const view = render(
      <ConfigCascadeView
        cascade={tenantCascade()}
        screenScope="tenant"
        qualifiedKey="branding.title"
        onReset={() => undefined}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(view.queryByText("Reset override (Tenant)")).toBeNull();
  });
});
