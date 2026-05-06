// Boot-Validator-Tests für PII-Annotations + Retention (S0.2).
//
// Pflicht-Validierungen (Error / throw):
//   - Mutual exclusion: pii / userOwned / tenantOwned exklusiv pro Feld.
//   - userOwned.ownerField muss existieren + ein reference-Feld sein.
//   - retention.reference muss auf existierendes Feld oder Framework-
//     Timestamp (createdAt/updatedAt/lastSeenAt/deletedAt) zeigen.
//
// Heuristik-Warnings (console.warn, kein throw):
//   - Field-Name email/name/phone etc. ohne pii-Annotation.
//   - Field-Name body/text/content etc. ohne userOwned-Annotation.
//   - blockDelete-Strategy ohne anonymize-Felder.
//   - userOwned.ownerField zeigt auf reference, target ist NICHT user.
//
// allowPlaintext-Marker unterdrückt Heuristik-Warnings.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createLongTextField, createTextField } from "../factories";

// Stubt einen leeren `<entity>:list`-Query-Handler damit der reference-
// Field-Boot-Validator den Audit-Fix-#2-Check durchläßt. Wird gebraucht
// wenn ein Test ein reference-Feld benutzt — sonst liefert der validator
// "no list-query-handler is registered there".
// biome-ignore lint/suspicious/noExplicitAny: Registrar-Typ ist generisch, hier reicht das.
function stubListHandler(r: any, entityName: string): void {
  r.queryHandler({
    name: `${entityName}:list`,
    schema: z.object({}),
    handler: async () => ({ rows: [], nextCursor: null }) as never,
    access: { openToAll: true },
  });
}

describe("validateBoot — PII annotations", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("pii: true passes on text field", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            email: createTextField({ pii: true }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("tenantOwned: true passes on text field", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "branding",
        createEntity({
          fields: {
            brandColor: createTextField({ tenantOwned: true }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("userOwned with valid ownerField on reference passes", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ fields: { email: createTextField({ pii: true }) } }));
      stubListHandler(r, "user");
      r.entity(
        "comment",
        createEntity({
          fields: {
            body: createLongTextField({ userOwned: { ownerField: "authorId" } }),
            authorId: { type: "reference", entity: "user" },
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("multiple subject annotations on same field throw", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "thing",
        createEntity({
          fields: {
            confused: createTextField({ pii: true, tenantOwned: true }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(/multiple subject-key annotations/);
  });

  test("userOwned.ownerField pointing to non-existent field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "comment",
        createEntity({
          fields: {
            body: createLongTextField({ userOwned: { ownerField: "ghostField" } }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(
      /userOwned\.ownerField "ghostField" but no such field exists/,
    );
  });

  test("userOwned.ownerField pointing to non-reference field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "comment",
        createEntity({
          fields: {
            body: createLongTextField({ userOwned: { ownerField: "authorName" } }),
            authorName: createTextField(),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(/must be a reference field, got type "text"/);
  });

  test("userOwned.ownerField referencing non-user entity warns", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("employee", createEntity({ fields: { name: createTextField() } }));
      stubListHandler(r, "employee");
      r.entity(
        "personalNote",
        createEntity({
          fields: {
            body: createLongTextField({ userOwned: { ownerField: "employeeId" } }),
            employeeId: { type: "reference", entity: "employee" },
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes('targets reference "employee"'),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("PII-name heuristic warns when email field has no pii annotation", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "thing",
        createEntity({
          fields: {
            email: createTextField(),
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("user-content-name heuristic warns when body field has no userOwned annotation", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "thing",
        createEntity({
          fields: {
            body: createLongTextField(),
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes("user-content-typical name"),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("allowPlaintext marker silences PII-name heuristic warning", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "company",
        createEntity({
          fields: {
            name: createTextField({ allowPlaintext: "is-business-data" }),
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  test("pii: true on email field silences PII-name heuristic warning", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            email: createTextField({ pii: true }),
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeUndefined();
  });
});

describe("validateBoot — retention", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("retention with hardDelete + valid reference field passes", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "session",
        createEntity({
          fields: {
            lastSeenAt: { type: "timestamp" },
          },
          retention: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("retention.reference pointing to framework createdAt passes", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "auditEvent",
        createEntity({
          fields: {
            note: createTextField(),
          },
          retention: { keepFor: "1y", strategy: "hardDelete", reference: "createdAt" },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("retention.reference pointing to non-existent field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "thing",
        createEntity({
          fields: {
            note: createTextField(),
          },
          retention: { keepFor: "30d", strategy: "hardDelete", reference: "ghostField" },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(
      /retention\.reference "ghostField" does not exist/,
    );
  });

  test("blockDelete without any anonymize-fields warns", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "invoice",
        createEntity({
          fields: {
            invoiceNumber: createTextField({ allowPlaintext: "is-business-data" }),
          },
          retention: { keepFor: "10y", strategy: "blockDelete" },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes('strategy="blockDelete" but no field has an anonymize-function'),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("blockDelete with at least one anonymize-field is silent", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "invoice",
        createEntity({
          fields: {
            invoiceNumber: createTextField({ allowPlaintext: "is-business-data" }),
            customerName: createTextField({
              pii: true,
              anonymize: () => "[ANONYMIZED]",
            }),
          },
          retention: { keepFor: "10y", strategy: "blockDelete" },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes('strategy="blockDelete" but no field has an anonymize-function'),
    );
    expect(matchingWarn).toBeUndefined();
  });
});
