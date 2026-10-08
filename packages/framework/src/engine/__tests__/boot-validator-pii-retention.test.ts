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

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import {
  createBooleanField,
  createDateField,
  createEmbeddedField,
  createEntity,
  createFileField,
  createFilesField,
  createImageField,
  createImagesField,
  createLocatedTimestampField,
  createLongTextField,
  createMultiSelectField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
} from "../factories.js";
import type { FieldDefinition, LongTextFieldDef, TextFieldDef } from "../types/index.js";
import { unannotatedLongText, unannotatedText } from "./unannotated-fields.js";

// The new personal/find union can no longer express some flag combinations
// on purpose (e.g. two subjects on one field) — these tests deliberately
// construct the raw, rejected shape to prove the boot-validator still throws.
const rawField = <T>(f: T) => f as unknown as TextFieldDef;
const rawLongTextField = <T>(f: T) => f as unknown as LongTextFieldDef;

// The heuristics under test only fire without a personal stance, which
// the factories cannot produce.

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
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
}

describe("validateBoot — PII annotations", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
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
            email: createTextField({
              personal: "self",
              find: "none",
            }),
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
            brandColor: createTextField({
              personal: "tenant",
              find: "none",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("userOwned with valid ownerField on reference passes", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            email: createTextField({
              personal: "self",
              find: "none",
            }),
          },
        }),
      );
      stubListHandler(r, "user");
      r.entity(
        "comment",
        createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "authorId" },
              find: "none",
            }),
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
            confused: rawField({
              ...unannotatedText,
              pii: true,
              tenantOwned: true,
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(/multiple subject-key annotations/);
  });

  test("naked sensitive (no pii/encrypted) throws — event log needs ciphertext-at-rest (#967)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "vault",
        createEntity({
          fields: {
            apiToken: { ...unannotatedText, sensitive: true },
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(/sensitive: true.*without ciphertext-at-rest/);
  });

  test("sensitive with pii subject annotation passes", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "vault",
        createEntity({
          fields: {
            apiToken: createTextField({
              personal: "self",
              find: "secret",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("sensitive with encrypted passes", () => {
    process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = Buffer.from(
      "0123456789abcdef0123456789abcdef",
    ).toString("base64");
    try {
      const feature = defineFeature("test", (r) => {
        r.entity(
          "vault",
          createEntity({
            fields: {
              apiToken: { ...unannotatedText, sensitive: true, encrypted: true },
            },
          }),
        );
      });
      expect(() => validateBoot([feature])).not.toThrow();
    } finally {
      delete process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
    }
  });

  test("userOwned.ownerField pointing to non-existent field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "comment",
        createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "ghostField" },
              find: "none",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(
      /personal\.of "ghostField" but no such field exists/,
    );
  });

  test("userOwned.ownerField on a text field passes (ES userId-by-convention)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "comment",
        createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "authorId" },
              find: "none",
            }),
            authorId: { ...unannotatedText },
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("userOwned.ownerField pointing to a non-id-capable field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "comment",
        createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "isPublic" },
              find: "none",
            }),
            isPublic: { type: "boolean" },
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(
      /must be a reference or text \(userId\) field, got type "boolean"/,
    );
  });

  test("userOwned.ownerField referencing non-user entity warns", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("employee", createEntity({ fields: { name: { ...unannotatedText } } }));
      stubListHandler(r, "employee");
      r.entity(
        "personalNote",
        createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "employeeId" },
              find: "none",
            }),
            employeeId: { type: "reference", entity: "employee" },
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
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
            email: { ...unannotatedText },
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
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
            body: { ...unannotatedLongText },
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("user-content-typical name"),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("user-reference-name heuristic warns when authorId field has no subjectRef annotation", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "thing",
        createEntity({
          fields: {
            authorId: { ...unannotatedText },
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("user-reference-typical name"),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("subjectRef: true on authorId field silences user-reference-name heuristic warning", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "thing",
        createEntity({
          fields: {
            authorId: createTextField({
              personal: "ref",
            }),
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("user-reference-typical name"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  const userReferenceHintWarningFor = (fieldName: string) =>
    warnSpy.mock.calls.find((args: unknown[]) => {
      const message = String(args[0]);
      return (
        message.includes(`Field "${fieldName}"`) && message.includes("user-reference-typical name")
      );
    });

  function defineCommentFeatureWithBodyOwnedBy(ownerFieldName: "authorId" | "ownerId") {
    return defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            email: createTextField({ personal: "self", find: "none" }),
          },
        }),
      );
      stubListHandler(r, "user");
      r.entity(
        "comment",
        createEntity({
          fields: {
            body: createLongTextField({ personal: { of: ownerFieldName }, find: "none" }),
            authorId: { type: "reference", entity: "user" },
            ownerId: { type: "reference", entity: "user" },
          },
        }),
      );
    });
  }

  test("owner field referenced by another field's personal.of does not trigger the user-reference-name warning", () => {
    validateBoot([defineCommentFeatureWithBodyOwnedBy("authorId")]);
    expect(userReferenceHintWarningFor("authorId")).toBeUndefined();
    const anyAuthorIdWarning = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('Field "authorId"'),
    );
    expect(anyAuthorIdWarning).toBeUndefined();
  });

  test("user-reference-named field not referenced by any personal.of still warns", () => {
    validateBoot([defineCommentFeatureWithBodyOwnedBy("ownerId")]);
    expect(userReferenceHintWarningFor("authorId")).toBeDefined();
    expect(userReferenceHintWarningFor("ownerId")).toBeUndefined();
  });

  test("allowPlaintext marker silences PII-name heuristic warning", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "company",
        createEntity({
          fields: {
            name: createTextField({
              personal: false,
              reason: "is_business_data",
            }),
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  describe("file fields without a personal annotation", () => {
    const fileFieldWarning = () =>
      warnSpy.mock.calls.find((args: unknown[]) => String(args[0]).includes("File field"));

    const bootWithField = (field: FieldDefinition) =>
      validateBoot(
        [
          defineFeature("test", (r) => {
            r.entity("statement", createEntity({ fields: { pdfFile: field } }));
          }),
        ],
        { env: { FILE_STORAGE_PROVIDER: "local" } },
      );

    test.each([
      ["file", createFileField()],
      ["image", createImageField()],
      ["files", createFilesField()],
      ["images", createImagesField()],
    ] as const)("warns for an unannotated %s field", (_type, field) => {
      bootWithField(field);
      expect(fileFieldWarning()).toBeDefined();
    });

    test("personal annotation silences the warning", () => {
      bootWithField(createFileField({ personal: "self" }));
      expect(fileFieldWarning()).toBeUndefined();
    });

    test("an explicit business-data stance silences the warning", () => {
      bootWithField(createFileField({ personal: false, reason: "is_business_data" }));
      expect(fileFieldWarning()).toBeUndefined();
    });
  });

  test("pii: true on email field silences PII-name heuristic warning", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            email: createTextField({
              personal: "self",
              find: "none",
            }),
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  // --- T1: PII-Annotations auf weiteren Field-Defs ---

  test("pii: true on number field passes (z.B. salary, kontostand)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "payslip",
        createEntity({
          fields: {
            grossAmount: createNumberField({
              personal: "self",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on select field passes (z.B. gender, marital status)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "profile",
        createEntity({
          fields: {
            gender: createSelectField({
              options: ["male", "female", "diverse", "prefer-not-to-say"] as const,
              personal: "self",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on multiSelect field passes (z.B. dietary restrictions)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "profile",
        createEntity({
          fields: {
            dietaryRestrictions: createMultiSelectField({
              options: ["vegan", "vegetarian", "halal", "kosher", "gluten-free"] as const,
              personal: "self",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on date field passes (z.B. dateOfBirth)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "profile",
        createEntity({
          fields: {
            dateOfBirth: createDateField({
              personal: "self",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on timestamp field passes (z.B. lastLoginAt)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "session",
        createEntity({
          fields: {
            lastLoginAt: createTimestampField({
              personal: "self",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on tz field passes (Standort verraet Person)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "profile",
        createEntity({
          fields: {
            homeTz: createTzField({
              personal: "self",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on locatedTimestamp field passes (z.B. employee shift)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "shift",
        createEntity({
          fields: {
            startsAt: createLocatedTimestampField({
              personal: "self",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on embedded field passes (z.B. customerAddress)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "order",
        createEntity({
          fields: {
            customerAddress: createEmbeddedField(
              {
                street: { type: "text" },
                city: { type: "text" },
                postalCode: { type: "text" },
              },
              {
                personal: "self",
              },
            ),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  // --- T3: Edge-Cases ---

  test("pii on boolean field is ignored at runtime (TS prevents it at compile, runtime is silent)", () => {
    // Boolean-FieldDef hat kein PiiAnnotations-Intersection. TypeScript
    // wuerde `pii: true` auf createBooleanField() ablehnen. Runtime-Cast
    // simuliert programmatisch konstruierte FieldDefs — Validator soll
    // das stillschweigend tolerieren (kein Error, kein false-Warning).
    const feature = defineFeature("test", (r) => {
      r.entity(
        "thing",
        createEntity({
          fields: {
            isPublic: { ...createBooleanField(), pii: true } as ReturnType<
              typeof createBooleanField
            >,
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test('"name" alone is NOT in PII direct hints (too broad — product.name, tenant.name)', () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "product",
        createEntity({
          fields: {
            name: { ...unannotatedText },
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  test("displayName / firstName / lastName / fullName remain in PII hints", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "person",
        createEntity({
          fields: {
            displayName: { ...unannotatedText },
          },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeDefined();
  });
});

describe("validateBoot — retention", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
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
            note: { ...unannotatedText },
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
            note: { ...unannotatedText },
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
            invoiceNumber: createTextField({
              personal: false,
              reason: "is_business_data",
            }),
            customerName: createTextField({
              personal: "self",
              find: "none",
            }),
          },
          retention: { keepFor: "10y", strategy: "blockDelete" },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('strategy="blockDelete" but no field has an anonymize-function'),
    );
    expect(matchingWarn).toBeDefined();
    expect(String(matchingWarn?.[0])).toContain(
      "the data-retention cron anonymizes nothing and the row keeps its PII",
    );
    expect(String(matchingWarn?.[0])).not.toContain("Forget will return error");
  });

  test("blockDelete without any subject-annotated field stays silent (#1622)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "lease",
        createEntity({
          fields: {
            reference: createTextField({
              personal: false,
              reason: "is_business_data",
            }),
          },
          retention: { keepFor: "10y", strategy: "blockDelete" },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('strategy="blockDelete" but no field has an anonymize-function'),
    );
    expect(matchingWarn).toBeUndefined();
  });

  test("blockDelete with only a subjectRef-only field does not warn about EXT_USER_DATA delete hook (#2338)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "lease",
        createEntity({
          fields: {
            authorId: createTextField({
              personal: "ref",
            }),
          },
          retention: { keepFor: "10y", strategy: "blockDelete" },
        }),
      );
    });
    validateBoot([feature]);
    const anonymizeWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('strategy="blockDelete" but no field has an anonymize-function'),
    );
    expect(anonymizeWarn).toBeUndefined();
    const extWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("EXT_USER_DATA delete hook"),
    );
    expect(extWarn).toBeUndefined();
  });

  test.each([
    ["self", { personal: "self" as const, find: "none" as const }],
    ["userOwned", { personal: { of: "authorId" } as const, find: "none" as const }],
    ["tenantOwned", { personal: "tenant" as const, find: "none" as const }],
  ])(
    "blockDelete warns when subjectRef coexists with anonymizable %s field (#2336)",
    (_label, personal) => {
      const feature = defineFeature("test", (r) => {
        r.entity(
          "lease",
          createEntity({
            fields: {
              authorId: createTextField({ personal: "ref" }),
              subjectField: createTextField(personal),
            },
            retention: { keepFor: "10y", strategy: "blockDelete" },
          }),
        );
      });
      validateBoot([feature]);
      const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
        String(args[0]).includes('strategy="blockDelete" but no field has an anonymize-function'),
      );
      expect(matchingWarn).toBeDefined();
    },
  );

  test('retention.keepFor with invalid format "30days" warns', () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "thing",
        createEntity({
          fields: {
            note: createTextField({
              personal: false,
              reason: "is_business_data",
            }),
          },
          retention: { keepFor: "30days", strategy: "hardDelete" },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('keepFor="30days" hat ungueltiges Format'),
    );
    expect(matchingWarn).toBeDefined();
  });

  test('retention.keepFor with valid format "30d" / "10y" / "6m" / "1w" / "24h" passes silently', () => {
    const validFormats = ["30d", "10y", "6m", "1w", "24h"];
    for (const keepFor of validFormats) {
      const feature = defineFeature("test", (r) => {
        r.entity(
          "thing",
          createEntity({
            fields: {
              note: createTextField({
                personal: false,
                reason: "is_business_data",
              }),
            },
            retention: { keepFor, strategy: "hardDelete" },
          }),
        );
      });
      validateBoot([feature]);
    }
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("hat ungueltiges Format"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  test("blockDelete with at least one anonymize-field is silent", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "invoice",
        createEntity({
          fields: {
            invoiceNumber: createTextField({
              personal: false,
              reason: "is_business_data",
            }),
            customerName: createTextField({
              personal: "self",
              find: "none",
              anonymize: () => "[ANONYMIZED]",
            }),
          },
          retention: { keepFor: "10y", strategy: "blockDelete" },
        }),
      );
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('strategy="blockDelete" but no field has an anonymize-function'),
    );
    expect(matchingWarn).toBeUndefined();
  });
});

describe("validateBoot — lookupable / blind-index (#818)", () => {
  test("lookupable on subject-annotated text field passes", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            email: createTextField({
              personal: "self",
              find: "exact",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("lookupable without subject annotation throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "doc",
        createEntity({
          fields: {
            slug: rawField({
              ...unannotatedText,
              lookupable: true,
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(/find:.*without a subject annotation/);
  });

  test("lookupable on non-text field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "person",
        createEntity({
          fields: {
            bio: rawLongTextField({
              ...createLongTextField({ personal: { of: "ownerId" }, find: "none" }),
              lookupable: true,
            }),
            ownerId: { ...unannotatedText, required: true },
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(/only apply to text fields/);
  });

  test("searchable combined with a subject annotation passes (#1610)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            displayName: createTextField({
              personal: "self",
              find: "fuzzy",
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("sortable combined with a subject annotation throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            email: createTextField({
              personal: "self",
              find: "none",
              sortable: true,
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(/sortable/);
  });

  test("searchable combined with sensitive throws (#1610)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          fields: {
            passwordHash: rawField({
              ...unannotatedText,
              pii: true,
              sensitive: true,
              searchable: true,
            }),
          },
        }),
      );
    });
    expect(() => validateBoot([feature])).toThrow(/sensitive.*searchable/);
  });
});

describe("validateBoot — writeOnly fields", () => {
  const bootWith = (field: TextFieldDef | LongTextFieldDef | Record<string, unknown>) =>
    validateBoot([
      defineFeature("test", (r) => {
        r.entity("conn", createEntity({ fields: { apiKey: field as TextFieldDef } }));
      }),
    ]);

  test("writeOnly on a find: secret text field passes", () => {
    expect(() =>
      bootWith(createTextField({ personal: "tenant", find: "secret", writeOnly: true })),
    ).not.toThrow();
  });

  test("writeOnly without sensitive throws", () => {
    expect(() =>
      bootWith(createTextField({ personal: "tenant", find: "none", writeOnly: true })),
    ).toThrow(/writeOnly: true } without { sensitive: true }/);
  });

  test("writeOnly on a non-text field throws", () => {
    expect(() => bootWith({ type: "longText", required: false, writeOnly: true })).toThrow(
      /only applies to text fields/,
    );
  });

  test.each(["default", "searchable", "sortable", "filterable", "lookupable"] as const)(
    "writeOnly combined with %s throws",
    (flag) => {
      const value = flag === "default" ? "x" : true;
      expect(() =>
        bootWith({
          ...createTextField({ personal: "tenant", find: "secret", writeOnly: true }),
          [flag]: value,
        }),
      ).toThrow(new RegExp(`writeOnly: true } with { ${flag} }`));
    },
  );
});
