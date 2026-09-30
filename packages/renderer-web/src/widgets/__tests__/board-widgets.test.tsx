import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils";
import { defaultPrimitives } from "../../primitives";
import { ModeSwitch } from "../mode-switch";
import { ProgressBar } from "../progress-bar";
import { SideBySideTable } from "../side-by-side-table";
import { StatusBadge } from "../status-badge";

describe("StatusBadge accent", () => {
  test("uses the primary tint and keeps the status dot", () => {
    render(
      <StatusBadge tone="accent" testId="badge">
        1 Vorschlag
      </StatusBadge>,
    );
    const badge = screen.getByTestId("badge");
    expect(badge.className).toContain("bg-primary/10");
    expect(badge.className).toContain("text-primary");
    expect(badge.querySelector("[data-status-dot]")).not.toBeNull();
  });
});

describe("ModeSwitch count", () => {
  test("renders a counter behind the label only for options that carry one", () => {
    render(
      <ModeSwitch
        value="all"
        testId="filter"
        onChange={() => {}}
        options={[
          { value: "all", label: "Alle", count: 6 },
          { value: "todo", label: "Todo", count: 0 },
          { value: "read", label: "Gelesen" },
        ]}
      />,
    );
    expect(screen.getByTestId("filter-count-all").textContent).toBe("6");
    expect(screen.getByTestId("filter-count-todo").textContent).toBe("0");
    expect(screen.queryByTestId("filter-count-read")).toBeNull();
    expect(screen.getByRole("button", { name: "Todo 0" })).toBeTruthy();
  });

  test("mutes the counter of inactive options only", () => {
    render(
      <ModeSwitch
        value="all"
        testId="filter"
        onChange={() => {}}
        options={[
          { value: "all", label: "Alle", count: 6 },
          { value: "todo", label: "Todo", count: 3 },
        ]}
      />,
    );
    expect(screen.getByTestId("filter-count-all").className).not.toContain("text-muted-foreground");
    expect(screen.getByTestId("filter-count-todo").className).toContain("text-muted-foreground");
  });
});

describe("ProgressBar aria-label and thin size", () => {
  test("passes ariaLabel to the progressbar element", () => {
    render(<ProgressBar value={0.2} ariaLabel="Übernommene Vorschläge" testId="bar" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe(
      "Übernommene Vorschläge",
    );
  });

  test("thin size shrinks the track and uses the border token", () => {
    render(<ProgressBar value={0.2} size="thin" testId="bar" />);
    const track = screen.getByTestId("bar");
    expect(track.className).toContain("h-1");
    expect(track.className).toContain("bg-border");
    expect(track.className).not.toContain("h-2");
  });
});

describe("Link rel and target", () => {
  const { Link } = defaultPrimitives;

  test("target _blank defaults rel to noopener noreferrer", () => {
    render(
      <Link href="https://example.test" target="_blank" testId="link">
        Extern
      </Link>,
    );
    expect(screen.getByTestId("link").getAttribute("rel")).toBe("noopener noreferrer");
  });

  test("an explicit rel wins over the default", () => {
    render(
      <Link href="https://example.test" target="_blank" rel="nofollow" testId="link">
        Extern
      </Link>,
    );
    expect(screen.getByTestId("link").getAttribute("rel")).toBe("nofollow");
  });

  test("without target no rel is set, and rel alone passes through", () => {
    render(
      <>
        <Link href="/intern" testId="plain">
          Intern
        </Link>
        <Link href="/intern" rel="prev" testId="prev">
          Zurück
        </Link>
      </>,
    );
    expect(screen.getByTestId("plain").hasAttribute("rel")).toBe(false);
    expect(screen.getByTestId("prev").getAttribute("rel")).toBe("prev");
  });
});

describe("SideBySideTable", () => {
  function renderTable(): void {
    render(
      <SideBySideTable
        caption="Angaben im Vergleich"
        rowHeaderLabel="Angabe"
        columns={[
          { id: "doc", label: "Aus dem Dokument" },
          { id: "stock", label: "Im Bestand" },
        ]}
        rows={[
          {
            id: "name",
            header: "Name",
            cells: [{ content: <span>Ilse Grundbesitz</span>, colSpan: 2 }],
          },
          {
            id: "iban",
            header: "IBAN",
            tone: "warn",
            cells: [{ content: "DE01" }, { content: "DE02" }],
          },
        ]}
        testId="compare"
      />,
    );
  }

  test("exposes a named table with column and row headers", () => {
    renderTable();
    expect(screen.getByRole("table", { name: "Angaben im Vergleich" })).toBeTruthy();
    const columnHeaders = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(columnHeaders).toEqual(["Angabe", "Aus dem Dokument", "Im Bestand"]);
    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders.map((th) => th.textContent)).toEqual(["Name", "IBAN"]);
    expect(rowHeaders.every((th) => th.getAttribute("scope") === "row")).toBe(true);
  });

  test("renders node cells, honours colSpan and highlights a warn row", () => {
    renderTable();
    const spanning = screen.getByText("Ilse Grundbesitz").closest("td");
    expect(spanning?.getAttribute("colspan")).toBe("2");
    const warnRow = screen.getByRole("rowheader", { name: "IBAN" }).closest("tr");
    expect(warnRow?.className).toContain("bg-status-warn-surface");
    expect(screen.getByRole("rowheader", { name: "Name" }).closest("tr")?.className).not.toContain(
      "bg-status-warn-surface",
    );
  });
});
