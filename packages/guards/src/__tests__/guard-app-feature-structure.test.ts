import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-app-feature-structure";

function parse(source: string, file: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(file, source);
}

describe("guard-app-feature-structure", () => {
  test("flaggt web.tsx-Monolith am Feature-Root", () => {
    const sf = parse(`export const screens = {};`, "src/features/money-horse/web.tsx");
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("monolith");
  });

  test("flaggt JSX-Screen am Feature-Root", () => {
    const sf = parse(
      `export function Screen() { return <div />; }`,
      "src/features/demo/screen.tsx",
    );
    expect(guard.run([sf]).violations).toHaveLength(1);
  });

  test("erlaubt Screens unter web/", () => {
    const sf = parse(
      `export function Screen() { return <div />; }`,
      "src/features/demo/web/screen.tsx",
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("flags feature.ts logic dump over the line limit", () => {
    const body = Array.from({ length: 310 }, (_, i) => `// Zeile ${i}`).join("\n");
    const sf = parse(`${body}\nexport const f = 1;`, "src/features/demo/feature.ts");
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("lines");
  });

  test("flags r.screen type custom without an allowlist tag", () => {
    const sf = parse(
      `export const f = (r: { screen: (d: unknown) => void }) => {
  r.screen({ id: "x", type: "custom" });
};`,
      "src/features/demo/feature.ts",
    );
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("custom");
  });

  test("does not flag nested type custom within a declarative r.screen", () => {
    const sf = parse(
      `export const f = (r: { screen: (d: unknown) => void }) => {
  r.screen({ id: "x", type: "entityList", widgets: [{ type: "custom" }] });
};`,
      "src/features/demo/feature.ts",
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("allows custom screen with an allowlist tag and other type props", () => {
    const sf = parse(
      `export const f = (r: { screen: (d: unknown) => void }) => {
  // kumiko-lint-ignore app-feature-structure Designer-Screen, externes UI
  r.screen({ id: "x", type: "custom" });
  r.screen({ id: "y", type: "entityList" });
  const config = { type: "custom" };
  void config;
};`,
      "src/features/demo/feature.ts",
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("flags r.screen type custom without an allowlist tag in packages/bundled-features", () => {
    const sf = parse(
      `export const f = (r: { screen: (d: unknown) => void }) => {
  r.screen({ id: "x", type: "custom" });
};`,
      "packages/bundled-features/src/demo/feature.ts",
    );
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("custom");
  });

  test("allows custom screen with an allowlist tag in packages/bundled-features", () => {
    const sf = parse(
      `export const f = (r: { screen: (d: unknown) => void }) => {
  // kumiko-lint-ignore app-feature-structure Auth-Flow, kein deklarativer Screen-Typ
  r.screen({ id: "x", type: "custom" });
};`,
      "packages/bundled-features/src/demo/feature.ts",
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("flags feature.ts logic dump over the line limit in packages/bundled-features", () => {
    const body = Array.from({ length: 310 }, (_, i) => `// Zeile ${i}`).join("\n");
    const sf = parse(
      `${body}\nexport const f = 1;`,
      "packages/bundled-features/src/demo/feature.ts",
    );
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("lines");
  });

  test("scan includes bundled-features src paths", () => {
    expect(guard.scan.frameworkWithin?.some((g) => g.includes("bundled-features"))).toBe(true);
  });
});

describe("guard-app-feature-structure: @runtime client marker", () => {
  test("flags the marker outside web/ as client code in the server tree", () => {
    const sf = parse(
      `// @runtime client\nexport const FEATURE = "demo";`,
      "src/features/demo/constants.ts",
    );
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("move it under web/");
  });

  test("flags the marker under web/ as redundant", () => {
    const sf = parse(
      `// @runtime client\nexport const FEATURE = "demo";`,
      "src/features/demo/web/constants.ts",
    );
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("redundant");
  });

  test("flags the marker under dev/ and scripts/ without recommending a move to web/", () => {
    for (const dir of ["dev", "scripts"]) {
      const sf = parse(
        `// @runtime client\nexport const x = 1;`,
        `src/features/demo/${dir}/seed.ts`,
      );
      const message = guard.run([sf]).violations[0]?.message ?? "";
      expect(message).toContain("remove the marker");
      expect(message).not.toContain("move it under web/");
    }
  });

  test("also applies in bundled-features and to nested paths", () => {
    const sf = parse(
      `// @runtime client\nexport const x = 1;`,
      "packages/bundled-features/src/billing-foundation/consumer-protection/consent-locale.ts",
    );
    expect(guard.run([sf]).violations).toHaveLength(1);
  });

  test("leaves files without a marker and other markers alone", () => {
    const plain = parse(`export const x = 1;`, "src/features/demo/constants.ts");
    const dev = parse(`// @runtime dev\nexport const x = 1;`, "src/features/demo/seed.ts");
    expect(guard.run([plain, dev]).violations).toHaveLength(0);
  });
});
