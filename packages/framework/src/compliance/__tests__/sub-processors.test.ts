// Snapshot tests for KUMIKO_SUB_PROCESSORS detect silent drift.
// Every list change must intentionally update the snapshot so that
// accidentally adding or removing a sub-processor cannot bypass the
// DPA/tenant-notification pipeline.

import { describe, expect, test } from "bun:test";
import {
  getActiveSubProcessors,
  getPlannedSubProcessors,
  KUMIKO_SUB_PROCESSORS,
} from "../sub-processors.ts";

describe("KUMIKO_SUB_PROCESSORS", () => {
  test("List is not empty (platform has at least Hetzner)", () => {
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

  test("Snapshot — explicitly update whenever the list changes", () => {
    const summary = KUMIKO_SUB_PROCESSORS.map((sp) => ({
      name: sp.name,
      purpose: sp.purpose,
      addedAt: sp.addedAt,
      region: sp.region,
      status: sp.status ?? "active",
      appliesTo: sp.appliesTo,
      sccRequired: sp.sccRequired ?? false,
      optInOnly: sp.optInOnly ?? false,
    }));
    expect(summary).toMatchInlineSnapshot(`
      [
        {
          "addedAt": "2024-01-01",
          "appliesTo": [
            "all-tiers",
          ],
          "name": "Hetzner Online GmbH",
          "optInOnly": false,
          "purpose": "Cloud-Infrastructure (CNPG-Postgres-Cluster, K8s-Pods, Volumes, Object-Storage)",
          "region": "EU (Germany)",
          "sccRequired": false,
          "status": "active",
        },
        {
          "addedAt": "2024-03-01",
          "appliesTo": [
            "standard",
            "business",
            "enterprise",
          ],
          "name": "Sendinblue SAS (Brevo)",
          "optInOnly": false,
          "purpose": "Transactional Email Delivery",
          "region": "EU (France)",
          "sccRequired": false,
          "status": "active",
        },
        {
          "addedAt": "2026-06-01",
          "appliesTo": [
            "business",
            "enterprise",
          ],
          "name": "Anthropic PBC",
          "optInOnly": true,
          "purpose": "AI Model Inference (L2 Composition Layer, AI-Foundation)",
          "region": "US",
          "sccRequired": true,
          "status": "active",
        },
        {
          "addedAt": "2026-06-01",
          "appliesTo": [
            "all-tiers",
          ],
          "name": "Stripe, Inc.",
          "optInOnly": false,
          "purpose": "Payment Processing (Subscription-Stripe-Plugin)",
          "region": "Global (US-headquartered)",
          "sccRequired": true,
          "status": "active",
        },
        {
          "addedAt": "2026-07-04",
          "appliesTo": [
            "all-tiers",
          ],
          "name": "Scaleway SAS",
          "optInOnly": false,
          "purpose": "Platform key custody (Key Manager)",
          "region": "EU (France)",
          "sccRequired": false,
          "status": "active",
        },
        {
          "addedAt": "2026-09-02",
          "appliesTo": [
            "all-tiers",
          ],
          "name": "ALL-INKL.COM – Neue Medien Münnich",
          "optInOnly": false,
          "purpose": "Mailbox Hosting (support and contact mailboxes)",
          "region": "EU (Germany)",
          "sccRequired": false,
          "status": "active",
        },
        {
          "addedAt": "2026-09-18",
          "appliesTo": [
            "all-tiers",
          ],
          "name": "Scaleway SAS",
          "optInOnly": false,
          "purpose": "Offsite Backup Mirror (Object Storage)",
          "region": "EU (France)",
          "sccRequired": false,
          "status": "active",
        },
        {
          "addedAt": "2026-11-01",
          "appliesTo": [
            "all-tiers",
          ],
          "name": "Scaleway SAS",
          "optInOnly": false,
          "purpose": "Transactional Email Delivery (TEM)",
          "region": "EU (France)",
          "sccRequired": false,
          "status": "active",
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

  test("No active sub-processor has status=planned", () => {
    for (const sp of getActiveSubProcessors()) {
      expect(sp.status).not.toBe("planned");
    }
  });

  test("alle planned-Eintraege haben status=planned", () => {
    for (const sp of getPlannedSubProcessors()) {
      expect(sp.status).toBe("planned");
    }
  });

  test("Scaleway: Backup Mirror, Key Manager and Transactional Email are all active", () => {
    const active = getActiveSubProcessors().filter((sp) => sp.name === "Scaleway SAS");
    const planned = getPlannedSubProcessors().filter((sp) => sp.name === "Scaleway SAS");
    expect(active.map((sp) => sp.purpose)).toEqual([
      "Platform key custody (Key Manager)",
      "Offsite Backup Mirror (Object Storage)",
      "Transactional Email Delivery (TEM)",
    ]);
    expect(planned).toHaveLength(0);
  });
});
