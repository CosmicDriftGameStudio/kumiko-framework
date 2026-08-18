import { describe, expect, test } from "bun:test";
import { localeEs } from "../index";
import { localeEsBundle } from "../strings";
import { localeEsClient } from "../web";

describe("localeEs mount", () => {
  test("client plugin exposes Spanish Save", () => {
    expect(localeEsClient().translations["es"]["kumiko.actions.save"]).toBe("Guardar");
  });

  test("server feature registers es translations without throwing", () => {
    const feature = localeEs();
    expect(feature.name).toBe("locale-es");
    expect(feature.translations?.["kumiko.actions.save"]?.["es"]).toBe("Guardar");
    expect(localeEsBundle["auth.mail.reset.button"]).toBe("Restablecer contraseña");
  });
});
