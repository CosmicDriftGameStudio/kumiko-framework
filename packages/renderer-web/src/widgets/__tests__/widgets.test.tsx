import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "../../__tests__/test-utils";
import { StatusBarChart, smoothPath, TimeseriesChart } from "../charts";
import { CollapsibleSection } from "../collapsible-section";
import { DetailList } from "../detail-list";
import { ModeSwitch } from "../mode-switch";
import { ProgressBar } from "../progress-bar";
import { SectionCard } from "../section-card";
import { MiniStat, StatCard } from "../stat";
import { EmptyState } from "../states";
import { StatusBadge } from "../status-badge";

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
  });

  test("muted nutzt die neutralen Theme-Tokens", () => {
    render(
      <StatusBadge tone="muted" testId="badge">
        Resolved
      </StatusBadge>,
    );
    expect(screen.getByTestId("badge").className).toContain("text-muted-foreground");
  });
});

describe("ProgressBar", () => {
  test("clampt value auf 0..1 und setzt aria", () => {
    render(<ProgressBar value={1.7} testId="bar" />);
    expect(screen.getByTestId("bar").getAttribute("aria-valuenow")).toBe("100");
  });

  test("negative Werte werden 0", () => {
    render(<ProgressBar value={-3} testId="bar" />);
    expect(screen.getByTestId("bar").getAttribute("aria-valuenow")).toBe("0");
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
});

describe("TimeseriesChart", () => {
  test("unter 2 Messwerten rendert emptyContent statt Chart", () => {
    const { container } = render(
      <TimeseriesChart
        points={[{ atMs: 1000, value: 42 }]}
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
});
