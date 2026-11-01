import { describe, expect, test } from "bun:test";
import { usePrimitives } from "../../../index.ts";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { ChoiceCards } from "../choice-cards.tsx";
import { Composer } from "../composer.tsx";
import { DetailList } from "../detail-list.tsx";
import { ModeSwitch } from "../mode-switch.tsx";
import { SectionNavLayout } from "../section-nav-layout.tsx";
import { SideBySideTable } from "../side-by-side-table.tsx";

function classesOf(element: HTMLElement): string[] {
  return element.className.split(" ");
}

const cardOptions = [
  { value: "a", title: "Alpha" },
  { value: "b", title: "Beta" },
];

describe("ChoiceCards columns, radio variant and label", () => {
  test("default keeps two columns and the check indicator", () => {
    render(<ChoiceCards value="a" options={cardOptions} onChange={() => {}} testId="cards" />);
    expect(classesOf(screen.getByTestId("cards"))).toContain("sm:grid-cols-2");
    expect(screen.getByTestId("cards-a").querySelector("svg")).not.toBeNull();
  });

  test("columns sets the grid and the radio variant puts a dot indicator before the title", () => {
    render(
      <ChoiceCards
        value="a"
        options={cardOptions}
        onChange={() => {}}
        columns={3}
        variant="radio"
        testId="cards"
      />,
    );
    expect(classesOf(screen.getByTestId("cards"))).toContain("sm:grid-cols-3");
    const selected = screen.getByTestId("cards-a");
    expect(selected.querySelector("svg")).toBeNull();
    const title = screen.getByText("Alpha");
    const indicator = title.previousElementSibling;
    expect(indicator?.getAttribute("aria-hidden")).toBe("true");
    expect(indicator?.querySelector(".bg-primary")).not.toBeNull();
    expect(screen.getByTestId("cards-b").querySelector(".bg-primary")).toBeNull();
  });

  test("label renders in the field-label style and names the group", () => {
    render(<ChoiceCards value="a" options={cardOptions} onChange={() => {}} label="Start with" />);
    const label = screen.getByText("Start with");
    expect(classesOf(label)).toContain("text-[13px]");
    expect(classesOf(label)).not.toContain("uppercase");
    expect(screen.getByRole("radiogroup", { name: "Start with" })).toBeTruthy();
  });
});

describe("ModeSwitch warning frame and wide segments", () => {
  test("tone warning frames the whole switch, not the segment", () => {
    render(
      <ModeSwitch
        value="a"
        onChange={() => {}}
        testId="switch"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B", tone: "warning" },
        ]}
      />,
    );
    expect(classesOf(screen.getByTestId("switch"))).toContain("ring-status-warn");
    expect(classesOf(screen.getByText("B"))).not.toContain("ring-status-warn");
  });

  test("segmentWidth wide sets a minimum segment width; default does not", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];
    const { rerender } = render(<ModeSwitch value="a" onChange={() => {}} options={options} />);
    expect(classesOf(screen.getByText("A"))).not.toContain("min-w-20");
    rerender(<ModeSwitch value="a" onChange={() => {}} options={options} segmentWidth="wide" />);
    expect(classesOf(screen.getByText("A"))).toContain("min-w-20");
  });
});

describe("SideBySideTable rowHeaderTone", () => {
  function renderTable(tone?: "foreground"): void {
    render(
      <SideBySideTable
        caption="Compare"
        rowHeaderLabel="Item"
        columns={[{ id: "x", label: "X" }]}
        rows={[{ id: "r", header: "Row", cells: [{ content: "v" }] }]}
        {...(tone !== undefined && { rowHeaderTone: tone })}
      />,
    );
  }

  test("row headers are muted by default", () => {
    renderTable();
    expect(classesOf(screen.getByText("Row"))).toContain("text-muted-foreground");
  });

  test("foreground tone drops the muted colour", () => {
    renderTable("foreground");
    expect(classesOf(screen.getByText("Row"))).not.toContain("text-muted-foreground");
  });
});

describe("DetailList sidebar layout", () => {
  test("the value stays left-aligned", () => {
    render(<DetailList rows={[{ label: "Plan", value: "Team" }]} layout="sidebar" />);
    expect(classesOf(screen.getByText("Team"))).not.toContain("text-right");
  });
});

describe("Composer", () => {
  test("renders a text send button on a normal background without a strip", () => {
    render(
      <Composer
        value="Hi"
        onChange={() => {}}
        onSubmit={() => {}}
        submitLabel="Senden"
        testId="c"
      />,
    );
    const button = screen.getByRole("button", { name: "Senden" });
    expect(button.textContent).toBe("Senden");
    expect(button.querySelector("svg")).toBeNull();
    const root = screen.getByTestId("c");
    expect(classesOf(root)).not.toContain("bg-background");
    expect(classesOf(root)).not.toContain("sticky");
    expect(screen.getByRole("textbox").closest(".bg-card")).not.toBeNull();
  });

  test("docked sticks to the bottom of a flex-column parent", () => {
    render(
      <Composer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        submitLabel="Senden"
        docked
        testId="c"
      />,
    );
    const classes = classesOf(screen.getByTestId("c"));
    expect(classes).toContain("sticky");
    expect(classes).toContain("mt-auto");
    expect(classes).toContain("-bottom-6");
    expect(classes).toContain("pb-6");
    expect(classes).toContain("-mb-6");
    expect(classes).toContain("bg-card");
  });
});

describe("SectionNavLayout active entry", () => {
  test("is bold in the foreground colour, not primary", () => {
    render(
      <SectionNavLayout
        items={[
          { id: "a", title: "Alpha" },
          { id: "b", title: "Beta" },
        ]}
      >
        <section id="a">A</section>
        <section id="b">B</section>
      </SectionNavLayout>,
    );
    const active = classesOf(screen.getByTestId("form-section-nav-a"));
    expect(active).toContain("text-foreground");
    expect(active).toContain("border-foreground");
    expect(active).toContain("font-semibold");
    expect(active).not.toContain("text-primary");
  });
});

function BannerHost({ placement }: { placement?: "below" }) {
  const { Banner, Button } = usePrimitives();
  return (
    <Banner
      testId="banner"
      title="Failed"
      actions={<Button>Retry</Button>}
      {...(placement !== undefined && { actionsPlacement: placement })}
    >
      Text
    </Banner>
  );
}

describe("Banner actionsPlacement", () => {
  test("actions sit right of the text by default", () => {
    render(<BannerHost />);
    const banner = screen.getByTestId("banner");
    expect(banner.querySelector(":scope > [data-slot=actions]")).not.toBeNull();
  });

  test("below puts the actions inside the text column", () => {
    render(<BannerHost placement="below" />);
    const banner = screen.getByTestId("banner");
    expect(banner.querySelector(":scope > [data-slot=actions]")).toBeNull();
    expect(banner.querySelector(":scope > div > [data-slot=actions]")).not.toBeNull();
  });
});

describe("ModeSwitch outline surface", () => {
  test("unselected segments sit on the input surface, not the page background", () => {
    render(
      <ModeSwitch
        value="a"
        onChange={() => {}}
        testId="switch"
        options={[{ value: "a", label: "A" }]}
      />,
    );
    const classes = classesOf(screen.getByTestId("switch"));
    expect(classes).toContain("bg-transparent");
    expect(classes).not.toContain("bg-background");
  });
});
