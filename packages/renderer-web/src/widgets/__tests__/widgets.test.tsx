import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "../../__tests__/test-utils.js";
import { StackedAreaChart, StatusBarChart, smoothPath, TimeseriesChart } from "../charts.js";
import { CollapsibleSection } from "../collapsible-section.js";
import { DetailList } from "../detail-list.js";
import { ModeSwitch } from "../mode-switch.js";
import { ProgressBar } from "../progress-bar.js";
import { ProgressList } from "../progress-list.js";
import { SectionCard } from "../section-card.js";
import { MiniStat, StatCard, StatStripCell } from "../stat.js";
import { EmptyState } from "../states.js";
import { StatusBadge } from "../status-badge.js";
import { StepBar } from "../step-bar.js";

describe("StatusBadge", () => {
  test("rendert Label mit Tone-Klassen", () => {
    render(
      <StatusBadge tone="ok" testId="badge">
        Operational
      </StatusBadge>,
    );
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toBe("Operational");
    expect(badge.className).toContain("text-status-ok");
    expect(badge.className).toContain("bg-status-ok-surface");
  });

  test("rendert den dekorativen Statuspunkt in der Textfarbe", () => {
    render(
      <StatusBadge tone="warn" testId="badge">
        Investigating
      </StatusBadge>,
    );
    const dot = screen.getByTestId("badge").querySelector("[data-status-dot]");
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(dot?.className).toContain("bg-current");
  });

  test("muted nutzt die neutralen Theme-Tokens", () => {
    render(
      <StatusBadge tone="muted" testId="badge">
        Resolved
      </StatusBadge>,
    );
    const { className } = screen.getByTestId("badge");
    expect(className).toContain("text-status-neutral");
    expect(className).toContain("bg-status-neutral-surface");
  });
});

