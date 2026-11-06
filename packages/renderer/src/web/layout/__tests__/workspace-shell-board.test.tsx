import { beforeEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import type { FeatureSchema } from "../../../index.ts";
import { render } from "../../__tests__/test-utils.tsx";
import { WorkspaceShell } from "../workspace-shell.tsx";

const schema = {
  featureName: "inbox",
  entities: {},
  screens: [{ id: "inbox", type: "entityList", entity: "x", columns: [] }],
  navs: [{ id: "inbox", label: "Posteingang", screen: "inbox", icon: "list", order: 10 }],
} as FeatureSchema;

function Harness(props: {
  readonly contentSurface?: "card" | "background";
  readonly navStyle?: "default" | "plain";
}): ReactNode {
  return (
    <WorkspaceShell brand={<span>Brand</span>} schema={schema} {...props}>
      <span>Body</span>
    </WorkspaceShell>
  );
}

function inset(): Element | null {
  return document.querySelector('[data-slot="sidebar-inset"]');
}

function navIcons(): readonly Element[] {
  return [...document.querySelectorAll('[data-sidebar="menu-button"] svg')];
}

describe("WorkspaceShell contentSurface", () => {
  beforeEach(() => window.localStorage.clear());

  test("defaults to the card surface", () => {
    render(<Harness />);
    expect(inset()?.classList.contains("bg-card")).toBe(true);
    expect(inset()?.classList.contains("bg-background")).toBe(false);
  });

  test('"background" swaps the inset to the page background', () => {
    render(<Harness contentSurface="background" />);
    expect(inset()?.classList.contains("bg-background")).toBe(true);
    expect(inset()?.classList.contains("bg-card")).toBe(false);
  });
});

describe("WorkspaceShell navStyle", () => {
  beforeEach(() => window.localStorage.clear());

  test("default keeps the leading icons visible and the header at its normal height", () => {
    render(<Harness />);
    expect(navIcons().length).toBeGreaterThan(0);
    expect(navIcons().every((icon) => !icon.classList.contains("hidden"))).toBe(true);
    expect(document.querySelector('[data-nav-style="plain"]')).toBeNull();
  });

  test("plain hides the expanded leading icons (they stay for the collapsed rail) and marks the header", () => {
    render(<Harness navStyle="plain" />);
    const icons = navIcons();
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.classList.contains("hidden")).toBe(true);
      expect(icon.classList.contains("group-data-[collapsible=icon]:block")).toBe(true);
    }
    const header = document.querySelector('[data-kumiko-layout="shell-header"]');
    expect(header?.getAttribute("data-nav-style")).toBe("plain");
  });

  test("plain shows the drawn panel symbol on every width in the header trigger", () => {
    render(<Harness navStyle="plain" />);
    const trigger = document.querySelector('[data-slot="sidebar-trigger"]');
    expect(trigger?.querySelectorAll("svg").length).toBe(1);
    expect(trigger?.querySelector("svg")?.classList.contains("lucide-drawn-panel")).toBe(true);
    expect(trigger?.querySelector("svg")?.classList.contains("md:hidden")).toBe(false);
  });

  test("default trigger keeps the panel icon for desktop and the hamburger for phones", () => {
    render(<Harness />);
    const trigger = document.querySelector('[data-slot="sidebar-trigger"]');
    expect(trigger?.querySelectorAll("svg").length).toBe(2);
  });
});
