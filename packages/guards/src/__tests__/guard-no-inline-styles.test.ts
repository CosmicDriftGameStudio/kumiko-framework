import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-no-inline-styles";

function parse(source: string, file = "src/features/demo/web/x.tsx") {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(file, source);
}

describe("guard-no-inline-styles", () => {
  test("flags style= props", () => {
    const sf = parse('export function X() { return <table style={{ width: "100%" }} />; }');
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("style=");
  });

  test("flags React.CSSProperties style objects", () => {
    const sf = parse(
      `import type React from "react";
const thStyle: React.CSSProperties = { textAlign: "left" };
export const x = thStyle;`,
      "src/features/demo/web/styles.ts",
    );
    expect(guard.run([sf]).violations).toHaveLength(1);
  });

  test("ignore tag allows dynamic values from data", () => {
    const sf = parse(
      `export function Bar({ pct }: { pct: number }) {
  // kumiko-lint-ignore no-inline-styles Breite kommt aus Laufzeit-Daten
  return <div style={{ width: pct + "%" }} />;
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("clean code passes", () => {
    const sf = parse('export function X() { return <div className="flex" />; }');
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("tag above the opening element covers multi-line attributes", () => {
    const sf = parse(
      `export function X({ bg }: { bg: string }) {
  return (
    // kumiko-lint-ignore no-inline-styles Hintergrundbild aus Laufzeit-Daten
    <div
      className="deck-hero"
      style={{ backgroundImage: bg }}
    />
  );
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });
});
