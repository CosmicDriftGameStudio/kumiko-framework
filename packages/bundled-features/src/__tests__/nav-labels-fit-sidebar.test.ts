import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { localeFrBundle } from "@cosmicdrift/kumiko-locale-fr";
import { localeItBundle } from "@cosmicdrift/kumiko-locale-it";

// A nested sidebar entry at the default width shows about this many characters before it ends in "…".
const NAV_LABEL_MAX_CHARS = 26;

const BUNDLES = {
  de: localeDeBundle,
  es: localeEsBundle,
  fr: localeFrBundle,
  it: localeItBundle,
};

describe("bundled nav labels", () => {
  test("fit a nested sidebar entry in every locale", () => {
    const tooLong = Object.entries(BUNDLES).flatMap(([locale, bundle]) =>
      Object.entries(bundle)
        .filter(([key, value]) => key.includes(":nav.") && value.length > NAV_LABEL_MAX_CHARS)
        .map(([key, value]) => `${locale} ${key}: ${value}`),
    );
    expect(tooLong).toEqual([]);
  });
});
