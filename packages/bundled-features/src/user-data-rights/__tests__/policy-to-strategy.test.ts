// Unit-Test fuer policyToStrategy — die Mapping-Tafel zwischen
// retention-strategy und user-data-rights-Forget-Strategy. Load-bearing
// weil es entscheidet ob Daten physisch geloescht oder anonymisiert
// werden. Memory `feedback_no_fake_tests`: das Mapping IST die Logik,
// nicht ein Detail.

import { describe, expect, test } from "bun:test";
import { policyToStrategy } from "../run-forget-cleanup";

describe("policyToStrategy", () => {
  test("hardDelete → delete (Default-Pfad: Row physisch entfernen)", () => {
    expect(policyToStrategy("hardDelete")).toBe("delete");
  });

  test("softDelete → delete (Row markieren via softDelete-Mechanik des Frameworks)", () => {
    expect(policyToStrategy("softDelete")).toBe("delete");
  });

  test("anonymize → anonymize (Row bleibt, PII raus)", () => {
    expect(policyToStrategy("anonymize")).toBe("anonymize");
  });

  test("blockDelete → anonymize (Aufbewahrungs-Pflicht respektieren, Row bleibt physisch)", () => {
    expect(policyToStrategy("blockDelete")).toBe("anonymize");
  });

  test("null (keine Policy konfiguriert) → delete (Default = Row weg)", () => {
    expect(policyToStrategy(null)).toBe("delete");
  });
});
