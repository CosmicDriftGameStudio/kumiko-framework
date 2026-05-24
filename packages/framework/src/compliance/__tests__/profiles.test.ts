// Tests fuer Compliance-Profile-Constants + extends-Resolver.
//
// Edge-Cases (advisor-pinned 2026-05-06):
//   1. Default-Fallback bei selection=undefined → minimal-no-region + warning
//   2. extends-Chain max 1 Level (Cycle-/Tiefe-Schutz)
//   3. Deep-merge-Semantik beim Override (rekursiv, Top-Level-Replace nicht)
//   4. Override darf einzelne Felder gezielt setzen ohne Required-Drops

import { describe, expect, test } from "bun:test";
import { complianceProfileOverrideSchema } from "../override-schema";
import {
  COMPLIANCE_PROFILES,
  OVERRIDABLE_PROFILE_KEYS,
  resolveComplianceProfile,
  SELECTABLE_PROFILE_KEYS,
} from "../profiles";

// Identifikations-Keys die ein Override NICHT modifizieren darf — sie
// definieren die Profile-Identität. Werden vom Drift-Test ausgeschlossen.
const IDENTIFICATION_KEYS = new Set(["key", "region", "label", "extends"]);

describe("COMPLIANCE_PROFILES — Pre-baked", () => {
  test("eu-dsgvo hat alle Required-Felder", () => {
    const p = COMPLIANCE_PROFILES["eu-dsgvo"];
    expect(p.key).toBe("eu-dsgvo");
    expect(p.region).toBe("EU");
    expect(p.userRights.gracePeriod).toEqual({ days: 30 });
    expect(p.notifications.languages).toContain("de");
    expect(p.breach.authorityContact).toBe("BlnBDI Berlin");
    expect(p.tenantDestroyGracePeriod).toEqual({ days: 30 });
  });

  test("swiss-dsg extends eu-dsgvo — übernimmt Base-Felder", () => {
    const p = COMPLIANCE_PROFILES["swiss-dsg"];
    expect(p.key).toBe("swiss-dsg");
    expect(p.region).toBe("CH");
    // Override: andere Sprachen + andere Aufsicht
    expect(p.notifications.languages).toEqual(["de", "fr", "it", "en"]);
    expect(p.breach.authorityContact).toBe("EDÖB Bern");
    // Geerbt von eu-dsgvo
    expect(p.userRights.gracePeriod).toEqual({ days: 30 });
    expect(p.userRights.restrictionAllowed).toBe(true);
    expect(p.tenantDestroyGracePeriod).toEqual({ days: 30 });
  });

  test("de-hr-dsgvo-hgb extends eu-dsgvo — HR-Override greift, Base bleibt", () => {
    const p = COMPLIANCE_PROFILES["de-hr-dsgvo-hgb"];
    expect(p.region).toBe("DE");
    expect(p.userRights.employeeAccessRight).toBe(true);
    expect(p.breach.worksCouncilNotificationRequired).toBe(true);
    expect(p.subProcessor.worksCouncilApprovalRequired).toBe(true);
    expect(p.auditLog.retention).toEqual({ years: 10 });
    expect(p.tenantDestroyGracePeriod).toEqual({ days: 60 });
    // Geerbt: portabilityFormat aus eu-dsgvo bleibt
    expect(p.userRights.portabilityFormat).toEqual(["json"]);
  });

  test("minimal-no-region ist eigenständig (kein extends)", () => {
    const p = COMPLIANCE_PROFILES["minimal-no-region"];
    expect(p.region).toBe("—");
    expect(p.notifications.mandatoryBreachNotification).toBe(false);
    expect(p.breach.authorityNotificationDeadline).toBe("manual");
  });
});

describe("SELECTABLE_PROFILE_KEYS", () => {
  test('enthält 3 Profile, ohne "minimal-no-region" (kein Production-Default)', () => {
    expect(SELECTABLE_PROFILE_KEYS).toEqual(["eu-dsgvo", "swiss-dsg", "de-hr-dsgvo-hgb"]);
    expect(SELECTABLE_PROFILE_KEYS).not.toContain("minimal-no-region");
  });
});