describe("ProgressBar", () => {
  test("clampt value auf 0..1 und setzt aria", () => {
    render(<ProgressBar value={1.7} testId="bar" />);
    expect(screen.getByTestId("bar").getAttribute("aria-valuenow")).toBe("100");
  });

  test("tone success färbt die Füllung mit dem Status-ok-Token", () => {
    render(<ProgressBar value={1} tone="success" testId="bar" />);
    const fill = screen.getByTestId("bar").firstElementChild as HTMLElement;
    expect(fill.className).toContain("bg-status-ok");
    expect(fill.className).not.toContain("bg-primary");
  });

  test("negative Werte werden 0", () => {
    render(<ProgressBar value={-3} testId="bar" />);
    expect(screen.getByTestId("bar").getAttribute("aria-valuenow")).toBe("0");
  });

  test("NaN (z.B. aus done/total mit total=0) wird 0 statt NaN durchzureichen", () => {
    render(<ProgressBar value={Number.NaN} testId="bar" />);
    const bar = screen.getByTestId("bar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  test("className landet auf dem Wrapper, h-2 bleibt auf dem Testid-/Track-Element (fw#1970)", () => {
    render(<ProgressBar value={0.5} testId="bar" className="mt-4" />);
    const bar = screen.getByTestId("bar");
    expect(bar.parentElement?.className).toContain("mt-4");
    expect(bar.parentElement?.className).toContain("w-full");
    expect(bar.className).toContain("h-2");
    expect(bar.className).not.toContain("mt-4");
  });

  test("Füll-Element bildet den Wert über die Breite ab", () => {
    render(<ProgressBar value={0.5} testId="bar" />);
    const fill = screen.getByTestId("bar").firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("50%");
  });

  test("die testId sitzt auf der Track-Höhe, className erreicht den äußeren Wrapper", () => {
    render(<ProgressBar value={0.5} testId="bar" className="mb-4" />);
    const track = screen.getByTestId("bar");
    const wrapper = track.parentElement as HTMLElement;
    expect(wrapper.className).toContain("mb-4");
    expect(track.className).toContain("h-2");
  });
});

describe("StepBar", () => {
  test("rendert einen Step-Eintrag pro Label mit sichtbarem Titel", () => {
    render(
      <StepBar
        steps={["Basics", "Industry", "Review"]}
        currentIndex={0}
        compactLabel="Step 1 of 3 · Basics"
        testId="steps"
      />,
    );
    expect(screen.getByTestId("steps-step-0").textContent).toContain("Basics");
    expect(screen.getByTestId("steps-step-1").textContent).toContain("Industry");
    expect(screen.getByTestId("steps-step-2").textContent).toContain("Review");
  });

  test("markiert nur den aktiven Schritt via aria-current", () => {
    render(
      <StepBar
        steps={["Basics", "Industry", "Review"]}
        currentIndex={1}
        compactLabel="Step 2 of 3 · Industry"
        testId="steps"
      />,
    );
    expect(screen.getByTestId("steps-step-0").getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("steps-step-1").getAttribute("aria-current")).toBe("step");
    expect(screen.getByTestId("steps-step-2").getAttribute("aria-current")).toBeNull();
  });

  test("erledigte Schritte zeigen ein Häkchen statt der Nummer, kommende ihre Nummer", () => {
    render(
      <StepBar
        steps={["Basics", "Industry", "Review"]}
        currentIndex={1}
        compactLabel="Step 2 of 3 · Industry"
        testId="steps"
      />,
    );
    const done = screen.getByTestId("steps-step-0");
    expect(done.querySelector("svg")).not.toBeNull();
    expect(done.textContent).not.toContain("1");

    const current = screen.getByTestId("steps-step-1");
    expect(current.querySelector("svg")).toBeNull();
    expect(current.textContent).toContain("2");

    const upcoming = screen.getByTestId("steps-step-2");
    expect(upcoming.querySelector("svg")).toBeNull();
    expect(upcoming.textContent).toContain("3");
  });

  test("erledigte Schritte bleiben für Screenreader als erledigt erkennbar", () => {
    render(
      <StepBar
        steps={["Basics", "Industry"]}
        currentIndex={1}
        compactLabel="Step 2 of 2 · Industry"
        testId="steps"
      />,
    );
    expect(screen.getByTestId("steps-step-0").textContent).toContain("Done");
  });

  test("mit onStepSelect springen erledigte Schritte zurück, aktueller und kommende sind keine Buttons", () => {
    const onStepSelect = mock((_index: number) => {});
    render(
      <StepBar
        steps={["Basics", "Industry", "Review"]}
        currentIndex={1}
        compactLabel="Step 2 of 3 · Industry"
        onStepSelect={onStepSelect}
        testId="steps"
      />,
    );
    const done = screen.getByTestId("steps-step-0");
    expect(done.tagName).toBe("BUTTON");
    fireEvent.click(done);
    expect(onStepSelect).toHaveBeenCalledWith(0);

    expect(screen.getByTestId("steps-step-1").tagName).toBe("SPAN");
    expect(screen.getByTestId("steps-step-2").tagName).toBe("SPAN");
  });

  test("ohne onStepSelect bleiben erledigte Schritte reine Anzeige", () => {
    render(
      <StepBar
        steps={["Basics", "Industry"]}
        currentIndex={1}
        compactLabel="Step 2 of 2 · Industry"
        testId="steps"
      />,
    );
    expect(screen.getByTestId("steps-step-0").tagName).toBe("SPAN");
  });

  test("narrowLayout steps hält die Schrittzeile auch schmal sichtbar, Label ganz ausgeblendet (keine doppelte Ansage)", () => {
    render(
      <StepBar
        steps={["Auto", "Preis", "Fotos", "Kontakt"]}
        currentIndex={1}
        compactLabel="Schritt 2 von 4 · Preis"
        narrowLayout="steps"
        testId="steps"
        compactTestId="steps-compact"
      />,
    );
    const row = screen.getByTestId("steps");
    expect(row.className.split(" ")).not.toContain("hidden");
    expect(row.className).toContain("flex");
    expect(screen.getByTestId("steps-compact").className.split(" ")).toContain("hidden");
    expect(screen.getByTestId("steps-compact").className).not.toContain("sr-only");
  });

  test("ohne narrowLayout bleibt die Schrittzeile unter sm ausgeblendet", () => {
    render(
      <StepBar
        steps={["Basics", "Industry"]}
        currentIndex={0}
        compactLabel="Step 1 of 2 · Basics"
        testId="steps"
        compactTestId="steps-compact"
      />,
    );
    expect(screen.getByTestId("steps").className.split(" ")).toContain("hidden");
    expect(screen.getByTestId("steps-compact").className).toContain("sm:hidden");
  });

  for (const orientation of ["horizontal", "vertical"] as const) {
    test(`selectableSteps="all" (${orientation}): kommende Chips sind Buttons mit Nummer und ohne Done-Label, der aktuelle nie`, () => {
      const onStepSelect = mock((_index: number) => {});
      render(
        <StepBar
          steps={["Basics", "Industry", "Review"]}
          currentIndex={0}
          compactLabel="Step 1 of 3 · Basics"
          onStepSelect={onStepSelect}
          selectableSteps="all"
          orientation={orientation}
          testId="steps"
        />,
      );
      const upcoming = screen.getByTestId("steps-step-2");
      expect(upcoming.tagName).toBe("BUTTON");
      expect(upcoming.textContent).toContain("3");
      expect(upcoming.textContent).not.toContain("Done");
      expect(upcoming.querySelector("svg")).toBeNull();
      fireEvent.click(upcoming);
      expect(onStepSelect).toHaveBeenCalledWith(2);

      const current = screen.getByTestId("steps-step-0");
      expect(current.tagName).toBe("SPAN");
      expect(current.getAttribute("aria-current")).toBe("step");
    });

    test(`doneSteps (${orientation}) überstimmt die Position: ein späterer Schritt ist erledigt, ein früherer nicht`, () => {
      render(
        <StepBar
          steps={["Basics", "Industry", "Review"]}
          currentIndex={1}
          compactLabel="Step 2 of 3 · Industry"
          onStepSelect={() => {}}
          doneSteps={[false, false, true]}
          selectableSteps="all"
          orientation={orientation}
          testId="steps"
        />,
      );
      const earlier = screen.getByTestId("steps-step-0");
      expect(earlier.textContent).not.toContain("Done");
      expect(earlier.textContent).toContain("1");

      const later = screen.getByTestId("steps-step-2");
      expect(later.textContent).toContain("Done");
      expect(later.querySelector("svg")).not.toBeNull();
      expect(later.tagName).toBe("BUTTON");
    });
  }

  test("doneSteps ohne selectableSteps: nur erledigte Chips sind Buttons", () => {
    render(
      <StepBar
        steps={["Basics", "Industry", "Review"]}
        currentIndex={0}
        compactLabel="Step 1 of 3 · Basics"
        onStepSelect={() => {}}
        doneSteps={[false, false, true]}
        testId="steps"
      />,
    );
    expect(screen.getByTestId("steps-step-1").tagName).toBe("SPAN");
    expect(screen.getByTestId("steps-step-2").tagName).toBe("BUTTON");
  });

  test("rendert den compactLabel-Fallback für schmale Viewports", () => {
    render(
      <StepBar
        steps={["Basics", "Industry"]}
        currentIndex={0}
        compactLabel="Step 1 of 2 · Basics"
        compactTestId="steps-compact"
      />,
    );
    expect(screen.getByTestId("steps-compact").textContent).toBe("Step 1 of 2 · Basics");
  });

  describe("compact picker", () => {
    function renderPicker(onStepSelect: (index: number) => void): void {
      render(
        <StepBar
          steps={["Basics", "Industry", "Review"]}
          currentIndex={1}
          compactLabel="Step 2 of 3 · Industry"
          compactTestId="steps-compact"
          onStepSelect={onStepSelect}
          doneSteps={[true, false, false]}
          selectableSteps="all"
        />,
      );
    }

    test("opens a step list, jumps to an upcoming step and collapses", () => {
      const onStepSelect = mock((_index: number) => {});
      renderPicker(onStepSelect);
      const toggle = screen.getByTestId("steps-compact");
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByTestId("steps-compact-step-0")).toBeNull();

      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByTestId("steps-compact-step-0").textContent).toContain("Done");
      expect(screen.getByTestId("steps-compact-step-1").getAttribute("aria-current")).toBe("step");

      fireEvent.click(screen.getByTestId("steps-compact-step-2"));
      expect(onStepSelect).toHaveBeenCalledWith(2);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByTestId("steps-compact-step-2")).toBeNull();
    });

    test("Escape closes the list and returns focus to the toggle", () => {
      renderPicker(() => {});
      const toggle = screen.getByTestId("steps-compact");
      fireEvent.click(toggle);
      fireEvent.keyDown(screen.getByTestId("steps-compact-step-0"), { key: "Escape" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(toggle);
    });

    test("without selectableSteps=all the compact label stays plain text", () => {
      render(
        <StepBar
          steps={["Basics", "Industry"]}
          currentIndex={0}
          compactLabel="Step 1 of 2 · Basics"
          compactTestId="steps-compact"
          onStepSelect={() => {}}
        />,
      );
      expect(screen.getByTestId("steps-compact").tagName).toBe("P");
    });
  });
});

describe("ModeSwitch variants", () => {
  const options = [
    { value: "a", label: "Modus A" },
    { value: "b", label: "Modus B" },
  ];

  test("pill variant uses a grey track and a raised active segment, plus className", () => {
    render(
      <ModeSwitch
        value="a"
        options={options}
        onChange={() => {}}
        variant="pill"
        className="w-40"
        testId="sw"
      />,
    );
    const track = screen.getByTestId("sw");
    expect(track.className).toContain("bg-muted");
    expect(track.className).toContain("w-40");
    expect(screen.getByRole("button", { name: "Modus A" }).className).toContain("bg-card");
    expect(screen.getByRole("button", { name: "Modus B" }).className).not.toContain("bg-card");
  });

  test("default variant stays the bordered control", () => {
    render(<ModeSwitch value="a" options={options} onChange={() => {}} testId="sw" />);
    expect(screen.getByTestId("sw").className).toContain("border-input");
    expect(screen.getByRole("button", { name: "Modus A" }).className).toContain("bg-primary/10");
  });
});

describe("ModeSwitch", () => {
  test("markiert aktive Option und feuert onChange", () => {
    const onChange = mock((_v: string) => {});
    render(
      <ModeSwitch
        value="a"
        options={[
          { value: "a", label: "Modus A" },
          { value: "b", label: "Modus B" },
        ]}
        onChange={onChange}
      />,
    );
    const active = screen.getByRole("button", { name: "Modus A" });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Modus B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  test("grows with wrapped labels instead of clipping at a fixed height", () => {
    render(
      <ModeSwitch
        value="a"
        testId="switch"
        options={[{ value: "a", label: "A very long label that wraps" }]}
        onChange={() => {}}
      />,
    );
    const className = screen.getByTestId("switch").className;
    expect(className).toContain("min-h-8");
    expect(className).not.toContain(" h-8");
  });

  test("#902: Buttons sind als zusammengehörige Gruppe gekennzeichnet", () => {
    render(
      <ModeSwitch
        value="a"
        options={[
          { value: "a", label: "Modus A" },
          { value: "b", label: "Modus B" },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("group")).toBeTruthy();
  });
});

describe("CollapsibleSection", () => {
  test("async geflipptes defaultOpen öffnet nachträglich", () => {
    const { rerender, container } = render(
      <CollapsibleSection title="Erweitert" defaultOpen={false}>
        <span>Inhalt</span>
      </CollapsibleSection>,
    );
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    rerender(
      <CollapsibleSection title="Erweitert" defaultOpen={true}>
        <span>Inhalt</span>
      </CollapsibleSection>,
    );
    expect(container.querySelector("details")?.open).toBe(true);
  });
});

describe("DetailList", () => {
  test("rendert Label/Wert-Paare als dl", () => {
    render(<DetailList rows={[{ label: "Name", value: "Acme" }]} testId="dl" />);
    expect(screen.getByText("Name").tagName).toBe("DT");
    expect(screen.getByText("Acme").tagName).toBe("DD");
  });
});

describe("SectionCard", () => {
  test("rendert Titel, Action-Slot und Children über das Card-Primitive", () => {
    render(
      <SectionCard title="Verlauf" action={<button type="button">Range</button>}>
        <span>Body</span>
      </SectionCard>,
    );
    expect(screen.getByText("Verlauf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Range" })).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
  });
});

describe("StatCard", () => {
  test("rendert Label, Wert, Delta und Sub-Zeile", () => {
    render(
      <StatCard
        label="Restschuld"
        value="123.456 €"
        sub="nach 10 Jahren"
        delta={{ value: "2,1 %", direction: "down" }}
      />,
    );
    expect(screen.getByText("Restschuld")).toBeTruthy();
    expect(screen.getByText("123.456 €")).toBeTruthy();
    expect(screen.getByText(/2,1 %/)).toBeTruthy();
    expect(screen.getByText("nach 10 Jahren")).toBeTruthy();
  });

  test("long labels wrap to two lines and the delta badge keeps its size", () => {
    render(
      <StatCard
        label="A very long metric label"
        value="1"
        delta={{ value: "2,1 %", direction: "up" }}
      />,
    );
    const label = screen.getByText("A very long metric label");
    expect(label.className).toContain("line-clamp-2");
    expect(label.className).not.toContain("truncate");
    expect(label.getAttribute("title")).toBe("A very long metric label");
    expect(screen.getByText(/2,1 %/).closest("span")?.className).toContain("shrink-0");
  });

  test("header row wraps so the delta badge drops below a label that has no room", () => {
    render(
      <StatCard label="Restschuld heute" value="1" delta={{ value: "15 %", direction: "down" }} />,
    );
    const labelBox = screen.getByText("Restschuld heute").parentElement;
    expect(labelBox?.parentElement?.className).toContain("flex-wrap");
    expect(labelBox?.className).toContain("basis-[7rem]");
  });

  test("accentColor färbt den Icon-Chip inline", () => {
    const { container } = render(
      <StatCard
        icon={<svg aria-hidden="true" />}
        label="Zins"
        value="3,1 %"
        accentColor="#123456"
      />,
    );
    const chip = container.querySelector("span[style]");
    // happy-dom parst color-mix()-backgroundColor nicht — color reicht als Beleg.
    expect(chip?.getAttribute("style") ?? "").toContain("#123456");
  });
});

describe("MiniStat", () => {
  test("emphasize hebt die Kachel mit Ring hervor", () => {
    render(<MiniStat label="Rate" value="890 €" emphasize testId="mini" />);
    expect(screen.getByTestId("mini").className).toContain("ring-1");
  });
});

describe("EmptyState", () => {
  test("rendert Titel, Beschreibung und CTA", () => {
    render(
      <EmptyState
        title="Noch keine Monitore"
        description="Lege den ersten an."
        action={<button type="button">Neu</button>}
      />,
    );
    expect(screen.getByText("Noch keine Monitore")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neu" })).toBeTruthy();
  });
});

describe("smoothPath", () => {
  test("leer → leerer Pfad, ein Punkt → Move + Line auf sich selbst", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("M 1.0 2.0 L 1.0 2.0");
  });

  test("glättet über Quadratic-Midpoints und endet am letzten Punkt", () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith("M 0.0 0.0")).toBe(true);
    expect(d).toContain("Q 10.0 20.0, 15.0 10.0");
    expect(d.endsWith("L 20.0 0.0")).toBe(true);
  });
});

describe("StatusBarChart", () => {
  test("rendert einen Bar pro Entry mit aria-Label", () => {
    const { container } = render(
      <StatusBarChart
        ariaLabel="Uptime 90 Tage"
        entries={[
          { key: "d1", level: 1, tone: "ok" },
          { key: "d2", level: 0.5, tone: "bad" },
        ]}
        startLabel="90 Tage"
        endLabel="heute"
      />,
    );
    expect(screen.getByRole("img", { name: "Uptime 90 Tage" })).toBeTruthy();
    // 2 Entries × (Gradient-Bar + Tick) + 1 Last-Highlight-Stripe = 5 rects
    expect(container.querySelectorAll("rect").length).toBe(5);
    expect(screen.getByText("heute")).toBeTruthy();
  });

  test("dense: fixed-size flat bars ohne Tick/Gradient, aria-Label + Tooltips bleiben", () => {
    const { container } = render(
      <StatusBarChart
        dense
        ariaLabel="Zahlungsmonate"
        entries={[
          { key: "m1", level: 1, tone: "ok", label: "Januar: bezahlt" },
          { key: "m2", level: 0.5, tone: "bad", label: "Februar: offen" },
        ]}
      />,
    );
    const svg = container.querySelector("svg");
    expect(screen.getByRole("img", { name: "Zahlungsmonate" })).toBeTruthy();
    expect(svg?.getAttribute("class")).not.toContain("w-full");
    expect(svg?.getAttribute("width")).not.toBeNull();
    expect(container.querySelectorAll("linearGradient").length).toBe(0);
    // 1 bar (non-last entry) + 1 bar + 1 last-highlight stripe (no tick) = 3 rects
    expect(container.querySelectorAll("rect").length).toBe(3);
    expect(container.querySelectorAll("title").length).toBe(3); // aria title + 2 entry tooltips
  });

  test("dense: level 0 bleibt als sichtbare Bar mit Tooltip erhalten", () => {
    const { container } = render(
      <StatusBarChart
        dense
        highlightLast={false}
        ariaLabel="Zahlungsmonate"
        entries={[{ key: "m1", level: 0, tone: "bad", label: "Februar: offen" }]}
      />,
    );
    const rect = container.querySelector("rect");
    expect(Number(rect?.getAttribute("height"))).toBeGreaterThan(0);
    expect(rect?.querySelector("title")?.textContent).toBe("Februar: offen");
  });

  test("dense: leere Entries reservieren keine 36px-Höhe", () => {
    const { container } = render(<StatusBarChart dense ariaLabel="Leer" entries={[]} />);
    const placeholder = container.querySelector("div[aria-hidden]");
    expect(placeholder?.className).toBe("h-3");
  });
});

describe("TimeseriesChart axes and height", () => {
  const base = {
    points: [
      { atMs: 0, value: 120 },
      { atMs: 1000, value: 560 },
      { atMs: 2000, value: 300 },
    ],
    windowStartMs: 0,
    windowEndMs: 2000,
    ariaLabel: "Antwortzeit",
  };

  test("yAxis ticks renders that many gridlines plus rounded labels", () => {
    const { container } = render(
      <TimeseriesChart {...base} yAxis={{ ticks: 4, format: (v) => `${v} ms` }} />,
    );
    expect(container.querySelectorAll("[data-grid-line]").length).toBe(4);
    const labels = [...container.querySelectorAll("[data-y-label]")].map((n) => n.textContent);
    expect(labels).toEqual(["0 ms", "200 ms", "400 ms", "600 ms"]);
  });

  test("xAxis renders n date labels across the window", () => {
    const { container } = render(
      <TimeseriesChart {...base} xAxis={{ ticks: 5, format: (ms) => `t${ms}` }} />,
    );
    const labels = [...container.querySelectorAll("[data-x-label]")].map((n) => n.textContent);
    expect(labels).toEqual(["t0", "t500", "t1000", "t1500", "t2000"]);
  });

  test("height prop replaces the default h-16 class", () => {
    const { container } = render(<TimeseriesChart {...base} height={120} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("style")).toContain("height: 120px");
    expect(svg?.getAttribute("class")).not.toContain("h-16");
  });

  test("default rendering has no gridlines, labels or inline height", () => {
    const { container } = render(<TimeseriesChart {...base} />);
    expect(container.querySelectorAll("[data-grid-line]").length).toBe(0);
    expect(container.querySelectorAll("[data-y-label]").length).toBe(0);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("h-16");
    expect(svg?.getAttribute("style")).toBeNull();
  });
});

describe("TimeseriesChart", () => {
  test("ein einzelner Messwert rendert einen Punkt statt emptyContent", () => {
    const { container } = render(
      <TimeseriesChart
        points={[{ atMs: 1000, value: 42 }]}
        windowStartMs={0}
        windowEndMs={2000}
        ariaLabel="Antwortzeit"
        referenceLines={[{ value: 100, label: "p95" }]}
        emptyContent={<span>Noch keine Messdaten</span>}
      />,
    );
    expect(screen.queryByText("Noch keine Messdaten")).toBeNull();
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(1);
    expect(circles[0]?.getAttribute("cx")).toBe("150");
    const cy = Number(circles[0]?.getAttribute("cy"));
    expect(Number.isFinite(cy)).toBe(true);
    expect(cy).toBeGreaterThan(0);
    expect(cy).toBeLessThan(64);
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.querySelectorAll("[data-reference-line]").length).toBe(1);
  });

  test("ein einzelner Wert ohne Referenzlinie sitzt nicht am Rand", () => {
    const { container } = render(
      <TimeseriesChart
        points={[{ atMs: 1000, value: 42 }]}
        windowStartMs={0}
        windowEndMs={2000}
        ariaLabel="Antwortzeit"
      />,
    );
    const cy = Number(container.querySelector("circle")?.getAttribute("cy"));
    expect(cy).toBeGreaterThan(10);
    expect(cy).toBeLessThan(54);
  });

  test("ohne Messwert rendert emptyContent statt Chart", () => {
    const { container } = render(
      <TimeseriesChart
        points={[{ atMs: 1000, value: null }]}
        windowStartMs={0}
        windowEndMs={2000}
        ariaLabel="Antwortzeit"
        emptyContent={<span>Noch keine Messdaten</span>}
      />,
    );
    expect(screen.getByText("Noch keine Messdaten")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });

  test("rendert Linie + Fläche + Achsen-Labels", () => {
    const { container } = render(
      <TimeseriesChart
        points={[
          { atMs: 0, value: 100 },
          { atMs: 1000, value: 200 },
          { atMs: 2000, value: null },
        ]}
        windowStartMs={0}
        windowEndMs={2000}
        ariaLabel="Antwortzeit"
        axisLabels={{ start: "vor 24h", end: "jetzt" }}
      />,
    );
    expect(screen.getByRole("img", { name: "Antwortzeit" })).toBeTruthy();
    expect(container.querySelectorAll("path").length).toBe(2);
    expect(screen.getByText("jetzt")).toBeTruthy();
  });

  const flatSeries = (max: number) => [
    { atMs: 0, value: max / 2 },
    { atMs: 1000, value: max },
  ];

  test("Referenzlinie liegt auf der y-Skala der Datenreihe", () => {
    const { container } = render(
      <TimeseriesChart
        points={flatSeries(200)}
        windowStartMs={0}
        windowEndMs={1000}
        ariaLabel="Antwortzeit"
        referenceLines={[{ value: 100, label: "p95" }]}
      />,
    );
    const line = container.querySelector("line[data-reference-line]");
    expect(line?.getAttribute("y1")).toBe("32");
    expect(line?.getAttribute("y2")).toBe("32");
  });

  test("Referenzlinie über dem Datenmaximum erweitert die Skala", () => {
    const { container } = render(
      <TimeseriesChart
        points={flatSeries(100)}
        windowStartMs={0}
        windowEndMs={1000}
        ariaLabel="Antwortzeit"
        referenceLines={[{ value: 200, label: "SLO" }]}
      />,
    );
    expect(container.querySelector("line[data-reference-line]")?.getAttribute("y1")).toBe("0");
    expect(container.querySelector("path[fill='none']")?.getAttribute("d")).toContain(
      "L 300.0 32.0",
    );
  });

  test("aria-describedby verweist auf desc mit den Linien-Labels", () => {
    const { container } = render(
      <TimeseriesChart
        points={flatSeries(200)}
        windowStartMs={0}
        windowEndMs={1000}
        ariaLabel="Antwortzeit"
        referenceLines={[
          { value: 100, label: "p95: 100 ms" },
          { value: 150, label: "SLO" },
        ]}
      />,
    );
    const describedBy = screen
      .getByRole("img", { name: "Antwortzeit" })
      .getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`desc[id="${describedBy}"]`)?.textContent).toBe(
      "p95: 100 ms, SLO",
    );
  });

  test("ungültige Referenzwerte werden nicht gerendert", () => {
    const { container } = render(
      <TimeseriesChart
        points={flatSeries(200)}
        windowStartMs={0}
        windowEndMs={1000}
        ariaLabel="Antwortzeit"
        referenceLines={[
          { value: Number.NaN, label: "a" },
          { value: Number.POSITIVE_INFINITY, label: "b" },
          { value: -5, label: "c" },
        ]}
      />,
    );
    expect(container.querySelector("line")).toBeNull();
    expect(container.querySelector("desc")).toBeNull();
  });

  test("ohne Referenzlinien bleibt das Markup unverändert", () => {
    const props = {
      points: flatSeries(200),
      windowStartMs: 0,
      windowEndMs: 1000,
      ariaLabel: "Antwortzeit",
    };
    const plain = render(<TimeseriesChart {...props} />).container;
    const empty = render(<TimeseriesChart {...props} referenceLines={[]} />).container;
    const withoutGeneratedIds = (html: string) => html.replace(/_r_\w+_/g, "_id_");
    expect(withoutGeneratedIds(empty.innerHTML)).toBe(withoutGeneratedIds(plain.innerHTML));
    expect(plain.querySelector("desc")).toBeNull();
    expect(plain.querySelector("[aria-describedby]")).toBeNull();
    expect(plain.querySelector(".relative")).toBeNull();
  });
});

