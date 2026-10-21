import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "ts-morph";
import { checkI18nKeys, collectInstalledFrameworkKeys } from "../guard-i18n-keys";

function featureFile(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("/repo/src/features/greeting/feature.ts", code);
}

describe("guard-i18n-keys — plural entries", () => {
  test("accepts a plural object as a locale value without a false positive", () => {
    const sf = featureFile(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      export const greetingFeature = defineFeature("greeting", (r) => {
        r.translations({
          keys: {
            "greeting.count": {
              de: { one: "Ein Eintrag", other: "{count} Einträge" },
              en: "entries",
            },
          },
        });
        t("greeting:greeting.count");
      });
    `);
    const outcome = checkI18nKeys([sf]);
    expect(outcome.violations).toHaveLength(0);
  });

  test("matches a used key and a defined key that spell the same text with different escapes", () => {
    const sf = featureFile(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      export const greetingFeature = defineFeature("greeting", (r) => {
        r.translations({
          keys: {
            "greeting.it's": { de: "x", en: "y" },
          },
        });
        t('greeting:greeting.it\\'s');
      });
    `);
    const outcome = checkI18nKeys([sf]);
    expect(outcome.violations).toHaveLength(0);
  });
});

describe("guard-i18n-keys — keys of installed framework packages", () => {
  const usage = () =>
    featureFile(`
      export const x = () => t("auth:auth.login.title");
    `);

  test("a key defined by an installed package is known", () => {
    const outcome = checkI18nKeys([usage()], {
      installedFrameworkKeys: () => new Set(["auth:auth.login.title"]),
    });
    expect(outcome.violations).toHaveLength(0);
  });

  test("a key unknown to the app and the installed packages is still flagged", () => {
    const outcome = checkI18nKeys([usage()], {
      installedFrameworkKeys: () => new Set(["auth:other"]),
    });
    expect(outcome.violations.map((v) => v.message)).toEqual([
      'used key without a definition: "auth:auth.login.title"',
    ]);
  });

  test("reads the keys from node_modules/@cosmicdrift packages of a consumer app", () => {
    const root = mkdtempSync(join(tmpdir(), "i18n-installed-"));
    try {
      const pkg = join(root, "node_modules/@cosmicdrift/kumiko-bundled-features/src/auth");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(
        join(pkg, "feature.ts"),
        `export const authFeature = defineFeature("auth", (r) => {
          r.translations({ keys: { "auth.login.title": { en: "Sign in" } } });
        });`,
      );
      expect(collectInstalledFrameworkKeys(root).has("auth:auth.login.title")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reads compiled dist JS of a package hoisted one level above the app", () => {
    const parent = mkdtempSync(join(tmpdir(), "i18n-hoisted-"));
    try {
      const app = join(parent, "apps/web");
      mkdirSync(app, { recursive: true });
      const dist = join(parent, "node_modules/@cosmicdrift/kumiko-bundled-features/dist/auth");
      mkdirSync(dist, { recursive: true });
      writeFileSync(
        join(dist, "feature.js"),
        `export const authFeature = defineFeature("auth", (r) => {
    r.translations({ keys: { "auth.login.title": { en: "Sign in" } } });
});`,
      );
      writeFileSync(
        join(dist, "feature.d.ts"),
        `r.translations({ keys: { "auth.declared": {} } });`,
      );
      const keys = collectInstalledFrameworkKeys(app);
      expect(keys.has("auth:auth.login.title")).toBe(true);
      expect(keys.has("auth:auth.declared")).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
