import { describe, expect, test } from "bun:test";
import { DEFAULT_LOCALES } from "@cosmicdrift/kumiko-framework/engine";
import { buildTenantSettingsKeys } from "../config";

describe("buildTenantSettingsKeys — locale", () => {
  test("defaults to a select field with the engine's DEFAULT_LOCALES", () => {
    const { locale } = buildTenantSettingsKeys();
    if (locale?.type !== "select") throw new Error("expected select");

    expect(locale.options).toEqual(DEFAULT_LOCALES);
  });

  test("passes through a custom locales list", () => {
    const { locale } = buildTenantSettingsKeys({ locales: ["de", "en", "fr"] });
    if (locale?.type !== "select") throw new Error("expected select");

    expect(locale.options).toEqual(["de", "en", "fr"]);
  });
});