describe("OVERRIDABLE_PROFILE_KEYS — Drift-Guard (S1.8 N2)", () => {
  // Wenn ein neues Top-Level-Property zu ComplianceProfile kommt
  // (oder eines wegfaellt), muss OVERRIDABLE_PROFILE_KEYS synchron
  // gehalten werden — sonst lehnt set-profile valide Overrides ab
  // ODER akzeptiert ungueltige. Dieser Test detektiert den Drift in
  // beide Richtungen anhand des voll aufgeloesten eu-dsgvo-Profile.
  test("Override-Whitelist matched die uebrigen Top-Level-Keys von eu-dsgvo (minus Identifikations-Felder)", () => {
    const allTopLevelKeys = new Set(Object.keys(COMPLIANCE_PROFILES["eu-dsgvo"]));
    for (const idKey of IDENTIFICATION_KEYS) {
      allTopLevelKeys.delete(idKey);
    }
    const expected = [...allTopLevelKeys].sort();
    const actual = [...OVERRIDABLE_PROFILE_KEYS].sort();
    expect(actual).toEqual(expected);
  });

  test("Identifikations-Keys (key, region, label, extends) sind NICHT in OVERRIDABLE_PROFILE_KEYS", () => {
    for (const idKey of IDENTIFICATION_KEYS) {
      expect(OVERRIDABLE_PROFILE_KEYS.has(idKey)).toBe(false);
    }
  });
});

describe("complianceProfileOverrideSchema — Schema↔Profile-Konsistenz (S1.10 M2)", () => {
  // Wenn Profile-Type erweitert wird (neues Sub-Property in userRights /
  // breach / auditLog / etc.) ohne dass override-schema.ts mitgepflegt
  // wird, fail dieser Test. Prinzip: ein voll aufgelöstes Profile ist
  // ein triviales valides Override-Object — wenn Schema das ablehnt, ist
  // entweder Schema oder Profile out of sync.
  test("Schema akzeptiert ein vollständig aufgelöstes Profile als Override (Drift-Guard)", () => {
    // Identifikations-Felder rausnehmen weil die nicht override-bar sind.
    const fullProfile = COMPLIANCE_PROFILES["eu-dsgvo"];
    const {
      key: _key,
      region: _region,
      label: _label,
      extends: _extends,
      ...overridable
    } = fullProfile;

    const result = complianceProfileOverrideSchema.safeParse(overridable);
    if (!result.success) {
      throw new Error(
        `Schema↔Profile-Drift: vollständig aufgelöstes eu-dsgvo wird vom Override-Schema abgelehnt. ` +
          `Issue at "${result.error.issues[0]?.path.join(".")}": ${result.error.issues[0]?.message}. ` +
          "Entweder ComplianceProfile-Type erweitert ohne Schema-Update, oder Schema strikter als Profile-Type.",
      );
    }
    expect(result.success).toBe(true);
  });

  test("Schema akzeptiert auch swiss-dsg + de-hr-dsgvo-hgb (extends-Profile mit Override-Feldern)", () => {
    for (const key of ["swiss-dsg", "de-hr-dsgvo-hgb"] as const) {
      const fullProfile = COMPLIANCE_PROFILES[key];
      const {
        key: _key,
        region: _region,
        label: _label,
        extends: _extends,
        ...overridable
      } = fullProfile;
      const result = complianceProfileOverrideSchema.safeParse(overridable);
      expect(result.success, `Schema lehnt voll aufgelöstes ${key} ab`).toBe(true);
    }
  });
});

describe("resolveComplianceProfile — Default-Fallback", () => {
  test("selection=undefined → minimal-no-region + warning=no-profile-selected", () => {
    const result = resolveComplianceProfile({});
    expect(result.profile.key).toBe("minimal-no-region");
    expect(result.warning).toBe("no-profile-selected");
  });

  test("selection=minimal-no-region (DB-Edge-Case) → kein warning, fallback aktiv", () => {
    // Sprint 1.7 X1: minimal-no-region ist ueber set-profile nicht mehr
    // setzbar. Wer den State trotzdem in der DB hat (Migration, Direct-
    // Insert) bekommt das minimal-Profile zurueck — der needs-profile-
    // Banner-Endpoint markiert ihn separat als "needsSelection=true".
    // Resolver selber zieht keine warning, weil "explicit selection".
    const result = resolveComplianceProfile({ selection: "minimal-no-region" });
    expect(result.profile.key).toBe("minimal-no-region");
    expect(result.warning).toBeUndefined();
  });

  test("selection=eu-dsgvo + kein override → keine warning", () => {
    const result = resolveComplianceProfile({ selection: "eu-dsgvo" });
    expect(result.profile.key).toBe("eu-dsgvo");
    expect(result.warning).toBeUndefined();
  });
});

