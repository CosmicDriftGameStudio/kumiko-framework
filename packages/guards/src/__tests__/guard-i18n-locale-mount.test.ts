import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import {
  findViolations,
  hasLocaleDeDependency,
  nearestPackageJson,
} from "../guard-i18n-locale-mount";

function gatedProject(): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  project.getFileSystem().writeFileSync(
    "/repo/package.json",
    JSON.stringify({
      name: "repo",
      dependencies: { "@cosmicdrift/kumiko-locale-de": "0.1.0" },
    }),
  );
  return project;
}

function ungatedProject(): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  project.getFileSystem().writeFileSync("/repo/package.json", JSON.stringify({ name: "repo" }));
  return project;
}

describe("guard-i18n-locale-mount — nearestPackageJson", () => {
  test("walks up from a nested src dir to the repo package.json", () => {
    const project = gatedProject();
    const fs = project.getFileSystem();
    expect(nearestPackageJson(fs, "/repo/src/features/x/web")).toBe("/repo/package.json");
  });

  test("returns undefined when no package.json exists anywhere above", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const fs = project.getFileSystem();
    expect(nearestPackageJson(fs, "/nowhere/src")).toBeUndefined();
  });
});

describe("guard-i18n-locale-mount — hasLocaleDeDependency", () => {
  test("true for a dependencies entry", () => {
    const project = gatedProject();
    expect(hasLocaleDeDependency(project.getFileSystem(), "/repo/package.json")).toBe(true);
  });

  test("true for a devDependencies entry", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.getFileSystem().writeFileSync(
      "/repo/package.json",
      JSON.stringify({
        name: "repo",
        devDependencies: { "@cosmicdrift/kumiko-locale-de": "0.1.0" },
      }),
    );
    expect(hasLocaleDeDependency(project.getFileSystem(), "/repo/package.json")).toBe(true);
  });

  test("false when the dependency is absent", () => {
    const project = ungatedProject();
    expect(hasLocaleDeDependency(project.getFileSystem(), "/repo/package.json")).toBe(false);
  });

  test("false on unparsable package.json instead of throwing", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.getFileSystem().writeFileSync("/repo/package.json", "{ not json");
    expect(hasLocaleDeDependency(project.getFileSystem(), "/repo/package.json")).toBe(false);
  });
});

