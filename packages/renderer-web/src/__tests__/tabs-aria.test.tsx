import { describe, expect, test } from "bun:test";
import { DefaultTabs as Tabs } from "../primitives/tabs.js";
import { render, screen } from "./test-utils.js";

describe("DefaultTabs ARIA", () => {
  test("triggers carry no aria-controls since the strip renders no tabpanel", () => {
    render(
      <Tabs
        items={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ]}
        activeId="a"
        onSelect={() => {}}
        testId="tabs"
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) expect(tab.hasAttribute("aria-controls")).toBe(false);
    expect(screen.getByTestId("tabs-a").getAttribute("aria-selected")).toBe("true");
  });
});
