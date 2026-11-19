import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { localeFrBundle } from "@cosmicdrift/kumiko-locale-fr";
import { localeItBundle } from "@cosmicdrift/kumiko-locale-it";
import { LAYOUT_PRESETS } from "../constants.ts";
import { BRANDING_I18N } from "../web/i18n.ts";

// The settings select resolves `<field>:option:<value>`; a missing key shows the raw preset id.
const optionKey = (preset: string): string =>
  `branding:entity:__config-edit__:field:layoutPreset:option:${preset}`;

describe("branding layout preset labels", () => {
  test("every preset has a label in en and every locale package", () => {
    const bundles: Record<string, Readonly<Record<string, string>>> = {
      en: Object.fromEntries(Object.entries(BRANDING_I18N).map(([k, v]) => [k, v.en])),
      de: localeDeBundle,
      es: localeEsBundle,
      fr: localeFrBundle,
      it: localeItBundle,
    };
    const missing = Object.entries(bundles).flatMap(([locale, bundle]) =>
      LAYOUT_PRESETS.filter((preset) => bundle[optionKey(preset)] === undefined).map(
        (preset) => `${locale}:${preset}`,
      ),
    );
    expect(missing).toEqual([]);
  });
});
