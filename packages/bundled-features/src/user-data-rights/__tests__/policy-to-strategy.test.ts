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

  test("softDelete → delete (Mark the Row via the framework's softDelete mechanism)", () => {
    expect(policyToStrategy("softDelete")).toBe("delete");
  });

  test("anonymize → anonymize (Row remains, PII removed)", () => {
    expect(policyToStrategy("anonymize")).toBe("anonymize");
  });

  test("blockDelete → anonymize (Respect retention requirement, Row remains physically)", () => {
    expect(policyToStrategy("blockDelete")).toBe("anonymize");
  });

  test("null (no policy configured) → delete (Default = Row removed)", () => {
    expect(policyToStrategy(null)).toBe("delete");
  });
});
