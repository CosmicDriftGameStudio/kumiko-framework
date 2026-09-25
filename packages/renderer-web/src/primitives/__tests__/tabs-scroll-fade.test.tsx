// Mobile tab strip overflow (390px screenshot feedback): more tabs than fit
// gave no visible scroll hint and the active tab could scroll out of view.
// happy-dom doesn't compute real layout, so scrollWidth/clientWidth/
// offsetLeft/offsetWidth are stubbed per test via Object.defineProperty —
// same pattern as the drawer/upload-zone tests for window properties.

import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "../../__tests__/test-utils";
// Imported directly instead of destructured off `defaultPrimitives`: that
// registry types `Tabs` as optional (older PrimitivesRegistry consumers may
// not have it), so `defaultPrimitives.Tabs` narrows to
// `ComponentType<TabsProps> | undefined` even though it's always assigned
// here — the component under test, not the optional-registry contract.
import { DefaultTabs as Tabs } from "../tabs";

const ITEMS = [
  { id: "items", label: "Items" },
  { id: "payments", label: "Payments" },
  { id: "details", label: "Details" },
  { id: "internal-note", label: "InternalNote" },
];

function stubDimension(
  el: HTMLElement,
  prop: "scrollWidth" | "clientWidth" | "offsetLeft" | "offsetWidth",
  value: number,
) {
  Object.defineProperty(el, prop, { configurable: true, value });
}

function scroller(): HTMLElement {
  const tablist = screen.getByRole("tablist");
  const el = tablist.parentElement;
  if (el === null) throw new Error("scroller not found");
  return el;
}

describe("DefaultTabs mobile overflow scroll hint", () => {
  test("no overflow: no scroll-edge attributes, no mask-image", () => {
    render(<Tabs items={ITEMS} activeId="items" onSelect={() => {}} testId="tabs" />);
    const el = scroller();
    stubDimension(el, "scrollWidth", 300);
    stubDimension(el, "clientWidth", 300);
    fireEvent.scroll(el);
    expect(el.getAttribute("data-scroll-start")).toBeNull();
    expect(el.getAttribute("data-scroll-end")).toBeNull();
    expect(el.style.maskImage).toBeFalsy();
  });

  test("overflowing strip scrolled to the start shows only the end fade", () => {
    render(<Tabs items={ITEMS} activeId="items" onSelect={() => {}} testId="tabs" />);
    const el = scroller();
    stubDimension(el, "scrollWidth", 800);
    stubDimension(el, "clientWidth", 300);
    el.scrollLeft = 0;
    fireEvent.scroll(el);
    expect(el.getAttribute("data-scroll-start")).toBeNull();
    expect(el.getAttribute("data-scroll-end")).toBe("");
    expect(el.style.maskImage).toContain("to left");
  });

  test("overflowing strip scrolled to the middle shows both fades", () => {
    // Active tab is stubbed to sit fully inside [250, 550] so the
    // scroll-active-into-view effect doesn't fight the manual scrollLeft
    // below on the re-render its own setState triggers.
    render(<Tabs items={ITEMS} activeId="payments" onSelect={() => {}} testId="tabs" />);
    const el = scroller();
    stubDimension(el, "scrollWidth", 800);
    stubDimension(el, "clientWidth", 300);
    const activeTrigger = screen.getByRole("tab", { name: "Payments" });
    stubDimension(activeTrigger, "offsetLeft", 260);
    stubDimension(activeTrigger, "offsetWidth", 90);
    el.scrollLeft = 250;
    fireEvent.scroll(el);
    expect(el.getAttribute("data-scroll-start")).toBe("");
    expect(el.getAttribute("data-scroll-end")).toBe("");
    expect(el.style.maskImage).toContain("to right");
    expect(el.style.maskImage).toContain("transparent, black");
  });

  test("selecting a tab scrolled out of view moves scrollLeft (not scrollIntoView) to reveal it", () => {
    const { rerender } = render(
      <Tabs items={ITEMS} activeId="items" onSelect={() => {}} testId="tabs" />,
    );
    const el = scroller();
    stubDimension(el, "scrollWidth", 800);
    stubDimension(el, "clientWidth", 300);
    el.scrollLeft = 0;

    const lastTrigger = screen.getByRole("tab", { name: "InternalNote" });
    stubDimension(lastTrigger, "offsetLeft", 600);
    stubDimension(lastTrigger, "offsetWidth", 150);

    rerender(<Tabs items={ITEMS} activeId="internal-note" onSelect={() => {}} testId="tabs" />);

    expect(el.scrollLeft).toBeGreaterThan(0);
    expect(el.scrollLeft).toBe(600 + 150 - 300);
  });

  test("manual scroll away from the active tab is not snapped back while activeId is unchanged", () => {
    // Active tab is the first item, so its (unstubbed, default) offsetLeft
    // is 0 — scrolling away from it is exactly the case the scroll-to-active
    // effect used to "fix" on every render, including the render the scroll
    // listener's own setScrollStart/End triggers.
    render(<Tabs items={ITEMS} activeId="items" onSelect={() => {}} testId="tabs" />);
    const el = scroller();
    stubDimension(el, "scrollWidth", 800);
    stubDimension(el, "clientWidth", 300);
    el.scrollLeft = 250;
    fireEvent.scroll(el);
    expect(el.scrollLeft).toBe(250);
  });
});