describe("resolveComplianceProfile — Override deep-merge", () => {
  test("Override gracePeriod.days überschreibt rekursiv, andere userRights bleiben", () => {
    const result = resolveComplianceProfile({
      selection: "eu-dsgvo",
      override: {
        userRights: { gracePeriod: { days: 60 } },
      },
    });
    expect(result.profile.userRights.gracePeriod).toEqual({ days: 60 });
    // Andere userRights-Felder unverändert
    expect(result.profile.userRights.restrictionAllowed).toBe(true);
    expect(result.profile.userRights.objectionAllowed).toBe(true);
    expect(result.profile.userRights.portabilityFormat).toEqual(["json"]);
    expect(result.profile.userRights.auskunftFrist).toEqual({ days: 30 });
  });

  test("Override breach.authorityContact ändert nur diesen einen Pfad", () => {
    const result = resolveComplianceProfile({
      selection: "eu-dsgvo",
      override: {
        breach: { authorityContact: "Hamburgischer DSB" },
      },
    });
    expect(result.profile.breach.authorityContact).toBe("Hamburgischer DSB");
    // Rest des breach-Objects unverändert
    expect(result.profile.breach.authorityNotificationDeadline).toEqual({ hours: 72 });
    expect(result.profile.breach.userNotificationRequired).toBe("if-high-risk");
  });

  test("Override mehrerer Top-Level-Pfade gleichzeitig", () => {
    const result = resolveComplianceProfile({
      selection: "swiss-dsg",
      override: {
        userRights: { gracePeriod: { days: 45 } },
        tenantDestroyGracePeriod: { days: 90 },
      },
    });
    expect(result.profile.userRights.gracePeriod).toEqual({ days: 45 });
    expect(result.profile.tenantDestroyGracePeriod).toEqual({ days: 90 });
    // swiss-dsg extends eu-dsgvo war drin
    expect(result.profile.region).toBe("CH");
    expect(result.profile.breach.authorityContact).toBe("EDÖB Bern");
  });

  test("Atomic path: retention {months} → {years} ersetzt komplett (kein object-merge)", () => {
    // Bug-Regression: deepMerge auf Diskriminierten-Union-Objects
    // wuerde sonst { months: 24, years: 10 } produzieren — semantisch
    // Nonsense, retention ist EINE Wahl.
    const result = resolveComplianceProfile({
      selection: "eu-dsgvo",
      override: {
        auditLog: { retention: { years: 10 } },
      },
    });
    expect(result.profile.auditLog.retention).toEqual({ years: 10 });
    // reportFrequency darf NICHT mit ersetzt werden — auditLog ist
    // nicht atomic, nur retention darunter.
    expect(result.profile.auditLog.reportFrequency).toBe("quarterly");
  });

  test("Atomic path: gracePeriod {days} → {hours} ersetzt komplett", () => {
    const result = resolveComplianceProfile({
      selection: "eu-dsgvo",
      override: {
        userRights: { gracePeriod: { hours: 24 } },
      },
    });
    expect(result.profile.userRights.gracePeriod).toEqual({ hours: 24 });
    expect(result.profile.userRights.gracePeriod).not.toHaveProperty("days");
  });

  test("Array-Property im Override ersetzt komplett (Top-Level-Replace, kein concat)", () => {
    const result = resolveComplianceProfile({
      selection: "eu-dsgvo",
      override: {
        notifications: { languages: ["en"] },
      },
    });
    // Replace, nicht append: ["de", "en"] wird zu ["en"]
    expect(result.profile.notifications.languages).toEqual(["en"]);
    // Andere notifications-Felder bleiben
    expect(result.profile.notifications.mandatoryBreachNotification).toBe(true);
  });
});

describe("Profile-Definition-Snapshots — fängt Drift ab", () => {
  test("eu-dsgvo voll-resolved", () => {
    expect(COMPLIANCE_PROFILES["eu-dsgvo"]).toMatchInlineSnapshot(`
      {
        "auditLog": {
          "reportFrequency": "quarterly",
          "retention": {
            "months": 24,
          },
        },
        "breach": {
          "authorityContact": "BlnBDI Berlin",
          "authorityNotificationDeadline": {
            "hours": 72,
          },
          "userNotificationRequired": "if-high-risk",
        },
        "forgetDiscovery": {
          "enabled": false,
        },
        "key": "eu-dsgvo",
        "label": "EU — DSGVO Standard",
        "notifications": {
          "languages": [
            "de",
            "en",
          ],
          "mandatoryBreachNotification": true,
        },
        "region": "EU",
        "subProcessor": {
          "changeNotificationLeadDays": 30,
          "consentRequired": false,
        },
        "tenantDestroyGracePeriod": {
          "days": 30,
        },
        "userRights": {
          "auskunftFrist": {
            "days": 30,
          },
          "exportDownloadTtl": {
            "days": 7,
          },
          "exportStaleTimeoutMinutes": 30,
          "exportStorageCleanupGraceHours": 24,
          "gracePeriod": {
            "days": 30,
          },
          "objectionAllowed": true,
          "portabilityFormat": [
            "json",
          ],
          "restrictionAllowed": true,
        },
      }
    `);
  });
});
