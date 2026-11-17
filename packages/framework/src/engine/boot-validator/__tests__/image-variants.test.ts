import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture, withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createImageField, createImagesField } from "../../factories.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

  describe("image variants", () => {
    test("accepts a valid variant spec", async () => {
      await withEnv({ FILE_STORAGE_PROVIDER: "local" }, () => {
        const features = [
          defineFeature("profile", (r) => {
            r.entity({
              name: "person",
              ...createEntity({
                fields: {
                  avatar: createImageField({
                    variants: {
                      profile: { fit: "cover", size: { width: 512, height: 512 }, format: "webp" },
                    },
                  }),
                },
              }),
            });
          }),
        ];
        expect(() => validateBoot(features)).not.toThrow();
      });
    });

    test("accepts a variant with only `format` — the legitimate format-only case, no size/maxEdge required", async () => {
      await withEnv({ FILE_STORAGE_PROVIDER: "local" }, () => {
        const features = [
          defineFeature("profile", (r) => {
            r.entity({
              name: "person",
              ...createEntity({
                fields: {
                  avatar: createImageField({ variants: { web: { format: "webp" } } }),
                },
              }),
            });
          }),
        ];
        expect(() => validateBoot(features)).not.toThrow();
      });
    });

    test("rejects a variant setting both `size` and `maxEdge`", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({
                  variants: {
                    both: { size: { width: 100, height: 100 }, maxEdge: 200 },
                  },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/both/);
    });

    test("rejects a variant name containing a slash", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { "a/b": { maxEdge: 200 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/must match/);
    });

    test("rejects maxEdge: 0", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { thumb: { maxEdge: 0 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/maxEdge/);
    });

    test("rejects quality: 101", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { thumb: { maxEdge: 200, quality: 101 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/quality/);
    });

    test("the same validation applies to `images` (multi) fields", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                gallery: createImagesField({ variants: { "a/b": { maxEdge: 200 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/must match/);
    });

    test("rejects size beyond the max variant edge", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({
                  variants: { huge: { size: { width: 100000, height: 100000 } } },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/size/);
    });

    test("rejects maxEdge beyond the max variant edge", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { huge: { maxEdge: 100000 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/maxEdge/);
    });

    test("rejects a negative blur", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({ variants: { thumb: { maxEdge: 200, blur: -5 } } }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/blur/);
    });

    test("rejects a blur far beyond the renderer's supported sigma", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({
                  variants: { thumb: { maxEdge: 200, blur: 100000 } },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/blur/);
    });

    test("accepts a valid blur", async () => {
      await withEnv({ FILE_STORAGE_PROVIDER: "local" }, () => {
        const features = [
          defineFeature("profile", (r) => {
            r.entity({
              name: "person",
              ...createEntity({
                fields: {
                  avatar: createImageField({ variants: { thumb: { maxEdge: 200, blur: 8 } } }),
                },
              }),
            });
          }),
        ];
        expect(() => validateBoot(features)).not.toThrow();
      });
    });

    test("rejects a blurRegion that overflows the unit square", () => {
      const features = [
        defineFeature("profile", (r) => {
          r.entity({
            name: "person",
            ...createEntity({
              fields: {
                avatar: createImageField({
                  variants: {
                    thumb: {
                      maxEdge: 200,
                      blurRegions: [{ x: -0.3, y: 0, width: 0.99, height: 0 }],
                    },
                  },
                }),
              },
            }),
          });
        }),
      ];
      expect(() => validateBoot(features)).toThrow(/blurRegions/);
    });

    test("accepts a valid blurRegion", async () => {
      await withEnv({ FILE_STORAGE_PROVIDER: "local" }, () => {
        const features = [
          defineFeature("profile", (r) => {
            r.entity({
              name: "person",
              ...createEntity({
                fields: {
                  avatar: createImageField({
                    variants: {
                      thumb: {
                        maxEdge: 200,
                        blurRegions: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
                      },
                    },
                  }),
                },
              }),
            });
          }),
        ];
        expect(() => validateBoot(features)).not.toThrow();
      });
    });
  });
