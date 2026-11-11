// The page-header help button opens a dialog listing every option of the status field in option
// order, each with its badge (label and tone) and the `:help` sentence.

import { describe, expect, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { PageHelpButton } from "../../components/page-help-button.tsx";
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
  "kumiko.pageHelp.button": "Status erklärt",
  "kumiko.pageHelp.title": "Status",
  "kumiko.dialog.close": "Schließen",
  "docs:entity:doc:field:status:option:draft": "Ungeprüft",
  "docs:entity:doc:field:status:option:draft:help": "Noch niemand hat den Beleg angesehen.",
  "docs:entity:doc:field:status:option:checked": "Geprüft",
  "docs:entity:doc:field:status:option:checked:help": "Ein Mitarbeiter hat den Beleg freigegeben.",
  "docs:entity:doc:field:status:option:rejected": "Abgelehnt",
  "docs:entity:doc:field:status:option:rejected:help": "Der Beleg wurde zurückgewiesen.",
};
const translate = (key: string): string => TEXTS[key] ?? `MISSING:${key}`;

function mount(statusField: string): void {
  render(
    <PageHelpButton
      spec={{ statusField }}
      entityName="doc"
      entity={entity}
      featureName="docs"
      translate={translate}
    />,
  );
}

describe("PageHelpButton", () => {
  test("shows label, tone and help sentence of every option in option order", async () => {
    mount("status");
    expect(screen.queryByTestId("page-help-dialog")).toBeNull();
    await userEvent.click(screen.getByTestId("page-help-button"));

    const dialog = screen.getByTestId("page-help-dialog");
    expect(within(dialog).getByText("Status")).toBeTruthy();
    const rows = within(dialog)
      .getAllByTestId(/^page-help-option-/)
      .map((row) => row.getAttribute("data-testid"));
    expect(rows).toEqual([
      "page-help-option-draft",
      "page-help-option-checked",
      "page-help-option-rejected",
    ]);

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

  test("renders nothing when the status field is not a select field", () => {
    mount("title");
    expect(screen.queryByTestId("page-help-button")).toBeNull();
  });
});
