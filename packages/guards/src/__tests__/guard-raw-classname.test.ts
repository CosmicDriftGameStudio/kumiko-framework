import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-raw-classname";

function parse(source: string, file = "src/features/demo/web/x.tsx") {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(file, source);
}

describe("guard-raw-classname", () => {
  test("flags default-palette colors", () => {
    const sf = parse('export function X() { return <div className="bg-red-500 p-4" />; }');
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("bg-red-500");
  });

  test("flags arbitrary color values and modifier prefixes", () => {
    const sf = parse(
      'export function X() { return <span className="hover:text-[#ff0000] flex" />; }',
    );
    expect(guard.run([sf]).violations).toHaveLength(1);
  });

  test("flags shadow- even in cn()/template compositions", () => {
    const sf = parse(
      `import { cn } from "x";
export function X({ active }: { active: boolean }) {
  return <div className={cn("border", active && "shadow-md")} />;
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(1);
  });

  test("allows layout utilities, theme-token classes and rounded-*", () => {
    const sf = parse(
      'export function X() { return <div className="flex h-full flex-col gap-4 rounded-lg bg-primary text-status-ok p-6" />; }',
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("ignore tag on the previous line allows a justified exception", () => {
    const sf = parse(
      `export function X() {
  return (
    // kumiko-lint-ignore raw-classname Brand-Farbverlauf im Marketing-Hero
    <div className="bg-purple-600" />
  );
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("test files are skipped", () => {
    const sf = parse(
      'export function X() { return <div className="bg-red-500" />; }',
      "src/features/demo/__tests__/x.test.tsx",
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("ignore tag above a multi-line className={cn(...)} tag allows the exception", () => {
    const sf = parse(
      `import { cn } from "x";
export function X({ active }: { active: boolean }) {
  return (
    // kumiko-lint-ignore raw-classname Brand-Farbverlauf im Marketing-Hero
    <div
      className={cn("bg-red-500", active && "flex")}
      onClick={() => {}}
    />
  );
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });
});
