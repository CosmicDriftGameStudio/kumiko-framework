// Tests for compliance-profile constants and the extends resolver.
//
// Edge cases:
//   1. Default fallback for selection=undefined → minimal-no-region + warning
//   2. extends chain limited to one level (cycle/depth protection)
//   3. Deep-merge semantics for overrides (recursive, not top-level replacement)
//   4. Overrides can set individual fields without dropping required fields

import { describe, expect, test } from "bun:test";
import { complianceProfileOverrideSchema } from "../override-schema.ts";
import {
  COMPLIANCE_PROFILES,
  resolveComplianceProfile,
  SELECTABLE_PROFILE_KEYS,
} from "../profiles.ts";

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

  test("swiss-dsg extends eu-dsgvo — inherits base fields", () => {
    const p = COMPLIANCE_PROFILES["swiss-dsg"];
    expect(p.key).toBe("swiss-dsg");
    expect(p.region).toBe("CH");
    // Override: andere Sprachen + andere Aufsicht
    expect(p.notifications.languages).toEqual(["de", "fr", "it", "en"]);
    expect(p.breach.authorityContact).toBe("EDÖB Bern");
    // Inherited from eu-dsgvo
    expect(p.userRights.gracePeriod).toEqual({ days: 30 });
    expect(p.userRights.restrictionAllowed).toBe(true);
    expect(p.tenantDestroyGracePeriod).toEqual({ days: 30 });
  });

  test("de-hr-dsgvo-hgb extends eu-dsgvo — HR override applies, base remains", () => {
    const p = COMPLIANCE_PROFILES["de-hr-dsgvo-hgb"];
    expect(p.region).toBe("DE");
    expect(p.userRights.employeeAccessRight).toBe(true);
    expect(p.breach.worksCouncilNotificationRequired).toBe(true);
    expect(p.subProcessor.worksCouncilApprovalRequired).toBe(true);
    expect(p.auditLog.retention).toEqual({ years: 10 });
    expect(p.tenantDestroyGracePeriod).toEqual({ days: 60 });
    // Inherited: portabilityFormat from eu-dsgvo remains unchanged
    expect(p.userRights.portabilityFormat).toEqual(["json"]);
  });

  test("minimal-no-region is standalone (no extends)", () => {
    const p = COMPLIANCE_PROFILES["minimal-no-region"];
    expect(p.region).toBe("—");
    expect(p.notifications.mandatoryBreachNotification).toBe(false);
    expect(p.breach.authorityNotificationDeadline).toBe("manual");
  });
});

describe("SELECTABLE_PROFILE_KEYS", () => {
  test('contains 3 profiles, without "minimal-no-region" (no production default)', () => {
    expect(SELECTABLE_PROFILE_KEYS).toEqual(["eu-dsgvo", "swiss-dsg", "de-hr-dsgvo-hgb"]);
    expect(SELECTABLE_PROFILE_KEYS).not.toContain("minimal-no-region");
  });
});

describe("complianceProfileOverrideSchema — Schema↔Profile-Konsistenz (S1.10 M2)", () => {
  // If the profile type gains a new sub-property in userRights, breach,
  // auditLog, etc. without a corresponding update to override-schema.ts, this
  // test fails. A fully resolved profile is a trivially valid override object;
  // rejection means the schema and profile type are out of sync or the schema
  // is stricter than the profile type.
  test("Schema accepts a fully resolved profile as an override (drift guard)", () => {
    // Remove identification fields because they cannot be overridden.
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

  test("Schema also accepts swiss-dsg + de-hr-dsgvo-hgb (extends profiles with override fields)", () => {
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

  test("selection=minimal-no-region (DB edge case) → no warning, fallback active", () => {
    // minimal-no-region can no longer be set through set-profile. If the state
    // nevertheless exists in the DB (migration or direct insert), the minimal
    // profile is returned; the needs-profile banner endpoint separately marks it
    // as "needsSelection=true". The resolver emits no warning because the
    // selection is explicit.
    const result = resolveComplianceProfile({ selection: "minimal-no-region" });
    expect(result.profile.key).toBe("minimal-no-region");
    expect(result.warning).toBeUndefined();
  });

  test("selection=eu-dsgvo + no override → no warning", () => {
    const result = resolveComplianceProfile({ selection: "eu-dsgvo" });
    expect(result.profile.key).toBe("eu-dsgvo");
    expect(result.warning).toBeUndefined();
  });
});

describe("resolveComplianceProfile — Override deep-merge", () => {
  test("Override gracePeriod.days overrides recursively, other userRights remain", () => {
    const result = resolveComplianceProfile({
      selection: "eu-dsgvo",
      override: {
        userRights: { gracePeriod: { days: 60 } },
      },
    });
    expect(result.profile.userRights.gracePeriod).toEqual({ days: 60 });
    expect(result.profile.userRights.restrictionAllowed).toBe(true);
    expect(result.profile.userRights.objectionAllowed).toBe(true);
    expect(result.profile.userRights.portabilityFormat).toEqual(["json"]);
    expect(result.profile.userRights.auskunftFrist).toEqual({ days: 30 });
  });

  test("Override breach.authorityContact changes only this path", () => {
    const result = resolveComplianceProfile({
      selection: "eu-dsgvo",
      override: {
        breach: { authorityContact: "Hamburgischer DSB" },
      },
    });
    expect(result.profile.breach.authorityContact).toBe("Hamburgischer DSB");
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

  test("Atomic path: retention {months} → {years} replaces completely (no object merge)", () => {
    // Without this, deepMerge on discriminated-union objects would produce
    // { months: 24, years: 10 }, which is semantically invalid because retention
    // must be exactly one choice.
    const result = resolveComplianceProfile({
      selection: "eu-dsgvo",
      override: {
        auditLog: { retention: { years: 10 } },
      },
    });
    expect(result.profile.auditLog.retention).toEqual({ years: 10 });
    // reportFrequency must not be replaced: auditLog is non-atomic, and only
    // retention within it is atomic.
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

  test("Array property in the override replaces completely (top-level replace, no concat)", () => {
    const result = resolveComplianceProfile({
      selection: "eu-dsgvo",
      override: {
        notifications: { languages: ["en"] },
      },
    });
    // Replace rather than append: ["de", "en"] becomes ["en"]
    expect(result.profile.notifications.languages).toEqual(["en"]);
    // Andere notifications-Felder bleiben
    expect(result.profile.notifications.mandatoryBreachNotification).toBe(true);
  });
});

describe("Profile definition snapshots — catches drift", () => {
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
