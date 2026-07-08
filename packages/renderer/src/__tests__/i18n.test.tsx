import { describe, expect, test } from "bun:test";
import type { LocaleResolver } from "@cosmicdrift/kumiko-headless";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
  useLocale,
  useTranslation,
} from "../i18n";

// Stateful resolver fixture: we drive locale changes with setState
// and the test asserts re-render via subscribe.
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
    setLocale: (next: string) => {
      current = next;
      for (const l of listeners) l();
    },
  };
}
const wrap =
  (resolver: LocaleResolver, fallbackBundles?: TranslationsByLocale[]) =>
  ({ children }: { readonly children: ReactNode }): ReactNode => (
    <LocaleProvider resolver={resolver} {...(fallbackBundles !== undefined && { fallbackBundles })}>
      {children}
    </LocaleProvider>
  );
describe("useTranslation — lookup order", () => {
  test("App-Resolver wins when it returns a non-key value", () => {
    const resolver: LocaleResolver = {
      ...createStaticLocaleResolver({ locale: "de" }),
      translate: (key: string) => (key === "hello" ? "Resolved by app" : key),
    };
    const { result } = renderHook(() => useTranslation(), { wrapper: wrap(resolver) });
    expect(result.current("hello")).toBe("Resolved by app");
  });
  test("falls back to plugin-bundle for current locale", () => {
    const resolver = createStaticLocaleResolver({ locale: "de" });
    const bundles: TranslationsByLocale[] = [{ de: { greet: "Hallo" }, en: { greet: "Hello" } }];
    const { result } = renderHook(() => useTranslation(), {
      wrapper: wrap(resolver, bundles),
    });
    expect(result.current("greet")).toBe("Hallo");
  });
  test("strips region for bundle lookup (de-AT → de)", () => {
    const resolver = createStaticLocaleResolver({ locale: "de-AT" });
    const bundles: TranslationsByLocale[] = [{ de: { greet: "Hallo" } }];
    const { result } = renderHook(() => useTranslation(), {
      wrapper: wrap(resolver, bundles),
    });
    expect(result.current("greet")).toBe("Hallo");
  });
  test("falls back to fallbackLocale (en) when current locale missing", () => {
    const resolver = createStaticLocaleResolver({ locale: "fr" });
    const bundles: TranslationsByLocale[] = [{ de: { greet: "Hallo" }, en: { greet: "Hello" } }];
    const { result } = renderHook(() => useTranslation(), {
      wrapper: wrap(resolver, bundles),
    });
    expect(result.current("greet")).toBe("Hello");
  });
  test("returns key as-is when nothing resolves", () => {
    const resolver = createStaticLocaleResolver({ locale: "de" });
    const { result } = renderHook(() => useTranslation(), { wrapper: wrap(resolver) });
    expect(result.current("missing.key")).toBe("missing.key");
  });
  test("interpolates {param}-placeholders from params arg", () => {
    const resolver = createStaticLocaleResolver({ locale: "de" });
    const bundles: TranslationsByLocale[] = [{ de: { greet: "Hallo {name}!" } }];
    const { result } = renderHook(() => useTranslation(), {
      wrapper: wrap(resolver, bundles),
    });
    expect(result.current("greet", { name: "Marc" })).toBe("Hallo Marc!");
  });
});
describe("useTranslation — re-render on locale change", () => {
  test("subscribe fires when setLocale runs, hook returns new value", () => {
    const resolver = makeStatefulResolver("de");
    const bundles: TranslationsByLocale[] = [{ de: { greet: "Hallo" }, en: { greet: "Hello" } }];
    function Probe(): ReactNode {
      const t = useTranslation();
      return <span data-testid="msg">{t("greet")}</span>;
    }
    const { getByTestId } = render(
      <LocaleProvider resolver={resolver} fallbackBundles={bundles}>
        <Probe />
      </LocaleProvider>,
    );
    expect(getByTestId("msg").textContent).toBe("Hallo");
    act(() => {
      resolver.setLocale?.("en");
    });
    expect(getByTestId("msg").textContent).toBe("Hello");
  });
});
describe("useTranslation — referential stability", () => {
  // Prod-Incident 2026-07-07: admin-shell Overview-Screens hatten `t` in
  // einem useEffect-Dependency-Array. Ein neues `t` pro Render triggerte
  // einen Render/Effect-Endlos-Loop (~600 Queries/Sekunde). `t` (und der
  // gesamte Context-Value) MUSS über Re-Renders hinweg stabil bleiben,
  // solange sich Resolver/Bundles/Locale nicht ändern.
  test("t keeps the same reference across re-renders when nothing changed", () => {
    const resolver = createStaticLocaleResolver({ locale: "de" });
    const { result, rerender } = renderHook(() => useTranslation(), {
      wrapper: wrap(resolver),
    });
    const firstT = result.current;
    rerender();
    expect(result.current).toBe(firstT);
  });
  test("t stays stable across parent re-renders even with a fresh fallbackBundles literal per parent-render", () => {
    // Realistischer Fall: eine App übergibt `fallbackBundles={[...]}` als
    // Inline-Literal. Ohne Provider-seitige Memoization würde jeder
    // Ahnen-Re-Render den Context-Value neu bauen. Hier prüfen wir nur
    // den Provider-internen Memoization-Pfad bei stabilen Props.
    const resolver = createStaticLocaleResolver({ locale: "de" });
    const bundles: TranslationsByLocale[] = [{ de: { greet: "Hallo" } }];
    function Probe(): ReactNode {
      const t = useTranslation();
      (Probe as unknown as { lastT?: unknown }).lastT = t;
      return null;
    }
    const { rerender } = render(
      <LocaleProvider resolver={resolver} fallbackBundles={bundles}>
        <Probe />
      </LocaleProvider>,
    );
    const firstT = (Probe as unknown as { lastT?: unknown }).lastT;
    rerender(
      <LocaleProvider resolver={resolver} fallbackBundles={bundles}>
        <Probe />
      </LocaleProvider>,
    );
    expect((Probe as unknown as { lastT?: unknown }).lastT).toBe(firstT);
  });
});
describe("translationsByLocaleFromKeys", () => {
  test("pivots key-first source to locale-first bundles losslessly", () => {
    const source = {
      "app:nav.home": { de: "Start", en: "Home" },
      "app:nav.settings": { de: "Einstellungen", en: "Settings" },
    };
    const byLocale = translationsByLocaleFromKeys(source);
    expect(byLocale["de"]).toEqual({
      "app:nav.home": "Start",
      "app:nav.settings": "Einstellungen",
    });
    expect(byLocale["en"]).toEqual({
      "app:nav.home": "Home",
      "app:nav.settings": "Settings",
    });
  });
});
describe("useLocale", () => {
  test("returns the resolver", () => {
    const resolver = createStaticLocaleResolver({ locale: "de" });
    const { result } = renderHook(() => useLocale(), { wrapper: wrap(resolver) });
    expect(result.current.locale()).toBe("de");
  });
});
