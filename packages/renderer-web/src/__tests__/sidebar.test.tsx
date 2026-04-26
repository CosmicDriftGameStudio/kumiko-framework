// @vitest-environment jsdom
//
// Sidebar: 4-Slot-Layout (header, actions, children, footer). Pinnt
// dass die Sektionen conditional rendern UND in der richtigen
// Reihenfolge stehen — header → actions → nav → footer.

import { describe, expect, test } from "vitest";
import { Sidebar } from "../layout/sidebar";
import { render, screen } from "./test-utils";

describe("Sidebar", () => {
  test("alle 4 Slots gesetzt — rendern in Header → Actions → Nav → Footer Reihenfolge", () => {
    render(
      <Sidebar
        header={<span data-testid="h">brand</span>}
        actions={<span data-testid="a">icons</span>}
        footer={<span data-testid="f">profile</span>}
        testId="sidebar"
      >
        <span data-testid="n">nav-content</span>
      </Sidebar>,
    );
    const sidebar = screen.getByTestId("sidebar");
    const header = sidebar.querySelector('[data-kumiko-layout="sidebar-header"]');
    const actions = sidebar.querySelector('[data-kumiko-layout="sidebar-actions"]');
    const nav = sidebar.querySelector('[data-kumiko-layout="sidebar-nav"]');
    const footer = sidebar.querySelector('[data-kumiko-layout="sidebar-footer"]');

    expect(header).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(nav).not.toBeNull();
    expect(footer).not.toBeNull();

    // Reihenfolge im DOM: header < actions < nav < footer
    const children = Array.from(sidebar.children);
    expect(children.indexOf(header as Element)).toBeLessThan(children.indexOf(actions as Element));
    expect(children.indexOf(actions as Element)).toBeLessThan(children.indexOf(nav as Element));
    expect(children.indexOf(nav as Element)).toBeLessThan(children.indexOf(footer as Element));

    // Inhalte landen im richtigen Slot
    expect(header?.contains(screen.getByTestId("h"))).toBe(true);
    expect(actions?.contains(screen.getByTestId("a"))).toBe(true);
    expect(nav?.contains(screen.getByTestId("n"))).toBe(true);
    expect(footer?.contains(screen.getByTestId("f"))).toBe(true);
  });

  test("nur children gesetzt — Header/Actions/Footer nicht gerendert", () => {
    render(
      <Sidebar testId="sidebar">
        <span data-testid="n">nav</span>
      </Sidebar>,
    );
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar.querySelector('[data-kumiko-layout="sidebar-header"]')).toBeNull();
    expect(sidebar.querySelector('[data-kumiko-layout="sidebar-actions"]')).toBeNull();
    expect(sidebar.querySelector('[data-kumiko-layout="sidebar-footer"]')).toBeNull();
    expect(sidebar.querySelector('[data-kumiko-layout="sidebar-nav"]')).not.toBeNull();
  });
});