describe("StackedAreaChart", () => {
  const baseProps = {
    windowStartMs: 0,
    windowEndMs: 2000,
    ariaLabel: "Verlauf",
    todayLabel: "Heute",
    formatBucketLabel: String,
  };
  const point = (atMs: number, value: number) => ({ atMs, value });

  test("ohne Datenpunkt rendert emptyContent", () => {
    const { container } = render(
      <StackedAreaChart
        {...baseProps}
        series={[{ key: "a", label: "A", points: [] }]}
        emptyContent={<span>Keine Daten</span>}
      />,
    );
    expect(screen.getByText("Keine Daten")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });

  test("ein einzelner Bucket rendert einen Punkt statt emptyContent", () => {
    const { container } = render(
      <StackedAreaChart
        {...baseProps}
        series={[{ key: "a", label: "A", points: [point(1000, 10)] }]}
        emptyContent={<span>Keine Daten</span>}
      />,
    );
    expect(screen.queryByText("Keine Daten")).toBeNull();
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(1);
    expect(Number(circles[0]?.getAttribute("cy"))).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("NaN");
  });

  test("zwei Buckets rendern weiter Flächen ohne Punkte", () => {
    const { container } = render(
      <StackedAreaChart
        {...baseProps}
        series={[{ key: "a", label: "A", points: [point(0, 10), point(2000, 20)] }]}
      />,
    );
    expect(container.querySelectorAll("circle").length).toBe(0);
    expect(container.querySelectorAll("path").length).toBe(1);
  });

  const areaSeries = [
    { key: "debt", label: "Restschuld", points: [point(0, 10), point(2000, 20)] },
  ];

  test("lines draw over the bands, scale the y axis and break at null", () => {
    render(
      <StackedAreaChart
        {...baseProps}
        series={areaSeries}
        lines={[
          {
            key: "rent",
            label: "Miete",
            points: [point(0, 40), { atMs: 1000, value: null }, point(2000, 100)],
          },
          {
            key: "rent-min",
            label: "Mindestmiete",
            dashed: true,
            points: [point(0, 30), point(2000, 30)],
          },
        ]}
      />,
    );
    const rent = screen.getByTestId("chart-line-rent");
    expect(rent.getAttribute("d")?.match(/M /g)).toHaveLength(2);
    expect(rent.getAttribute("stroke-dasharray")).toBeNull();
    expect(screen.getByTestId("chart-line-rent-min").getAttribute("stroke-dasharray")).toBe("6 4");
    expect(screen.getByText("100")).toBeTruthy();
    const legend = screen.getByTestId("chart-legend-rent");
    expect(legend.textContent).toBe("Miete");
  });

  test("showLegendTotals=false drops the series sums; colors win over tones", () => {
    render(
      <StackedAreaChart
        {...baseProps}
        series={areaSeries}
        tones={{ debt: "negative" }}
        colors={{ debt: "var(--color-debt)" }}
        showLegendTotals={false}
      />,
    );
    const legend = screen.getByTestId("chart-legend-debt");
    expect(legend.textContent).toBe("Restschuld");
    expect(legend.querySelector("span")?.getAttribute("style")).toContain("var(--color-debt)");
  });

  test("colored markers get a guide line and a colored pin; duplicates keep both pins", () => {
    render(
      <StackedAreaChart
        {...baseProps}
        series={areaSeries}
        markers={[
          { atMs: 1000, label: "Sondertilgung", color: "var(--color-extra)" },
          { atMs: 1000, label: "Sondertilgung", color: "var(--color-extra)" },
          { atMs: 1500, label: "Neutral" },
        ]}
      />,
    );
    expect(screen.getAllByTestId("chart-marker-guide")).toHaveLength(2);
    const pins = screen.getAllByTestId("chart-marker-pin");
    expect(pins).toHaveLength(3);
    expect(pins[0]?.getAttribute("style")).toContain("var(--color-extra)");
    expect(pins[2]?.className).toContain("bg-foreground");
  });
});

describe("StatStripCell", () => {
  test("renders the icon chip before the label, colored by accentColor", () => {
    render(
      <StatStripCell
        icon={<svg data-testid="strip-icon" aria-hidden="true" />}
        label="Restschuld"
        value="120.000 €"
        accentColor="#123456"
        testId="cell"
      />,
    );
    const chip = screen.getByTestId("strip-icon").parentElement;
    expect(chip?.getAttribute("style") ?? "").toContain("#123456");
    expect(chip?.nextElementSibling?.textContent).toBe("Restschuld");
  });

  test("without icon no chip renders", () => {
    const { container } = render(
      <StatStripCell label="Rate" value="890 €" accentColor="#123456" />,
    );
    expect(container.querySelector("span[style]")).toBeNull();
  });
});

describe("ProgressList", () => {
  test("a row sub line renders under the bar", () => {
    render(
      <ProgressList
        rows={[
          { id: "1", label: "Baudarlehen", value: "42.000 €", fraction: 0.4, sub: "40 % getilgt" },
        ]}
      />,
    );
    const sub = screen.getByText("40 % getilgt");
    const bar = screen.getByRole("progressbar");
    expect(bar.compareDocumentPosition(sub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
