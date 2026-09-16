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
    expect(outcome.violations[0]?.message).toContain("Monolith");
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

  test("flaggt feature.ts-Logik-Dump über dem Zeilen-Limit", () => {
    const body = Array.from({ length: 310 }, (_, i) => `// Zeile ${i}`).join("\n");
    const sf = parse(`${body}\nexport const f = 1;`, "src/features/demo/feature.ts");
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("Zeilen");
  });

  test("flaggt r.screen type custom ohne Allowlist-Tag", () => {
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

  test("erlaubt custom-Screen mit Allowlist-Tag und andere type-Props", () => {
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

  test("flaggt r.screen type custom ohne Allowlist-Tag in packages/bundled-features", () => {
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

  test("erlaubt custom-Screen mit Allowlist-Tag in packages/bundled-features", () => {
    const sf = parse(
      `export const f = (r: { screen: (d: unknown) => void }) => {
  // kumiko-lint-ignore app-feature-structure Auth-Flow, kein deklarativer Screen-Typ
  r.screen({ id: "x", type: "custom" });
};`,
      "packages/bundled-features/src/demo/feature.ts",
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("flaggt feature.ts-Logik-Dump über dem Zeilen-Limit in packages/bundled-features", () => {
    const body = Array.from({ length: 310 }, (_, i) => `// Zeile ${i}`).join("\n");
    const sf = parse(
      `${body}\nexport const f = 1;`,
      "packages/bundled-features/src/demo/feature.ts",
    );
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("Zeilen");
  });

  test("scan includes bundled-features src paths", () => {
    expect(guard.scan.frameworkWithin?.some((g) => g.includes("bundled-features"))).toBe(true);
  });
});
