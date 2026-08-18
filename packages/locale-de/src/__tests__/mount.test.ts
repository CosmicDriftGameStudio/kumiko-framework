import { describe, expect, test } from "bun:test";
import { localeDe } from "../index";
import { localeDeBundle } from "../strings";
import { localeDeClient } from "../web";

describe("localeDe mount", () => {
  test("client plugin exposes German Save", () => {
    expect(localeDeClient().translations.de["kumiko.actions.save"]).toBe("Speichern");
  });

  test("server feature registers de translations without throwing", () => {
    const feature = localeDe();
    expect(feature.name).toBe("locale-de");
    expect(feature.translations?.["kumiko.actions.save"]?.de).toBe("Speichern");
    expect(localeDeBundle["auth.mail.reset.button"]).toBe("Passwort zurücksetzen");
  });
});
