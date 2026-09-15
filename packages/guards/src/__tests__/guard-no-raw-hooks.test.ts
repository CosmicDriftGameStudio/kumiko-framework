import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-no-raw-hooks";

function parse(source: string, file = "src/features/demo/web/screen.tsx") {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(file, source);
}

describe("guard-no-raw-hooks", () => {
  test("flags useEffect in app screens", () => {
    const sf = parse(
      `import { useEffect } from "react";
export function X() {
  useEffect(() => {}, []);
  return null;
}`,
    );
    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("useEffect");
  });

  test("flags fetch() in app screens", () => {
    const sf = parse(
      `export function X() {
  void fetch("/api/x");
  return null;
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(1);
  });

  test("allows useState (local UI state) and framework hooks", () => {
    const sf = parse(
      `import { useState } from "react";
import { useQuery, useMutation } from "@cosmicdrift/kumiko-renderer";
export function X() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery("f:query:x:list", {});
  const { mutate } = useMutation("f:write:x:create");
  void [open, setOpen, data, mutate];
  return null;
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("ignore tag allows a DOM-integration special case", () => {
    const sf = parse(
      `import { useEffect } from "react";
export function X() {
  // kumiko-lint-ignore no-raw-hooks ResizeObserver-Anbindung, kein Query-Lifecycle
  useEffect(() => {}, []);
  return null;
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });
});