describe("guard-i18n-locale-mount — client mount points", () => {
  test("createKumikoApp with localeDeClient() in clientFeatures is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/app/mount.tsx",
      `createKumikoApp({ shell: X, clientFeatures: [localeDeClient(), other()] });\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("createKumikoApp without localeDeClient() is flagged", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/app/mount.tsx",
      `createKumikoApp({ shell: X, clientFeatures: [other()] });`,
    );
    const violations = findViolations([sf]);
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });

  test("createPublicSurface without clientFeatures at all is flagged", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/public/mount.tsx",
      `createPublicSurface({ shell: X });`,
    );
    const violations = findViolations([sf]);
    expect(violations.some((v) => v.message.includes('"createPublicSurface(...)"'))).toBe(true);
  });

  test("a file with no mount marker at all (legit opt-out) is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/landing-mount.tsx",
      `export const x = <div>static</div>;\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("same violation in an ungated repo (no locale-de dependency) is not flagged", () => {
    const project = ungatedProject();
    const sf = project.createSourceFile(
      "/repo/src/app/mount.tsx",
      `createKumikoApp({ shell: X, clientFeatures: [other()] });`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("raw LocaleProvider with a de fallback bundle is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `const x = <LocaleProvider resolver={r} fallbackBundles={[{ de: bundle }, defaultTranslations]}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("raw LocaleProvider without a de fallback bundle is flagged (kumiko-studio#191 shape)", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `const x = <LocaleProvider resolver={r} fallbackBundles={[defaultTranslations]}>{y}</LocaleProvider>;`,
    );
    const violations = findViolations([sf]);
    expect(violations.some((v) => v.message.includes("LocaleProvider"))).toBe(true);
  });

  test("fallbackBundles on an unrelated component is ignored", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/other.tsx",
      `const x = <SomethingElse fallbackBundles={[defaultTranslations]} />;\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });
});

// fallbackBundles may be an identifier to a same-repo array constant,
// optionally wrapped in `as const` / `satisfies`.
describe("guard-i18n-locale-mount — fallbackBundles identifier and as-const resolution", () => {
  test("fallbackBundles as a bare identifier (no as const) resolving to a German bundle is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `export const AUTH_FALLBACK_BUNDLES = [{ de: bundle }, defaultTranslations];\nconst x = <LocaleProvider resolver={r} fallbackBundles={AUTH_FALLBACK_BUNDLES}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("fallbackBundles as a bare identifier declared with as const resolving to a German bundle is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `export const AUTH_FALLBACK_BUNDLES = [{ de: bundle }, defaultTranslations] as const;\nconst x = <LocaleProvider resolver={r} fallbackBundles={AUTH_FALLBACK_BUNDLES}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("fallbackBundles={[...CONST]} spread (no as const) resolving to a German bundle is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `export const AUTH_FALLBACK_BUNDLES = [{ de: bundle }, defaultTranslations];\nconst x = <LocaleProvider resolver={r} fallbackBundles={[...AUTH_FALLBACK_BUNDLES]}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("fallbackBundles={[...CONST]} spread declared with as const resolving to a German bundle is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `export const AUTH_FALLBACK_BUNDLES = [{ de: bundle }, defaultTranslations] as const;\nconst x = <LocaleProvider resolver={r} fallbackBundles={[...AUTH_FALLBACK_BUNDLES]}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  // `as const satisfies T[]` is in active use for other constants and must
  // keep resolving for fallback-bundles arrays.
  test("fallbackBundles as a bare identifier declared with as const satisfies T[] resolving to a German bundle is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `export const AUTH_FALLBACK_BUNDLES = [{ de: bundle }, defaultTranslations] as const satisfies readonly unknown[];\nconst x = <LocaleProvider resolver={r} fallbackBundles={AUTH_FALLBACK_BUNDLES}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("fallbackBundles as a bare identifier to a constant without a German bundle is still flagged", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `export const FALLBACK_BUNDLES = [defaultTranslations] as const;\nconst x = <LocaleProvider resolver={r} fallbackBundles={FALLBACK_BUNDLES}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    const violations = findViolations([sf]);
    expect(violations.some((v) => v.message.includes("LocaleProvider"))).toBe(true);
  });

  test("fallbackBundles={[...CONST]} spread to a constant without a German bundle is still flagged", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `export const FALLBACK_BUNDLES = [defaultTranslations] as const;\nconst x = <LocaleProvider resolver={r} fallbackBundles={[...FALLBACK_BUNDLES]}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    const violations = findViolations([sf]);
    expect(violations.some((v) => v.message.includes("LocaleProvider"))).toBe(true);
  });
});

describe("guard-i18n-locale-mount — server-side localeDe()", () => {
  test("at least one localeDe() call anywhere in the gated repo is enough", () => {
    const project = gatedProject();
    const runConfig = project.createSourceFile(
      "/repo/src/run-config.ts",
      `export const features = [localeDe()];`,
    );
    const mount = project.createSourceFile(
      "/repo/src/app/mount.tsx",
      `createKumikoApp({ shell: X, clientFeatures: [localeDeClient()] });`,
    );
    expect(findViolations([runConfig, mount])).toHaveLength(0);
  });

  test("no localeDe() call anywhere in a gated repo is flagged against package.json", () => {
    const project = gatedProject();
    const runConfig = project.createSourceFile(
      "/repo/src/run-config.ts",
      `export const features = [];`,
    );
    const violations = findViolations([runConfig]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("/repo/package.json");
    expect(violations[0]?.message).toContain("server-side localeDe() call");
  });

  test("an ungated repo never gets a server-side finding", () => {
    const project = ungatedProject();
    const runConfig = project.createSourceFile(
      "/repo/src/run-config.ts",
      `export const features = [];`,
    );
    expect(findViolations([runConfig])).toHaveLength(0);
  });

  test("localeDeClient().translations spread in clientFeatures is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/app/mount.tsx",
      `createKumikoApp({ shell: X, clientFeatures: [...localeDeClient(), other()] });\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("localeDeClient().translations as LocaleProvider fallback element is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `const x = <LocaleProvider resolver={r} fallbackBundles={[localeDeClient().translations, defaultTranslations]}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    expect(findViolations([sf])).toHaveLength(0);
  });

  test("identifier spread of a list that includes localeDeClient() is clean", () => {
    const project = gatedProject();
    const features = project.createSourceFile(
      "/repo/src/app-client-features.tsx",
      `export const clientFeatures = [localeDeClient(), profileScreen];`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `import { clientFeatures } from "./app-client-features";\ncreateKumikoApp({ shell: X, clientFeatures: [...clientFeatures, extra()] });\nlocaleDe();`,
    );
    expect(findViolations([features, mount])).toHaveLength(0);
  });

  // A same-named declaration in a foreign repo must never be picked up by
  // identifier name: with no import binding the spread is unresolvable and
  // fails open, instead of being flagged by the foreign (German-less) list.
  test("identifier spread without an import binding does not resolve to a same-named foreign array", () => {
    const project = gatedProject();
    project
      .getFileSystem()
      .writeFileSync("/other-repo/package.json", JSON.stringify({ name: "other-repo" }));
    project.createSourceFile(
      "/other-repo/src/app-client-features.tsx",
      `export const clientFeatures = [otherFeature()];`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `createKumikoApp({ shell: X, clientFeatures: [...clientFeatures, extra()] });\nlocaleDe();`,
    );
    expect(findViolations([mount])).toHaveLength(0);
  });

  test("identifier spread of a list missing localeDeClient() is flagged, not fail-opened", () => {
    const project = gatedProject();
    const features = project.createSourceFile(
      "/repo/src/app-client-features.tsx",
      `export const clientFeatures = [profileScreen];`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `import { clientFeatures } from "./app-client-features";\ncreateKumikoApp({ shell: X, clientFeatures: [...clientFeatures, extra()] });\nlocaleDe();`,
    );
    const violations = findViolations([features, mount]);
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });

  // A relative import that escapes the mount's own package.json root (e.g. a
  // monorepo layout mistake) must fail-open rather than trust a declaration
  // living under a different repo root.
  test("identifier spread that resolves outside the mount's own repo fails open", () => {
    const project = gatedProject();
    project
      .getFileSystem()
      .writeFileSync("/other-repo/package.json", JSON.stringify({ name: "other-repo" }));
    project.createSourceFile(
      "/other-repo/src/app-client-features.tsx",
      `export const clientFeatures = [otherFeature()];`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `import { clientFeatures } from "../../other-repo/src/app-client-features";\ncreateKumikoApp({ shell: X, clientFeatures: [...clientFeatures, extra()] });\nlocaleDe();`,
    );
    expect(findViolations([mount])).toHaveLength(0);
  });

  const mountWith = (options: string, extra = "") => {
    const project = gatedProject();
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `${extra}createKumikoApp(${options});\nlocaleDe();`,
    );
    return findViolations([mount]);
  };

  test("conditional `cond && { locale }` spread after German clientFeatures is clean", () => {
    expect(
      mountWith(
        "{ shell: X, clientFeatures: [localeDeClient()], ...(opts?.locale !== undefined && { locale: opts.locale }) }",
      ),
    ).toHaveLength(0);
  });

  test("conditional ternary spread without clientFeatures keeps the earlier German property", () => {
    expect(
      mountWith(
        "{ shell: X, clientFeatures: [localeDeClient()], ...(cond ? { locale: 'de' } : {}) }",
      ),
    ).toHaveLength(0);
  });

  test("conditional spread setting German clientFeatures is clean", () => {
    expect(
      mountWith("{ shell: X, ...(cond && { clientFeatures: [localeDeClient()] }) }"),
    ).toHaveLength(0);
  });

  test("conditional spread setting clientFeatures without German is still flagged", () => {
    expect(
      mountWith("{ shell: X, ...(cond && { clientFeatures: [emailPasswordClient()] }) }"),
    ).toHaveLength(1);
  });

  test("ternary spread where one branch lacks German is flagged", () => {
    expect(
      mountWith(
        "{ shell: X, ...(cond ? { clientFeatures: [localeDeClient()] } : { clientFeatures: [other()] }) }",
      ),
    ).toHaveLength(1);
  });

  test("conditional spread of an unresolvable call stays fail-closed", () => {
    expect(
      mountWith("{ shell: X, clientFeatures: [other()], ...(cond && buildOptions()) }"),
    ).toHaveLength(1);
  });

  // money-horse's shape: `createKumikoApp({ shell: X, clientFeatures })` is a
  // ShorthandPropertyAssignment, a different AST node than `clientFeatures: [...]`.
  test("shorthand clientFeatures property resolving to a German-registering array is clean", () => {
    const project = gatedProject();
    const features = project.createSourceFile(
      "/repo/src/app-client-features.tsx",
      `export const clientFeatures = [localeDeClient(), profileScreen];`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client.tsx",
      `import { clientFeatures } from "./app-client-features";\ncreateKumikoApp({ shell: X, clientFeatures });\nlocaleDe();`,
    );
    expect(findViolations([features, mount])).toHaveLength(0);
  });

  test("shorthand clientFeatures property resolving to an array missing localeDeClient() is flagged", () => {
    const project = gatedProject();
    const features = project.createSourceFile(
      "/repo/src/app-client-features.tsx",
      `export const clientFeatures = [profileScreen];`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client.tsx",
      `import { clientFeatures } from "./app-client-features";\ncreateKumikoApp({ shell: X, clientFeatures });\nlocaleDe();`,
    );
    const violations = findViolations([features, mount]);
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });
});

// clientFeatures may live inside an options object spread into the call
// (`createKumikoApp({ ...APP_OPTIONS, locale })`) instead of being a literal
// property at the call site, so the lookup follows the spread's source.
describe("guard-i18n-locale-mount — options object spread resolution", () => {
  test("createKumikoApp({ ...APP_OPTIONS, locale }) where APP_OPTIONS carries clientFeatures with localeDeClient() is clean (offlot-app#296 shape)", () => {
    const project = gatedProject();
    const options = project.createSourceFile(
      "/repo/src/app-options.tsx",
      `export const APP_OPTIONS = { shell: X, clientFeatures: [localeDeClient(), profileScreen] };`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `import { APP_OPTIONS } from "./app-options";\ncreateKumikoApp({ ...APP_OPTIONS, locale: resolver() });\nlocaleDe();`,
    );
    expect(findViolations([options, mount])).toHaveLength(0);
  });

  test("createKumikoApp({ ...APP_OPTIONS, locale }) where APP_OPTIONS's clientFeatures is missing localeDeClient() is still flagged", () => {
    const project = gatedProject();
    const options = project.createSourceFile(
      "/repo/src/app-options.tsx",
      `export const APP_OPTIONS = { shell: X, clientFeatures: [profileScreen] };`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `import { APP_OPTIONS } from "./app-options";\ncreateKumikoApp({ ...APP_OPTIONS, locale: resolver() });\nlocaleDe();`,
    );
    const violations = findViolations([options, mount]);
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });

  test("createKumikoApp({ ...externalOpts }) with an unresolvable/cross-repo spread source is fail-closed (still flagged, not silently passed)", () => {
    const project = gatedProject();
    project
      .getFileSystem()
      .writeFileSync("/other-repo/package.json", JSON.stringify({ name: "other-repo" }));
    project.createSourceFile(
      "/other-repo/src/app-options.tsx",
      `export const APP_OPTIONS = { clientFeatures: [localeDeClient()] };`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `import { APP_OPTIONS } from "../../other-repo/src/app-options";\ncreateKumikoApp({ ...APP_OPTIONS, locale: resolver() });\nlocaleDe();`,
    );
    const violations = findViolations([mount]);
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });

  test("clientFeatures pulled two hops through a shorthand re-export inside the spread source is clean", () => {
    const project = gatedProject();
    const features = project.createSourceFile(
      "/repo/src/app-client-features.tsx",
      `export const clientFeatures = [localeDeClient(), profileScreen];`,
    );
    const options = project.createSourceFile(
      "/repo/src/app-options.tsx",
      `import { clientFeatures } from "./app-client-features";\nexport const APP_OPTIONS = { shell: X, clientFeatures };`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `import { APP_OPTIONS } from "./app-options";\ncreateKumikoApp({ ...APP_OPTIONS, locale: resolver() });\nlocaleDe();`,
    );
    expect(findViolations([features, options, mount])).toHaveLength(0);
  });

  test("nested options spread (APP_OPTIONS spreads BASE_OPTIONS) resolves clientFeatures through both hops", () => {
    const project = gatedProject();
    const base = project.createSourceFile(
      "/repo/src/base-options.tsx",
      `export const BASE_OPTIONS = { shell: X, clientFeatures: [localeDeClient(), profileScreen] };`,
    );
    const options = project.createSourceFile(
      "/repo/src/app-options.tsx",
      `import { BASE_OPTIONS } from "./base-options";\nexport const APP_OPTIONS = { ...BASE_OPTIONS, extra: true };`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `import { APP_OPTIONS } from "./app-options";\ncreateKumikoApp({ ...APP_OPTIONS, locale: resolver() });\nlocaleDe();`,
    );
    expect(findViolations([base, options, mount])).toHaveLength(0);
  });

  test("a literal clientFeatures property at the call site still wins over a spread source's own (non-German) clientFeatures (existing workaround keeps working)", () => {
    const project = gatedProject();
    const options = project.createSourceFile(
      "/repo/src/app-options.tsx",
      `export const APP_OPTIONS = { shell: X, clientFeatures: [profileScreen] };`,
    );
    const mount = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `import { APP_OPTIONS } from "./app-options";\ncreateKumikoApp({ ...APP_OPTIONS, locale: resolver(), clientFeatures: [localeDeClient()] });\nlocaleDe();`,
    );
    expect(findViolations([options, mount])).toHaveLength(0);
  });
});

describe("guard-i18n-locale-mount — alias cycles and depth", () => {
  test("circular array spread constants end in a violation instead of a stack overflow", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `const a = [...b];\nconst b = [...a];\nconst x = <LocaleProvider resolver={r} fallbackBundles={a}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    const violations = findViolations([sf]);
    expect(violations.some((v) => v.message.includes("LocaleProvider"))).toBe(true);
  });

  test("circular identifier alias for fallbackBundles is flagged, not a crash", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/auth-mount.tsx",
      `const A = B;\nconst B = A;\nconst x = <LocaleProvider resolver={r} fallbackBundles={A}>{y}</LocaleProvider>;\nlocaleDe();`,
    );
    const violations = findViolations([sf]);
    expect(violations.some((v) => v.message.includes("LocaleProvider"))).toBe(true);
  });

  test("circular options spread is flagged, not a crash", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `const A = { ...B };\nconst B = { ...A };\ncreateKumikoApp({ ...A });\nlocaleDe();`,
    );
    const violations = findViolations([sf]);
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });

  test("an options spread chain deeper than the depth bound is fail-closed", () => {
    const project = gatedProject();
    const chain = [
      `const O0 = { clientFeatures: [localeDeClient()] };`,
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `const O${n} = { ...O${n - 1} };`),
    ].join("\n");
    const sf = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `${chain}\ncreateKumikoApp({ ...O7 });\nlocaleDe();`,
    );
    const violations = findViolations([sf]);
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });
});

describe("guard-i18n-locale-mount — options identifier, wrappers and override order", () => {
  function mountWith(options: string, mountCall: string): ReturnType<typeof findViolations> {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/client-app.tsx",
      `${options}\n${mountCall}\nlocaleDe();`,
    );
    return findViolations([sf]);
  }

  test("createKumikoApp(APP_OPTIONS) with an identifier argument resolving to German clientFeatures is clean", () => {
    const violations = mountWith(
      `const APP_OPTIONS = { shell: X, clientFeatures: [localeDeClient()] };`,
      `createKumikoApp(APP_OPTIONS);`,
    );
    expect(violations).toHaveLength(0);
  });

  test("createKumikoApp(APP_OPTIONS) resolving to options without German is flagged", () => {
    const violations = mountWith(
      `const APP_OPTIONS = { shell: X, clientFeatures: [profileScreen] };`,
      `createKumikoApp(APP_OPTIONS);`,
    );
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });

  test("an `as` cast on the mount argument is unwrapped", () => {
    const violations = mountWith(
      `const APP_OPTIONS = { shell: X, clientFeatures: [localeDeClient()] };`,
      `createKumikoApp(APP_OPTIONS as AppOptions);`,
    );
    expect(violations).toHaveLength(0);
  });

  test("a `satisfies` on an inline options literal is unwrapped", () => {
    const violations = mountWith(
      ``,
      `createKumikoApp({ shell: X, clientFeatures: [localeDeClient()] } satisfies AppOptions);`,
    );
    expect(violations).toHaveLength(0);
  });

  test("a parenthesized, cast spread source is unwrapped", () => {
    const violations = mountWith(
      `const APP_OPTIONS = { shell: X, clientFeatures: [localeDeClient()] };`,
      `createKumikoApp({ ...(APP_OPTIONS as AppOptions), locale: r });`,
    );
    expect(violations).toHaveLength(0);
  });

  test("a later spread that overrides a German clientFeatures property is flagged", () => {
    const violations = mountWith(
      `const APP_OPTIONS = { clientFeatures: [profileScreen] };`,
      `createKumikoApp({ clientFeatures: [localeDeClient()], ...APP_OPTIONS });`,
    );
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });

  test("a later spread without clientFeatures does not override an earlier German property", () => {
    const violations = mountWith(
      `const APP_OPTIONS = { shell: X };`,
      `createKumikoApp({ clientFeatures: [localeDeClient()], ...APP_OPTIONS });`,
    );
    expect(violations).toHaveLength(0);
  });

  test("with two spreads the later clientFeatures wins: a German-less later spread is flagged", () => {
    const violations = mountWith(
      [
        `const GERMAN = { clientFeatures: [localeDeClient()] };`,
        `const PLAIN = { clientFeatures: [profileScreen] };`,
      ].join("\n"),
      `createKumikoApp({ ...GERMAN, ...PLAIN });`,
    );
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });

  test("with two spreads a German later spread wins over a German-less earlier one", () => {
    const violations = mountWith(
      [
        `const GERMAN = { clientFeatures: [localeDeClient()] };`,
        `const PLAIN = { clientFeatures: [profileScreen] };`,
      ].join("\n"),
      `createKumikoApp({ ...PLAIN, ...GERMAN });`,
    );
    expect(violations).toHaveLength(0);
  });

  test("an unresolvable spread after a German property is fail-closed", () => {
    const violations = mountWith(
      ``,
      `createKumikoApp({ clientFeatures: [localeDeClient()], ...externalOptions });`,
    );
    expect(violations.some((v) => v.message.includes("localeDeClient() missing"))).toBe(true);
  });
});

describe("guard-i18n-locale-mount — contextually typed shorthand", () => {
  test("createKumikoApp declared with an options type: shorthand clientFeatures resolving to a local localeDeClient() constant is clean", () => {
    const project = gatedProject();
    const sf = project.createSourceFile(
      "/repo/src/client-app.tsx",
      [
        "type Options = { clientFeatures: unknown[] };",
        "declare function createKumikoApp(options: Options): void;",
        "const clientFeatures = [localeDeClient()];",
        "createKumikoApp({ clientFeatures });",
        "localeDe();",
      ].join("\n"),
    );
    expect(findViolations([sf])).toHaveLength(0);
  });
});
