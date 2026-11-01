import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { SectionNavLayout } from "../section-nav-layout.tsx";

const items = [
  { id: "intro", title: "Intro" },
  { id: "billing", title: "Billing" },
];

describe("SectionNavLayout", () => {
  test("renders the content and one nav entry per item with the first marked active", () => {
    render(
      <SectionNavLayout items={items} testId="layout">
        <section id="intro">Intro body</section>
        <section id="billing">Billing body</section>
      </SectionNavLayout>,
    );
    expect(screen.getByText("Intro body")).toBeTruthy();
    expect(screen.getByTestId("form-section-nav-intro").getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("form-section-nav-billing").getAttribute("aria-current")).toBeNull();
  });

  test("renders no navigation without items", () => {
    render(
      <SectionNavLayout items={[]}>
        <section id="intro">Intro body</section>
      </SectionNavLayout>,
    );
    expect(screen.queryByTestId("form-section-nav")).toBeNull();
  });
});
