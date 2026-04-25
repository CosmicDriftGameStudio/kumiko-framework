// @vitest-environment jsdom
import type { LocaleResolver } from "@kumiko/headless";
import { createStaticLocaleResolver, LocaleProvider } from "@kumiko/renderer";
import { render as _render, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { LanguageSwitcher } from "../layout/language-switcher";

// Tests greifen den LanguageSwitcher mit einem stateful Stub-Resolver
// (setLocale + subscribe) UND einem stateless Resolver, um die zwei
// Verzweigungen abzudecken: Switcher rendert nur wenn setLocale da ist.

function makeStatefulResolver(initial: string): LocaleResolver {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    translate: (key: string) => key,
    locale: () => current,
    timeZone: () => "UTC",
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    setLocale: vi.fn((next: string) => {
      current = next;
      for (const l of listeners) l();
    }),
  };
}

function renderWithResolver(resolver: LocaleResolver, ui: ReactNode) {
  return _render(<LocaleProvider resolver={resolver}>{ui}</LocaleProvider>);
}

const locales = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
];

describe("LanguageSwitcher", () => {
  test("renders nothing when resolver has no setLocale", () => {
    const resolver = createStaticLocaleResolver();
    const { container } = renderWithResolver(
      resolver,
      <LanguageSwitcher locales={locales} testId="lang" />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("active locale shown via shorthand", () => {
    const resolver = makeStatefulResolver("de");
    renderWithResolver(resolver, <LanguageSwitcher locales={locales} testId="lang" />);
    // Trigger zeigt den Locale-Code im DOM (Tailwind uppercased ihn nur
    // visuell via CSS — der Text-Knoten bleibt lowercase). Das passt:
    // getByText sieht den DOM-Text.
    expect(screen.getByText("de")).toBeTruthy();
  });

  test("opens dropdown and lists all locales with active marker", () => {
    const resolver = makeStatefulResolver("de");
    renderWithResolver(resolver, <LanguageSwitcher locales={locales} testId="lang" />);
    fireEvent.click(screen.getByRole("button", { name: "Sprache" }));
    expect(screen.getByText("Deutsch")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
  });

  test("clicking a locale calls resolver.setLocale", () => {
    const resolver = makeStatefulResolver("de");
    renderWithResolver(resolver, <LanguageSwitcher locales={locales} testId="lang" />);
    fireEvent.click(screen.getByRole("button", { name: "Sprache" }));
    fireEvent.click(screen.getByText("English"));
    expect(resolver.setLocale).toHaveBeenCalledWith("en");
  });

  test("matches active locale via language-root (de-AT → de)", async () => {
    const resolver = makeStatefulResolver("de-AT");
    renderWithResolver(resolver, <LanguageSwitcher locales={locales} testId="lang" />);
    // Trigger zeigt "DE" (aus de-AT abgeleitet) — der active marker im
    // Dropdown muss bei "Deutsch" sitzen, nicht bei "English".
    fireEvent.click(screen.getByRole("button", { name: "Sprache" }));
    await waitFor(() => {
      const deButton = screen.getByText("Deutsch").closest("button");
      // Active marker ist ein ✓ neben dem aktiven Eintrag
      expect(deButton?.textContent).toContain("✓");
    });
  });
});
