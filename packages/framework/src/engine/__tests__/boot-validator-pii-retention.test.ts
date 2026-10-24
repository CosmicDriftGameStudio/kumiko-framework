// Boot-validator tests for PII annotations and retention.
//
// Required validations (error / throw):
//   - Mutual exclusion: pii / userOwned / tenantOwned are exclusive per field.
//   - userOwned.ownerField must exist and be a reference field.
//   - retention.reference must target an existing field or framework timestamp
//     (createdAt/updatedAt/lastSeenAt/deletedAt).
//
// Heuristic warnings (console.warn, no throw):
//   - Field names such as email/name/phone without a pii annotation.
//   - Field names such as body/text/content without a userOwned annotation.
//   - blockDelete strategy without anonymize fields.
//   - userOwned.ownerField targets a reference whose target is not user.
import type {
  EntityFieldDefinition,
  EntityLongTextFieldDef,
  EntityTextFieldDef,
  FieldDefinition,
} from "@cosmicdrift/kumiko-types/fields";

//
// An allowPlaintext marker suppresses heuristic warnings.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
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
} from "../factories.ts";
import { plaintextText } from "./plaintext-fields.ts";

// The new personal/find union can no longer express some flag combinations
// on purpose (e.g. two subjects on one field) — these tests deliberately
// construct the raw, rejected shape to prove the boot-validator still throws.
const rawField = <T>(f: T) => f as unknown as EntityTextFieldDef;
const rawLongTextField = <T>(f: T) => f as unknown as EntityLongTextFieldDef;

// The heuristics under test only fire without a personal stance, which
// the factories cannot produce.

