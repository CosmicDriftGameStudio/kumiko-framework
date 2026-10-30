import { describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, screen, within } from "../../__tests__/test-utils.tsx";
import { StepList, type StepListItem } from "../step-list.tsx";

const onReview = mock(() => {});
const onReject = mock(() => {});

const heatingSteps: readonly StepListItem[] = [
  {
    id: "case",
    title: "Vorgang „Heizungsausfall Whg. 3“",
    status: "done",
    meta: "Angelegt von dir, Mo 09:05",
    link: { label: "Öffnen", href: "/cases/heizungsausfall" },
    actions: [{ id: "never", label: "Nie sichtbar", onClick: () => {} }],
  },
  {
    id: "order",
    title: "Neuer Auftrag an Heizung Schulz GmbH",
    description: "Notdienst heute, Zugang über Hausmeister.",
    status: "open",
    tags: [{ label: "Sendet eine Mail", tone: "accent" }],
    actions: [
      { id: "review", label: "Prüfen", variant: "primary", onClick: onReview },
      { id: "reject", label: "Ablehnen", variant: "ghost", onClick: onReject },
    ],
  },
  {
    id: "reply",
    title: "Antwort an Anna Schneider",
    status: "locked",
    lockedReason: "Auftrag",
  },
  { id: "old", title: "Alter Auftrag stornieren", status: "rejected" },
];

