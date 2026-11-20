import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { localeFrBundle } from "@cosmicdrift/kumiko-locale-fr";
import { localeItBundle } from "@cosmicdrift/kumiko-locale-it";
import * as authErrors from "../../errors.ts";
import { defaultTranslations } from "../i18n.ts";

const errorFactories: readonly (() => { readonly error: { readonly i18nKey?: string } })[] =
  Object.values(authErrors).map((factory) => () => factory(1));

const i18nKeys = errorFactories.map((make) => make().error.i18nKey ?? "");

const bundles: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  en: defaultTranslations["en"] ?? {},
  de: localeDeBundle,
  es: localeEsBundle,
  fr: localeFrBundle,
  it: localeItBundle,
};

describe("AuthErrors i18n keys exist in every locale bundle", () => {
  test("every errors.ts factory carries an auth.errors key", () => {
    expect(i18nKeys.length).toBeGreaterThan(0);
    expect(i18nKeys.filter((key) => !key.startsWith("auth.errors."))).toEqual([]);
  });

  for (const [locale, bundle] of Object.entries(bundles)) {
    test(`${locale} translates every key`, () => {
      expect(i18nKeys.filter((key) => bundle[key] === undefined)).toEqual([]);
    });
  }
});