// Stubs an empty `<entity>:list` query handler so the reference-field boot
// validator's check passes. This is needed when a test uses a reference field;
// otherwise the validator reports "no list-query-handler is registered there".
// biome-ignore lint/suspicious/noExplicitAny: The registrar type is generic, so any is sufficient here.
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
      r.entity({
        name: "user",
        ...createEntity({
          fields: {
            email: createTextField({
              personal: "self",
              find: "none",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("tenantOwned: true passes on text field", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "branding",
        ...createEntity({
          fields: {
            brandColor: createTextField({
              personal: "tenant",
              find: "none",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("userOwned with valid ownerField on reference passes", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "user",
        ...createEntity({
          fields: {
            email: createTextField({
              personal: "self",
              find: "none",
            }),
          },
        }),
      });
      stubListHandler(r, "user");
      r.entity({
        name: "comment",
        ...createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "authorId", whenAbsent: "tenant" },
              find: "none",
            }),
            authorId: { type: "reference", entity: "user" },
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("multiple subject annotations on same field throw", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "thing",
        ...createEntity({
          fields: {
            confused: rawField({
              ...plaintextText,
              pii: true,
              tenantOwned: true,
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).toThrow(/multiple subject-key annotations/);
  });

  test("naked sensitive (no pii/encrypted) throws — event log needs ciphertext-at-rest (#967)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "vault",
        ...createEntity({
          fields: {
            apiToken: { ...plaintextText, sensitive: true },
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).toThrow(/sensitive: true.*without ciphertext-at-rest/);
  });

  test("sensitive with pii subject annotation passes", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "vault",
        ...createEntity({
          fields: {
            apiToken: createTextField({
              personal: "self",
              find: "secret",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("sensitive with encrypted passes", () => {
    process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = Buffer.from(
      "0123456789abcdef0123456789abcdef",
    ).toString("base64");
    try {
      const feature = defineFeature("test", (r) => {
        r.entity({
          name: "vault",
          ...createEntity({
            fields: {
              apiToken: { ...plaintextText, sensitive: true, encrypted: true },
            },
          }),
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
    } finally {
      delete process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
    }
  });

  test("userOwned.ownerField pointing to non-existent field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "comment",
        ...createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "ghostField" },
              find: "none",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /personal\.of "ghostField" but no such field exists/,
    );
  });

  test("userOwned.ownerField on a text field passes (ES userId-by-convention)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "comment",
        ...createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "authorId", whenAbsent: "tenant" },
              find: "none",
            }),
            authorId: { ...plaintextText },
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  describe("nullable owner needs whenAbsent (fw#3654)", () => {
    function commentFeature(withWhenAbsent: boolean, ownerRequired: boolean) {
      return defineFeature("test", (r) => {
        r.entity({
          name: "comment",
          ...createEntity({
            fields: {
              body: withWhenAbsent
                ? createLongTextField({
                    personal: { of: "authorId", whenAbsent: "tenant" },
                    find: "none",
                  })
                : createLongTextField({ personal: { of: "authorId" }, find: "none" }),
              authorId: { ...plaintextText, ...(ownerRequired && { required: true }) },
            },
          }),
        });
      });
    }

    test("nullable owner without whenAbsent throws and names the fix", () => {
      expect(() => validateBoot([commentFeature(false, false)])).toThrow(
        /"authorId" is not required.*Declare \{ personal: \{ of: "authorId", whenAbsent: "tenant" \} \}.*or make "authorId" required: true/,
      );
    });

    test("nullable owner with whenAbsent tenant passes", () => {
      expect(() => validateBoot([commentFeature(true, false)])).not.toThrow();
    });

    test('nullable owner with whenAbsent "self" passes; the fix hint names both values', () => {
      const feature = defineFeature("test", (r) => {
        r.entity({
          name: "comment",
          ...createEntity({
            fields: {
              body: createLongTextField({
                personal: { of: "authorId", whenAbsent: "self" },
                find: "none",
              }),
              authorId: { ...plaintextText },
            },
          }),
        });
      });
      expect(() => validateBoot([feature])).not.toThrow();
      expect(() => validateBoot([commentFeature(false, false)])).toThrow(
        /whenAbsent: "tenant".*whenAbsent: "self"/,
      );
    });

    test('whenAbsent "self" on a serial-id entity throws — the record key could never be shredded', () => {
      const feature = defineFeature("test", (r) => {
        r.entity({
          name: "comment",
          ...createEntity({
            idType: "serial",
            fields: {
              body: createLongTextField({
                personal: { of: "authorId", whenAbsent: "self" },
                find: "none",
              }),
              authorId: { ...plaintextText },
            },
          }),
        });
      });
      expect(() => validateBoot([feature])).toThrow(/"body".*whenAbsent: "self"/);
    });

    test("required owner without whenAbsent passes", () => {
      expect(() => validateBoot([commentFeature(false, true)])).not.toThrow();
    });

    test('whenAbsent "plaintext" throws — entity fields have no plaintext fallback', () => {
      const resolved = createLongTextField({
        personal: { of: "authorId", whenAbsent: "tenant" },
        find: "none",
      });
      const feature = defineFeature("test", (r) => {
        r.entity({
          name: "comment",
          fields: {
            body: {
              ...resolved,
              // @ts-expect-error the types reject whenAbsent "plaintext"; the boot check is the runtime backstop
              userOwned: { ownerField: "authorId", whenAbsent: "plaintext" },
            },
            authorId: { ...plaintextText },
          },
        });
      });
      expect(() => validateBoot([feature])).toThrow(/only support whenAbsent: "tenant" or "self"/);
    });
  });

  test("userOwned.ownerField pointing to a non-id-capable field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "comment",
        ...createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "isPublic" },
              find: "none",
            }),
            isPublic: { type: "boolean" },
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /must be a reference or text \(userId\) field, got type "boolean"/,
    );
  });

  test("userOwned.ownerField referencing non-user entity warns", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({ name: "employee", ...createEntity({ fields: { name: { ...plaintextText } } }) });
      stubListHandler(r, "employee");
      r.entity({
        name: "personalNote",
        ...createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: "employeeId", whenAbsent: "tenant" },
              find: "none",
            }),
            employeeId: { type: "reference", entity: "employee" },
          },
        }),
      });
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('targets reference "employee"'),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("PII-name heuristic warns when a non-text email field has no pii annotation", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "thing",
        ...createEntity({
          fields: {
            email: createNumberField(),
          },
        }),
      });
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("user-content-name heuristic warns when body field has no userOwned annotation", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "thing",
        ...createEntity({
          fields: {
            body: createNumberField(),
          },
        }),
      });
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("user-content-typical name"),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("user-reference-name heuristic warns when authorId field has no subjectRef annotation", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "thing",
        ...createEntity({
          fields: {
            authorId: createNumberField(),
          },
        }),
      });
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("user-reference-typical name"),
    );
    expect(matchingWarn).toBeDefined();
  });

  test("subjectRef: true on authorId field silences user-reference-name heuristic warning", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "thing",
        ...createEntity({
          fields: {
            authorId: createTextField({
              personal: "ref",
            }),
          },
        }),
      });
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
      r.entity({
        name: "user",
        ...createEntity({
          fields: {
            email: createTextField({ personal: "self", find: "none" }),
          },
        }),
      });
      stubListHandler(r, "user");
      r.entity({
        name: "comment",
        ...createEntity({
          fields: {
            body: createLongTextField({
              personal: { of: ownerFieldName, whenAbsent: "tenant" },
              find: "none",
            }),
            authorId: { type: "reference", entity: "user" },
            ownerId: { type: "reference", entity: "user" },
          },
        }),
      });
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
      r.entity({
        name: "company",
        ...createEntity({
          fields: {
            name: createTextField({
              personal: false,
              reason: "is_business_data",
            }),
          },
        }),
      });
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  describe("text fields without a personal stance", () => {
    const bootWithField = (field: unknown) =>
      validateBoot([
        defineFeature("billing", (r) => {
          r.entity({ name: "invoice", ...createEntity({ fields: { title: rawField(field) } }) });
        }),
      ]);

    test.each([
      ["text", { type: "text", required: true }],
      ["longText", { type: "longText", required: true }],
    ] as const)(
      "a raw { type: %s } literal throws naming feature, entity and field",
      (type, field) => {
        expect(() => bootWithField(field)).toThrow(
          new RegExp(
            `\\[Feature billing\\] Field "title" on entity "invoice" \\(type "${type}"\\) declares no personal stance`,
          ),
        );
      },
    );

    test("a PII-typical name does not replace the stance: the text field still throws", () => {
      expect(() =>
        validateBoot([
          defineFeature("billing", (r) => {
            r.entity({
              name: "invoice",
              ...createEntity({ fields: { email: rawField({ type: "text" }) } }),
            });
          }),
        ]),
      ).toThrow(/declares no personal stance/);
    });

    test("an empty allowPlaintext is no stance", () => {
      expect(() => bootWithField({ type: "text", allowPlaintext: "" })).toThrow(
        /declares no personal stance/,
      );
    });

    test.each([
      ["self", createTextField({ personal: "self", find: "none" })],
      ["tenant", createTextField({ personal: "tenant", find: "none" })],
      ["ref", createTextField({ personal: "ref" })],
      ["of", createTextField({ personal: { of: "ownerId" }, find: "none" })],
      ["false with reason", createTextField({ personal: false, reason: "is_business_data" })],
      ["longText self", createLongTextField({ personal: "self", find: "none" })],
      ["longText false", createLongTextField({ personal: false, reason: "is_business_data" })],
    ] as const)("the %s stance from the factory boots", (_name, field) => {
      expect(() =>
        validateBoot([
          defineFeature("billing", (r) => {
            r.entity({
              name: "invoice",
              ...createEntity({
                fields: {
                  title: field,
                  ownerId: createTextField({ personal: "ref", required: true }),
                },
              }),
            });
          }),
        ]),
      ).not.toThrow();
    });
  });

  describe("file fields without a personal annotation", () => {
    const fileFieldWarning = () =>
      warnSpy.mock.calls.find((args: unknown[]) => String(args[0]).includes("File field"));

    const bootWithField = (field: FieldDefinition) =>
      validateBoot(
        [
          defineFeature("test", (r) => {
            r.entity({
              name: "statement",
              ...createEntity({ fields: { pdfFile: field as EntityFieldDefinition } }),
            });
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
      r.entity({
        name: "user",
        ...createEntity({
          fields: {
            email: createTextField({
              personal: "self",
              find: "none",
            }),
          },
        }),
      });
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  // --- PII annotations on further field defs ---

  test("pii: true on number field passes (z.B. salary, kontostand)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "payslip",
        ...createEntity({
          fields: {
            grossAmount: createNumberField({
              personal: "self",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on select field passes (z.B. gender, marital status)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "profile",
        ...createEntity({
          fields: {
            gender: createSelectField({
              options: ["male", "female", "diverse", "prefer-not-to-say"] as const,
              personal: "self",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on multiSelect field passes (z.B. dietary restrictions)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "profile",
        ...createEntity({
          fields: {
            dietaryRestrictions: createMultiSelectField({
              options: ["vegan", "vegetarian", "halal", "kosher", "gluten-free"] as const,
              personal: "self",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on date field passes (z.B. dateOfBirth)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "profile",
        ...createEntity({
          fields: {
            dateOfBirth: createDateField({
              personal: "self",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on timestamp field passes (z.B. lastLoginAt)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "session",
        ...createEntity({
          fields: {
            lastLoginAt: createTimestampField({
              personal: "self",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on tz field passes (Standort verraet Person)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "profile",
        ...createEntity({
          fields: {
            homeTz: createTzField({
              personal: "self",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on locatedTimestamp field passes (z.B. employee shift)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "shift",
        ...createEntity({
          fields: {
            startsAt: createLocatedTimestampField({
              personal: "self",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("pii: true on embedded field passes (z.B. customerAddress)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "order",
        ...createEntity({
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
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  // --- Edge cases ---

  test("pii on boolean field is ignored at runtime (TS prevents it at compile, runtime is silent)", () => {
    // Boolean-FieldDef has no PiiAnnotations intersection. TypeScript
    // would reject `pii: true` on createBooleanField(). The runtime cast
    // simulates programmatically constructed FieldDefs; the validator should
    // tolerate them silently (no error and no false warning).
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "thing",
        ...createEntity({
          fields: {
            isPublic: { ...createBooleanField(), pii: true } as ReturnType<
              typeof createBooleanField
            >,
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test('"name" alone is NOT in PII direct hints (too broad — product.name, tenant.name)', () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "product",
        ...createEntity({
          fields: {
            name: createNumberField(),
          },
        }),
      });
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("PII-typical name"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  test("displayName / firstName / lastName / fullName remain in PII hints", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "person",
        ...createEntity({
          fields: {
            displayName: createNumberField(),
          },
        }),
      });
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
      r.entity({
        name: "session",
        ...createEntity({
          fields: {
            lastSeenAt: { type: "timestamp" },
          },
          retention: { keepFor: "30d", strategy: "hardDelete", reference: "lastSeenAt" },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("retention.reference pointing to framework createdAt passes", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "auditEvent",
        ...createEntity({
          fields: {
            note: { ...plaintextText },
          },
          retention: { keepFor: "1y", strategy: "hardDelete", reference: "createdAt" },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("retention.reference pointing to non-existent field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "thing",
        ...createEntity({
          fields: {
            note: { ...plaintextText },
          },
          retention: { keepFor: "30d", strategy: "hardDelete", reference: "ghostField" },
        }),
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /retention\.reference "ghostField" does not exist/,
    );
  });

  test("blockDelete without any anonymize-fields warns", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "invoice",
        ...createEntity({
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
      });
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
      r.entity({
        name: "lease",
        ...createEntity({
          fields: {
            reference: createTextField({
              personal: false,
              reason: "is_business_data",
            }),
          },
          retention: { keepFor: "10y", strategy: "blockDelete" },
        }),
      });
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('strategy="blockDelete" but no field has an anonymize-function'),
    );
    expect(matchingWarn).toBeUndefined();
  });

  test("blockDelete with only a subjectRef-only field does not warn about EXT_USER_DATA delete hook (#2338)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "lease",
        ...createEntity({
          fields: {
            authorId: createTextField({
              personal: "ref",
            }),
          },
          retention: { keepFor: "10y", strategy: "blockDelete" },
        }),
      });
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
    [
      "userOwned",
      { personal: { of: "authorId", whenAbsent: "tenant" } as const, find: "none" as const },
    ],
    ["tenantOwned", { personal: "tenant" as const, find: "none" as const }],
  ])(
    "blockDelete warns when subjectRef coexists with anonymizable %s field (#2336)",
    (_label, personal) => {
      const feature = defineFeature("test", (r) => {
        r.entity({
          name: "lease",
          ...createEntity({
            fields: {
              authorId: createTextField({ personal: "ref" }),
              subjectField: createTextField(personal),
            },
            retention: { keepFor: "10y", strategy: "blockDelete" },
          }),
        });
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
      r.entity({
        name: "thing",
        ...createEntity({
          fields: {
            note: createTextField({
              personal: false,
              reason: "is_business_data",
            }),
          },
          retention: { keepFor: "30days", strategy: "hardDelete" },
        }),
      });
    });
    validateBoot([feature]);
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes('keepFor="30days" has an invalid format'),
    );
    expect(matchingWarn).toBeDefined();
  });

  test('retention.keepFor with valid format "30d" / "10y" / "6m" / "1w" / "24h" passes silently', () => {
    const validFormats = ["30d", "10y", "6m", "1w", "24h"];
    for (const keepFor of validFormats) {
      const feature = defineFeature("test", (r) => {
        r.entity({
          name: "thing",
          ...createEntity({
            fields: {
              note: createTextField({
                personal: false,
                reason: "is_business_data",
              }),
            },
            retention: { keepFor, strategy: "hardDelete" },
          }),
        });
      });
      validateBoot([feature]);
    }
    const matchingWarn = warnSpy.mock.calls.find((args: unknown[]) =>
      String(args[0]).includes("has an invalid format"),
    );
    expect(matchingWarn).toBeUndefined();
  });

  test("blockDelete with at least one anonymize-field is silent", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "invoice",
        ...createEntity({
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
      });
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
      r.entity({
        name: "user",
        ...createEntity({
          fields: {
            email: createTextField({
              personal: "self",
              find: "exact",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("lookupable without subject annotation throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "doc",
        ...createEntity({
          fields: {
            slug: rawField({
              ...plaintextText,
              lookupable: true,
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).toThrow(/find:.*without a subject annotation/);
  });

  test("lookupable on non-text field throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "person",
        ...createEntity({
          fields: {
            bio: rawLongTextField({
              ...createLongTextField({
                personal: { of: "ownerId", whenAbsent: "tenant" },
                find: "none",
              }),
              lookupable: true,
            }),
            ownerId: { ...plaintextText, required: true },
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).toThrow(/only apply to text fields/);
  });

  test("searchable combined with a subject annotation passes (#1610)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "user",
        ...createEntity({
          fields: {
            displayName: createTextField({
              personal: "self",
              find: "fuzzy",
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("sortable combined with a subject annotation throws", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "user",
        ...createEntity({
          fields: {
            email: createTextField({
              personal: "self",
              find: "none",
              sortable: true,
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).toThrow(/sortable/);
  });

  test("searchable combined with sensitive throws (#1610)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({
        name: "user",
        ...createEntity({
          fields: {
            passwordHash: rawField({
              ...plaintextText,
              pii: true,
              sensitive: true,
              searchable: true,
            }),
          },
        }),
      });
    });
    expect(() => validateBoot([feature])).toThrow(/sensitive.*searchable/);
  });
});

describe("validateBoot — writeOnly fields", () => {
  const bootWith = (field: EntityTextFieldDef | EntityLongTextFieldDef | Record<string, unknown>) =>
    validateBoot([
      defineFeature("test", (r) => {
        r.entity({
          name: "conn",
          ...createEntity({ fields: { apiKey: field as EntityTextFieldDef } }),
        });
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
    expect(() =>
      bootWith({
        type: "longText",
        required: false,
        writeOnly: true,
        allowPlaintext: "test_fixture",
      }),
    ).toThrow(/only applies to text fields/);
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
