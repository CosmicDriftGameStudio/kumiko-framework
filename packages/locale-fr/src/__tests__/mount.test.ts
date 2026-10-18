import { describe, expect, test } from "bun:test";
import { localeFr } from "../index";
import { localeFrBundle } from "../strings";
import { localeFrClient } from "../web";

describe("localeFr mount", () => {
  test("client plugin exposes French Save", () => {
    expect(localeFrClient().translations["fr"]["kumiko.actions.save"]).toBe("Enregistrer");
  });

  test("server feature registers fr translations without throwing", () => {
    const feature = localeFr();
    expect(feature.name).toBe("locale-fr");
    expect(feature.translations?.["kumiko.actions.save"]?.["fr"]).toBe("Enregistrer");
    expect(localeFrBundle["auth.mail.reset.button"]).toBe("Réinitialiser le mot de passe");
  });
});
