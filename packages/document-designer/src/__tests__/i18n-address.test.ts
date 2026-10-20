import { describe, expect, test } from "bun:test";
import { DOCUMENT_DESIGNER_I18N } from "../i18n";
import { documentDesignerTranslations } from "../web/default-translations";

// Default German is informal (du); the formal variant lives in locale-de's
// formal overrides.
const formalAddressRegex =
  /\b(Ihr\w*|Ihnen|(Speichern|Nutzen|Laden|Wählen|Geben|Verwenden|Klicken|Prüfen|Legen|Fügen|Löschen|Bestätigen|Verwerfen|Bearbeiten|Öffnen|Setzen|Ziehen|Versuchen) Sie|Sie (sehen|können|müssen|haben|sind|werden|wollen|möchten|erhalten|benötigen))\b/;

describe("document-designer German strings", () => {
  test("bundle uses du, not Sie", () => {
    const offenders = Object.entries(DOCUMENT_DESIGNER_I18N)
      .filter(([, value]) => formalAddressRegex.test(value.de))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  test("web translations use du, not Sie", () => {
    const offenders = Object.entries(documentDesignerTranslations["de"] ?? {})
      .filter(([, value]) => typeof value === "string" && formalAddressRegex.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});
