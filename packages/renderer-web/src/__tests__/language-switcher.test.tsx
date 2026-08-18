import { describe, expect, mock, test } from "bun:test";
import type { LocaleResolver } from "@cosmicdrift/kumiko-headless";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
} from "@cosmicdrift/kumiko-renderer";
import { render as _render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "../layout/language-switcher";

// Tests exercise the LanguageSwitcher with both a stateful stub resolver
// (setLocale + subscribe) and a stateless resolver, covering the two
// branches: the switcher only renders when setLocale is present.
// Radix DropdownMenu opens on pointerdown, so userEvent is used instead of
// fireEvent.click.

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
    setLocale: mock((next: string) => {
      current = next;
      for (const l of listeners) l();
    }),
  };
}

function renderWithResolver(resolver: LocaleResolver, ui: ReactNode) {
  return _render(
    <LocaleProvider
      resolver={resolver}
      fallbackBundles={[{ de: localeDeBundle }, kumikoDefaultTranslations]}
    >
      {ui}
    </LocaleProvider>,
  );
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
    // The trigger shows the locale code in the DOM. Tailwind only
    // uppercases it visually via CSS, the text node stays lowercase.
    // That is fine, getByText sees the DOM text.
    expect(screen.getByText("de")).toBeTruthy();
  });

  test("opens dropdown and lists all locales with active marker", async () => {
    const user = userEvent.setup();
    const resolver = makeStatefulResolver("de");
    renderWithResolver(resolver, <LanguageSwitcher locales={locales} testId="lang" />);
    await user.click(screen.getByRole("button", { name: "Sprache" }));
    expect(screen.getByText("Deutsch")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
  });

  test("clicking a locale calls resolver.setLocale", async () => {
    const user = userEvent.setup();
    const resolver = makeStatefulResolver("de");
    renderWithResolver(resolver, <LanguageSwitcher locales={locales} testId="lang" />);
    await user.click(screen.getByRole("button", { name: "Sprache" }));
    await user.click(screen.getByText("English"));
    expect(resolver.setLocale).toHaveBeenCalledWith("en");
  });

  test("trigger accessible name follows the active locale (en → Language)", () => {
    const resolver = makeStatefulResolver("en");
    renderWithResolver(resolver, <LanguageSwitcher locales={locales} testId="lang" />);
    expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
  });

  test("matches active locale via language-root (de-AT → de)", async () => {
    const user = userEvent.setup();
    const resolver = makeStatefulResolver("de-AT");
    renderWithResolver(resolver, <LanguageSwitcher locales={locales} testId="lang" />);
    // The trigger shows "DE", derived from de-AT. The active marker in the
    // dropdown must sit on "Deutsch", not "English".
    await user.click(screen.getByRole("button", { name: "Sprache" }));
    await waitFor(() => {
      // Radix CheckboxItem marks active via aria-checked="true". The check
      // icon (lucide) lives in the ItemIndicator and is only visible when
      // checked, so the ARIA variant is robust against rendering quirks.
      const deItem = screen.getByText("Deutsch").closest('[role="menuitemcheckbox"]');
      expect(deItem?.getAttribute("aria-checked")).toBe("true");
      const enItem = screen.getByText("English").closest('[role="menuitemcheckbox"]');
      expect(enItem?.getAttribute("aria-checked")).toBe("false");
    });
  });
});
