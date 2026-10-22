// Unit test for policyToStrategy — the mapping between
// retention-strategy and the user-data-rights forget strategy. It determines
// whether data is physically deleted or anonymized; the mapping is the logic,
// not an incidental detail.

import { describe, expect, test } from "bun:test";
import { policyToStrategy } from "../run-forget-cleanup.ts";

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
