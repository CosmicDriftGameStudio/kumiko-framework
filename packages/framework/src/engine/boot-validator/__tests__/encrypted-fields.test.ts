import { describe, expect, test } from "bun:test";
import {
  createTestEnvelopeCipher,
  withBootValidatorFixture,
  withEnv,
} from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

test("rejects encrypted + searchable field", () => {
  const features = [
    defineFeature("a", (r) => {
      r.entity(
        createEntity({
          name: "secret",
          table: "Secrets",
          fields: {
            apiKey: {
              type: "text",
              allowPlaintext: "test fixture value, not personal data",
              encrypted: true,
              searchable: true,
            },
          },
        }),
      );
    }),
  ];
  expect(() => validateBoot(features)).toThrow(/apiKey.*cannot be both encrypted and searchable/i);
});

test("rejects encrypted + sortable field", () => {
  const features = [
    defineFeature("a", (r) => {
      r.entity(
        createEntity({
          name: "secret",
          table: "Secrets",
          fields: {
            token: {
              type: "text",
              allowPlaintext: "test fixture value, not personal data",
              encrypted: true,
              sortable: true,
            },
          },
        }),
      );
    }),
  ];
  expect(() => validateBoot(features)).toThrow(/token.*cannot be both encrypted and sortable/i);
});

test("allows encrypted field when a master key keyring is available", async () => {
  await withEnv(
    {
      KUMIKO_SECRETS_MASTER_KEY_V1: Buffer.from("0123456789abcdef0123456789abcdef").toString(
        "base64",
      ),
    },
    () => {
      const features = [
        defineFeature("a", (r) => {
          r.entity(
            createEntity({
              name: "secret",
              table: "Secrets",
              fields: {
                apiKey: {
                  type: "text",
                  allowPlaintext: "test fixture value, not personal data",
                  encrypted: true,
                },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    },
  );
});

test("throws at boot when the master key is malformed (not 32 bytes)", async () => {
  await withEnv(
    { KUMIKO_SECRETS_MASTER_KEY_V1: Buffer.from("too-short").toString("base64") },
    () => {
      const features = [
        defineFeature("a", (r) => {
          r.entity(
            createEntity({
              name: "secret",
              table: "Secrets",
              fields: {
                apiKey: {
                  type: "text",
                  allowPlaintext: "test fixture value, not personal data",
                  encrypted: true,
                },
              },
            }),
          );
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/master key/i);
    },
  );
});

test("throws when encrypted fields exist but no master key is available", async () => {
  await withEnv({ KUMIKO_SECRETS_MASTER_KEY_V1: undefined }, () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          createEntity({
            name: "secret",
            table: "Secrets",
            fields: {
              apiKey: {
                type: "text",
                allowPlaintext: "test fixture value, not personal data",
                encrypted: true,
              },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/master key/i);
  });
});

describe("entityFieldCipher option", () => {
  const encryptedFeatures = [
    defineFeature("a", (r) => {
      r.entity(
        createEntity({
          name: "secret",
          table: "Secrets",
          fields: {
            apiKey: {
              type: "text",
              allowPlaintext: "test fixture value, not personal data",
              encrypted: true,
            },
          },
        }),
      );
    }),
  ];

  test("a runner-provided cipher satisfies encrypted fields without any env KEK", () => {
    const cipher = createTestEnvelopeCipher(Buffer.alloc(32, 7).toString("base64"));
    expect(() =>
      validateBootRaw(withBootValidatorFixture(encryptedFeatures), {
        env: {},
        entityFieldCipher: cipher,
      }),
    ).not.toThrow();
  });

  test("without the cipher and without an env KEK the error names both ways out", () => {
    expect(() => validateBootRaw(withBootValidatorFixture(encryptedFeatures), { env: {} })).toThrow(
      /KUMIKO_SECRETS_MASTER_KEY_V1.*masterKey/s,
    );
  });
});

test("throws when longText encrypted field exists but no master key is available", async () => {
  // Ensures `validateEncryptedFields` checks both string field types. Previously,
  // `if (field.type !== "text") continue;` skipped encrypted `longText` fields,
  // so the `ENCRYPTION_KEY` check never ran and encryption could fail silently.
  await withEnv({ KUMIKO_SECRETS_MASTER_KEY_V1: undefined }, () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          createEntity({
            name: "doc",
            table: "Docs",
            fields: {
              body: {
                type: "longText",
                allowPlaintext: "test fixture value, not personal data",
                encrypted: true,
              },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/master key/i);
  });
});

test("rejects encrypted text field that is also filterable", async () => {
  // AES-GCM draws a random IV per call, so the ciphertext is non-
  // deterministic — an equality filter on it would never match, even
  // against the identical plaintext.
  await withEnv({ ENCRYPTION_KEY: "test-key" }, () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          createEntity({
            name: "doc",
            table: "Docs",
            fields: {
              secret: {
                type: "text",
                allowPlaintext: "test fixture value, not personal data",
                encrypted: true,
                filterable: true,
              },
            },
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/secret.*encrypted and filterable/i);
  });
});

test("rejects a unique index on an encrypted column", async () => {
  // Same non-determinism as the filterable case: a unique index can never
  // detect a real duplicate plaintext behind two different ciphertexts.
  await withEnv({ ENCRYPTION_KEY: "test-key" }, () => {
    const features = [
      defineFeature("a", (r) => {
        r.entity(
          createEntity({
            name: "doc",
            table: "Docs",
            fields: {
              secret: {
                type: "text",
                allowPlaintext: "test fixture value, not personal data",
                encrypted: true,
              },
            },
            indexes: [{ columns: ["secret"], unique: true }],
          }),
        );
      }),
    ];
    expect(() => validateBoot(features)).toThrow(/secret.*encrypted.*unique index/i);
  });
});
