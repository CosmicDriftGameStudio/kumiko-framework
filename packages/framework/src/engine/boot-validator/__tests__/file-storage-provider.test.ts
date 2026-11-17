import { expect, test } from "bun:test";
import { withBootValidatorFixture, withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  test("throws when file fields exist but FILE_STORAGE_PROVIDER not set", async () => {
    await withEnv({ FILE_STORAGE_PROVIDER: undefined }, () => {
      const features = [
        defineFeature("a", (r) => {
          r.entity(createEntity({
              name: "doc",
              table: "Docs",
              fields: { contract: { type: "file" } },
            }));
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/FILE_STORAGE_PROVIDER.*required/i);
    });
  });

  test("passes when file fields exist and FILE_STORAGE_PROVIDER is set", async () => {
    await withEnv({ FILE_STORAGE_PROVIDER: "local" }, () => {
      const features = [
        defineFeature("a", (r) => {
          r.entity(createEntity({
              name: "doc",
              table: "Docs",
              fields: { photo: { type: "image" } },
            }));
        }),
      ];
      expect(() => validateBoot(features)).not.toThrow();
    });
  });

  test("file-storage gate reads the injected env option, not process.env", async () => {
    await withEnv({ FILE_STORAGE_PROVIDER: undefined }, () => {
      const features = [
        defineFeature("a", (r) => {
          r.entity(createEntity({ name: "doc", table: "Docs", fields: { photo: { type: "image" } } }));
        }),
      ];
      const fixtured = withBootValidatorFixture(features);
      expect(() =>
        validateBootRaw(fixtured, { env: { FILE_STORAGE_PROVIDER: "s3-env" } }),
      ).not.toThrow();
      expect(() => validateBootRaw(fixtured, { env: {} })).toThrow(
        /FILE_STORAGE_PROVIDER.*required/i,
      );
    });
  });
