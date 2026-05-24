// Snapshot-Tests fuer KUMIKO_SUB_PROCESSORS. Fangen still-Drift ab —
// jede Aenderung an der Liste muss bewusst durch ein Snapshot-Update
// gehen, damit niemand versehentlich einen Sub-Processor entfernt
// oder hinzufuegt ohne dass die DPA/Tenant-Notification-Pipeline das
// mitbekommt.

import { describe, expect, test } from "bun:test";
import {
  getActiveSubProcessors,
  getPlannedSubProcessors,
  KUMIKO_SUB_PROCESSORS,
} from "../sub-processors";

describe("KUMIKO_SUB_PROCESSORS", () => {
  test("Liste ist nicht leer (Plattform hat mindestens Hetzner+Cloudflare)", () => {
    expect(KUMIKO_SUB_PROCESSORS.length).toBeGreaterThan(0);
  });

  test("Alle Eintraege haben Pflicht-Felder (name, purpose, region, dpa, addedAt, appliesTo)", () => {
    for (const sp of KUMIKO_SUB_PROCESSORS) {
      expect(sp.name).toBeTruthy();
      expect(sp.purpose).toBeTruthy();
      expect(sp.region).toBeTruthy();
      expect(sp.dpa).toMatch(/^https?:\/\//);
      expect(sp.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(sp.appliesTo.length).toBeGreaterThan(0);
    }
  });

  test("US-Sub-Processors haben sccRequired: true (DSGVO Art. 44+ Drittland)", () => {
    const usProcessors = KUMIKO_SUB_PROCESSORS.filter(
      (sp) => sp.region.includes("US") && !sp.region.startsWith("EU"),
    );
    for (const sp of usProcessors) {
      expect(
        sp.sccRequired,
        `Sub-Processor "${sp.name}" with US-region should have sccRequired: true`,
      ).toBe(true);
    }
  });

  test("Snapshot — explizit zu updaten bei jeder Liste-Aenderung", () => {
    const summary = KUMIKO_SUB_PROCESSORS.map((sp) => ({
      name: sp.name,
      region: sp.region,
      status: sp.status ?? "active",
      appliesTo: sp.appliesTo,
      sccRequired: sp.sccRequired ?? false,
      optInOnly: sp.optInOnly ?? false,
    }));
    expect(summary).toMatchInlineSnapshot(`
      [
        {
          "appliesTo": [
            "all-tiers",
          ],
          "name": "Hetzner Online GmbH",
          "optInOnly": false,
          "region": "EU (Germany)",
          "sccRequired": false,
          "status": "active",
        },
        {
          "appliesTo": [
            "all-tiers",
          ],
          "name": "Cloudflare, Inc.",
          "optInOnly": false,
          "region": "Global (US-headquartered)",
          "sccRequired": true,
          "status": "active",
        },
        {
          "appliesTo": [
            "standard",
            "business",
            "enterprise",
          ],
          "name": "Sendinblue SAS (Brevo)",
          "optInOnly": false,
          "region": "EU (France)",
          "sccRequired": false,
          "status": "active",
        },
        {
          "appliesTo": [
            "all-tiers",
          ],
          "name": "Heinlein Hosting (Mailbox.org)",
          "optInOnly": false,
          "region": "EU (Germany)",
          "sccRequired": false,
          "status": "active",
        },
        {
          "appliesTo": [
            "business",
            "enterprise",
          ],
          "name": "Anthropic PBC",
          "optInOnly": true,
          "region": "US",
          "sccRequired": true,
          "status": "planned",
        },
        {
          "appliesTo": [
            "all-tiers",
          ],
          "name": "Stripe, Inc.",
          "optInOnly": false,
          "region": "Global (US-headquartered)",
          "sccRequired": true,
          "status": "planned",
        },
      ]
    `);
  });
});

describe("getActiveSubProcessors / getPlannedSubProcessors", () => {
  test("active + planned partitionieren die Gesamt-Liste vollstaendig", () => {
    const active = getActiveSubProcessors();
    const planned = getPlannedSubProcessors();
    expect(active.length + planned.length).toBe(KUMIKO_SUB_PROCESSORS.length);
  });

  test("kein Sub-Processor in active hat status=planned", () => {
    for (const sp of getActiveSubProcessors()) {
      expect(sp.status).not.toBe("planned");
    }
  });

  test("alle planned-Eintraege haben status=planned", () => {
    for (const sp of getPlannedSubProcessors()) {
      expect(sp.status).toBe("planned");
    }
  });
});
