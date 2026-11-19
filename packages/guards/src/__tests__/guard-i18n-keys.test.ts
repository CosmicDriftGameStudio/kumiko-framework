import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "ts-morph";
import { checkI18nKeys, collectInstalledFrameworkKeys } from "../guard-i18n-keys";

function featureFile(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("/repo/src/features/greeting/feature.ts", code);
}

// Without this the guard scans the real node_modules/@cosmicdrift tree, which these cases do not need.
const noInstalledKeys = { installedFrameworkKeys: () => new Set<string>() };

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
    const outcome = checkI18nKeys([sf], noInstalledKeys);
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
    const outcome = checkI18nKeys([sf], noInstalledKeys);
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

  test("reads only the app's own scope dir, even when its path contains glob characters", () => {
    const parent = mkdtempSync(join(tmpdir(), "i18n-scope-"));
    const writeInstalledFeature = (appDir: string, key: string): void => {
      const pkg = join(parent, appDir, "node_modules/@cosmicdrift/kumiko-bundled-features/src");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(
        join(pkg, "feature.ts"),
        `export const authFeature = defineFeature("auth", (r) => {
          r.translations({ keys: { "${key}": { en: "x" } } });
        });`,
      );
    };
    try {
      writeInstalledFeature("app[1]", "auth.own");
      writeInstalledFeature("app1", "auth.sibling");
      const keys = collectInstalledFrameworkKeys(join(parent, "app[1]"));
      expect(keys.has("auth:auth.own")).toBe(true);
      expect(keys.has("auth:auth.sibling")).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("follows workspace-linked packages that are symlinks into the framework checkout", () => {
    const parent = mkdtempSync(join(tmpdir(), "i18n-linked-"));
    try {
      const linkedPackage = join(parent, "framework/packages/bundled-features");
      mkdirSync(join(linkedPackage, "src"), { recursive: true });
      writeFileSync(
        join(linkedPackage, "src/feature.ts"),
        `export const authFeature = defineFeature("auth", (r) => {
          r.translations({ keys: { "auth.linked": { en: "x" } } });
        });`,
      );
      const scope = join(parent, "app/node_modules/@cosmicdrift");
      mkdirSync(scope, { recursive: true });
      symlinkSync(linkedPackage, join(scope, "kumiko-bundled-features"));
      expect(collectInstalledFrameworkKeys(join(parent, "app")).has("auth:auth.linked")).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
