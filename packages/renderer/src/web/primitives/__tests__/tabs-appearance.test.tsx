import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { DefaultTabs as Tabs } from "../tabs.tsx";

const ITEMS = [
  { id: "mail", label: "Mail", icon: <svg data-testid="mail-icon" /> },
  { id: "contract", label: "Vertrag.pdf", detail: "4 Seiten", count: 2 },
];

describe("DefaultTabs appearance", () => {
  test("pill (default) keeps the count badge and the 44px strip", () => {
    render(<Tabs items={ITEMS} activeId="mail" onSelect={() => {}} testId="tabs" />);
    expect(screen.getByTestId("tabs-contract-count").className).toContain("rounded-full");
    expect(screen.getByRole("tablist").className).toContain("h-11");
  });

  test("plain renders the count as a muted number without background and a 40px strip", () => {
    render(
      <Tabs items={ITEMS} activeId="mail" onSelect={() => {}} appearance="plain" testId="tabs" />,
    );
    const count = screen.getByTestId("tabs-contract-count");
    expect(count.textContent).toBe("2");
    expect(count.className).toContain("text-muted-foreground");
    expect(count.className).not.toContain("rounded-full");
    expect(count.className).not.toContain("bg-");
    expect(screen.getByRole("tablist").className).toContain("h-10");
  });

  test("plain pads each tab and sits flush with its content; filter insets the strip without gaps", () => {
    const { unmount } = render(
      <Tabs items={ITEMS} activeId="mail" onSelect={() => {}} appearance="plain" testId="tabs" />,
    );
    expect(screen.getByTestId("tabs-mail").className).toContain("px-2.5");
    expect(screen.getByRole("tablist").parentElement?.className).toContain("px-0");
    expect(screen.getByRole("tablist").className).toContain("gap-1");
    expect(screen.getByTestId("tabs-contract-count").className).not.toContain("ml-1.5");
    unmount();

    render(
      <Tabs items={ITEMS} activeId="mail" onSelect={() => {}} appearance="filter" testId="tabs" />,
    );
    expect(screen.getByTestId("tabs-mail").className).toContain("px-2.5");
    expect(screen.getByRole("tablist").parentElement?.className).toContain("px-1.5");
    expect(screen.getByRole("tablist").className).toContain("gap-0");
    expect(screen.getByRole("tablist").className).toContain("h-10");
    expect(screen.getByTestId("tabs-contract-count").className).not.toContain("rounded-full");
  });

  test("icon renders before the label and detail after it", () => {
    render(<Tabs items={ITEMS} activeId="mail" onSelect={() => {}} testId="tabs" />);
    const mailTab = screen.getByTestId("tabs-mail");
    expect(mailTab.querySelector('[data-testid="mail-icon"]')).not.toBeNull();
    expect(mailTab.firstElementChild?.contains(screen.getByTestId("mail-icon"))).toBe(true);
    const contractTab = screen.getByTestId("tabs-contract");
    expect(screen.getByTestId("tabs-contract-detail").textContent).toBe("4 Seiten");
    expect(contractTab.textContent).toBe("Vertrag.pdf4 Seiten2");
    expect(screen.queryByTestId("tabs-mail-detail")).toBeNull();
  });
});