describe("StepList", () => {
  test("progress counts done steps and leaves rejected ones out of the total", () => {
    render(<StepList title="Vorschlag der KI" steps={heatingSteps} />);
    expect(screen.getByText("1 of 3 done")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("33");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  test("actions render only for open steps and fire their handler", () => {
    render(<StepList title="Vorschlag der KI" steps={heatingSteps} />);
    expect(screen.queryByText("Nie sichtbar")).toBeNull();
    fireEvent.click(screen.getByText("Prüfen"));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Ablehnen")).toBeTruthy();
  });

  test("locked step shows the waiting tag and names its icon after the reason", () => {
    render(<StepList title="Vorschlag der KI" steps={heatingSteps} />);
    const row = screen.getByTestId("step-reply");
    expect(within(row).getAllByText("Waiting for: Auftrag").length).toBe(1);
    expect(within(row).getByRole("img").getAttribute("aria-label")).toBe("Waiting for: Auftrag");
  });

  test("rejected step is struck through and muted", () => {
    render(<StepList title="Vorschlag der KI" steps={heatingSteps} />);
    const title = screen.getByTestId("step-old-title");
    expect(title.className).toContain("line-through");
    expect(title.className).toContain("text-muted-foreground");
  });

  test("rejected step icon is a neutral grey disc with the secondary text tone", () => {
    render(<StepList title="Vorschlag der KI" steps={heatingSteps} />);
    const icon = within(screen.getByTestId("step-old")).getByRole("img");
    expect(icon.className).toContain("bg-border-row");
    expect(icon.className).toContain("text-foreground-secondary");
    expect(icon.className).not.toContain("text-status-bad");
  });

  test("link with href renders an anchor, meta and tags show up", () => {
    render(<StepList title="Vorschlag der KI" steps={heatingSteps} />);
    expect(screen.getByText("Öffnen").closest("a")?.getAttribute("href")).toBe(
      "/cases/heizungsausfall",
    );
    expect(screen.getByText("Angelegt von dir, Mo 09:05")).toBeTruthy();
    expect(screen.getByText("Sendet eine Mail")).toBeTruthy();
  });

  test("collapsedAfter hides the rest behind a 'more steps' button that expands", () => {
    render(<StepList title="Vorschlag der KI" steps={heatingSteps} collapsedAfter={2} />);
    expect(screen.queryByTestId("step-reply")).toBeNull();
    fireEvent.click(screen.getByText("and 2 more steps"));
    expect(screen.getByTestId("step-reply")).toBeTruthy();
    expect(screen.queryByText("and 2 more steps")).toBeNull();
  });

  test("footer actions render and fire", () => {
    const onRejectAll = mock(() => {});
    render(
      <StepList
        title="Vorschlag der KI"
        steps={heatingSteps}
        footerActions={[
          { id: "reject-all", label: "Alle ablehnen", variant: "ghost", onClick: onRejectAll },
          { id: "next", label: "Nächsten prüfen", variant: "primary", onClick: () => {} },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("Alle ablehnen"));
    expect(onRejectAll).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Nächsten prüfen")).toBeTruthy();
  });

  test("empty plan shows the empty content and 0 of 0", () => {
    render(<StepList title="Vorschlag der KI" steps={[]} emptyContent={<p>Kein Vorschlag</p>} />);
    expect(screen.getByText("Kein Vorschlag")).toBeTruthy();
    expect(screen.getByText("0 of 0 done")).toBeTruthy();
  });
});

describe("StepList source links and highlight", () => {
  test("sources render as links under the step and fire their callback", () => {
    const onSource = mock(() => {});
    render(
      <StepList
        title="Vorschlag der KI"
        steps={[
          {
            id: "deposit",
            title: "Kaution 2.850,00 € in drei Raten",
            status: "open",
            sources: [{ label: "Quelle: Seite 3, § 5", onClick: onSource }],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("Quelle: Seite 3, § 5"));
    expect(onSource).toHaveBeenCalledTimes(1);
  });

  test("only the highlighted step carries the warm background and aria-current", () => {
    render(
      <StepList
        title="Vorschlag der KI"
        steps={[
          { id: "a", title: "A", status: "open", highlighted: true },
          { id: "b", title: "B", status: "open" },
        ]}
      />,
    );
    const highlighted = screen.getByTestId("step-a");
    expect(highlighted.className).toContain("bg-status-warn-surface");
    expect(highlighted.getAttribute("aria-current")).toBe("step");
    expect(screen.getByTestId("step-b").className).not.toContain("bg-status-warn-surface");
    expect(screen.getByTestId("step-b").getAttribute("aria-current")).toBeNull();
  });

  test("a done step shows its trailing link and meta line next to the title", () => {
    render(<StepList title="Vorschlag der KI" steps={heatingSteps} />);
    const done = screen.getByTestId("step-case");
    expect(within(done).getByText("Öffnen").closest("a")?.getAttribute("href")).toBe(
      "/cases/heizungsausfall",
    );
    expect(within(done).getByText("Angelegt von dir, Mo 09:05")).toBeTruthy();
  });

  test("done step icon uses the ok token and fill stretches the list to its container", () => {
    const { rerender } = render(<StepList title="Plan" steps={heatingSteps} />);
    const doneIcon = within(screen.getByTestId("step-case")).getByRole("img");
    expect(doneIcon.className).toContain("bg-status-ok");
    expect(doneIcon.className).not.toContain("bg-primary");
    expect(screen.getByTestId("step-list").className).not.toContain("h-full");
    rerender(<StepList title="Plan" steps={heatingSteps} fill />);
    expect(screen.getByTestId("step-list").className).toContain("h-full");
  });

  test("status badge and subtitle render in the header and are absent by default", () => {
    const { rerender } = render(<StepList title="Plan" steps={heatingSteps} />);
    expect(screen.queryByTestId("step-list-status")).toBeNull();
    expect(screen.queryByTestId("step-list-subtitle")).toBeNull();
    rerender(
      <StepList
        title="Plan"
        steps={heatingSteps}
        status={{ label: "Erledigt", tone: "ok" }}
        subtitle="Abgeschlossen von dir am 27.10."
      />,
    );
    expect(screen.getByTestId("step-list-status").textContent).toContain("Erledigt");
    expect(screen.getByTestId("step-list-subtitle").textContent).toBe(
      "Abgeschlossen von dir am 27.10.",
    );
  });

  test("progress count keeps only the count, none hides count and bar", () => {
    const { rerender } = render(<StepList title="Plan" steps={heatingSteps} />);
    expect(screen.getByTestId("step-list-progress")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).not.toBeNull();
    rerender(<StepList title="Plan" steps={heatingSteps} progress="count" />);
    expect(screen.getByTestId("step-list-progress").textContent).toBe("1 of 3 done");
    expect(screen.queryByRole("progressbar")).toBeNull();
    rerender(<StepList title="Plan" steps={heatingSteps} progress="none" />);
    expect(screen.queryByTestId("step-list-progress")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
