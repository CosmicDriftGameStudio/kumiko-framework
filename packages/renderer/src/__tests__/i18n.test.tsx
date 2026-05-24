import type { LocaleResolver } from "@cosmicdrift/kumiko-headless";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  type TranslationsByLocale,
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
describe("useLocale", () => {
  test("returns the resolver", () => {
    const resolver = createStaticLocaleResolver({ locale: "de" });
    const { result } = renderHook(() => useLocale(), { wrapper: wrap(resolver) });
    expect(result.current.locale()).toBe("de");
  });
});
