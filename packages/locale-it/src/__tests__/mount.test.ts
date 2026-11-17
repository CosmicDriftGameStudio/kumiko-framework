import { describe, expect, test } from "bun:test";
import { localeIt } from "../index";
import { localeItBundle } from "../strings";
import { localeItClient } from "../web";

describe("localeIt mount", () => {
  test("client plugin exposes Italian Save", () => {
    expect(localeItClient().translations["it"]["kumiko.actions.save"]).toBe("Salva");
  });

  test("server feature registers it translations without throwing", () => {
    const feature = localeIt();
    expect(feature.name).toBe("locale-it");
    expect(feature.translations?.["kumiko.actions.save"]?.["it"]).toBe("Salva");
    expect(localeItBundle["auth.mail.reset.button"]).toBe("Reimposta la password");
  });
});
