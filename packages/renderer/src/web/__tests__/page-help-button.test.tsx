// The page-header help button opens a dialog listing every option of the status field in option
// order, each with its badge (label and tone) and the `:help` sentence.

import { describe, expect, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import {
  PageHelpButton,
  type ResolvedPageHelpSection,
} from "../../components/page-help-button.tsx";
import { render, screen, within } from "./test-utils.tsx";

const entity = {
  fields: {
    status: {
      type: "select" as const,
      options: ["draft", "checked", "rejected"] as const,
      optionTones: { checked: "ok" as const, rejected: "bad" as const },
    },
    title: { type: "text" as const, pii: true as const },
  },
};

const TEXTS: Readonly<Record<string, string>> = {
  "kumiko.pageHelp.button": "Hilfe zu dieser Seite",
  "kumiko.pageHelp.buttonLabel": "Erklärungen",
  "kumiko.pageHelp.statusIntro": "Was die Status bedeuten",
  "kumiko.dialog.close": "Schließen",
  "docs:entity:doc:noun": "Beleg",
  "docs:entity:doc:field:status": "Status",
  "docs:entity:doc:field:kind": "Art",
  "docs:entity:doc:field:kind:option:invoice": "Rechnung",
  "docs:entity:doc:field:kind:option:invoice:help": "Eine Rechnung zum Bezahlen.",
  "docs:status:title": "Belege",
  "docs:text:title": "Was ist das?",
  "docs:text:body": "Alle Belege an einem Ort.",
  "docs:entity:doc:field:status:option:draft": "Ungeprüft",
  "docs:entity:doc:field:status:option:draft:help": "Noch niemand hat den Beleg angesehen.",
  "docs:entity:doc:field:status:option:checked": "Geprüft",
  "docs:entity:doc:field:status:option:checked:help": "Ein Mitarbeiter hat den Beleg freigegeben.",
  "docs:entity:doc:field:status:option:rejected": "Abgelehnt",
  "docs:entity:doc:field:status:option:rejected:help": "Der Beleg wurde zurückgewiesen.",
};
const translate = (key: string): string => TEXTS[key] ?? key;

const statusSection = (field: string): ResolvedPageHelpSection => ({
  kind: "status",
  field,
  entityName: "doc",
  entity,
  featureName: "docs",
  titleKey: "docs:status:title",
});

function mount(sections: readonly ResolvedPageHelpSection[]): void {
  render(<PageHelpButton sections={sections} translate={translate} />);
}

describe("PageHelpButton", () => {
  test("a labelled button opens a drawer with one card headed by the section title", async () => {
    mount([statusSection("status")]);
    expect(screen.queryByTestId("page-help-drawer")).toBeNull();
    const button = screen.getByTestId("page-help-button");
    expect(button.textContent).toBe("Erklärungen");
    expect(button.getAttribute("title")).toBe("Hilfe zu dieser Seite");
    await userEvent.click(button);
    const drawer = screen.getByTestId("page-help-drawer");
    expect(within(drawer).getByText("Hilfe zu dieser Seite")).toBeTruthy();
    expect(within(drawer).getByText("Belege")).toBeTruthy();
    expect(within(drawer).getByText("Was die Status bedeuten")).toBeTruthy();
  });

  test("a text section and a status section are stacked in order", async () => {
    mount([
      { kind: "text", title: "docs:text:title", text: "docs:text:body" },
      statusSection("status"),
    ]);
    await userEvent.click(screen.getByTestId("page-help-button"));
    const drawer = screen.getByTestId("page-help-drawer");
    const first = within(drawer).getByTestId("page-help-section-0");
    expect(first.textContent).toContain("Was ist das?");
    expect(first.textContent).toContain("Alle Belege an einem Ort.");
    expect(within(drawer).getByTestId("page-help-section-1").textContent).toContain("Belege");
  });

  test("shows label, tone and help sentence of every option in option order", async () => {
    mount([statusSection("status")]);
    await userEvent.click(screen.getByTestId("page-help-button"));

    const dialog = screen.getByTestId("page-help-drawer");
    const rows = within(dialog)
      .getAllByTestId(/^page-help-badge-/)
      .map((row) => row.getAttribute("data-testid"));
    expect(rows).toEqual([
      "page-help-badge-draft",
      "page-help-badge-checked",
      "page-help-badge-rejected",
    ]);

    // Badge and sentence of every option are flat pairs in one ruled legend grid with a fixed term column.
    const options = within(dialog).getByTestId("page-help-options");
    expect(options.children).toHaveLength(6);
    expect(options.className).toContain("grid-cols-[13rem_minmax(0,1fr)]");
    for (const value of ["draft", "checked", "rejected"]) {
      expect(
        within(options).getByTestId(`page-help-badge-${value}`).parentElement?.parentElement,
      ).toBe(options);
      expect(
        within(options).getByTestId(`page-help-text-${value}`).parentElement?.parentElement,
      ).toBe(options);
    }

    const draft = within(dialog).getByTestId("page-help-badge-draft");
    expect(draft.textContent).toContain("Ungeprüft");
    expect(draft.className).toContain("text-status-warn");
    const checked = within(dialog).getByTestId("page-help-badge-checked");
    expect(checked.textContent).toContain("Geprüft");
    expect(checked.className).toContain("text-status-ok");
    expect(within(dialog).getByTestId("page-help-badge-rejected").className).toContain(
      "text-status-bad",
    );
    expect(within(dialog).getByTestId("page-help-text-draft").textContent).toBe(
      "Noch niemand hat den Beleg angesehen.",
    );
    expect(within(dialog).getByTestId("page-help-text-checked").textContent).toBe(
      "Ein Mitarbeiter hat den Beleg freigegeben.",
    );
    expect(within(dialog).getByTestId("page-help-text-rejected").textContent).toBe(
      "Der Beleg wurde zurückgewiesen.",
    );
  });

  test("a status section whose field is not a select field renders no legend", async () => {
    mount([statusSection("title")]);
    await userEvent.click(screen.getByTestId("page-help-button"));
    expect(screen.queryByTestId("page-help-options")).toBeNull();
  });
});
