// Segment control for `kind: "select"` with a small closed option set
// (edit-existing screenshot feedback): a Status field with 3 short values
// no longer stretches into a full-width dropdown. Threshold: ≤4 options —
// otherwise the unchanged ComboboxInput dropdown. Label length is explicitly
// not part of the threshold (#2606).

import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "../../__tests__/test-utils";
import { defaultPrimitives } from "../index";

const { Field, Input } = defaultPrimitives;

function renderSelect(
  options: readonly string[],
  overrides: { readonly value?: string; readonly disabled?: boolean } = {},
): string[] {
  const changes: string[] = [];
  render(
    <Field id="status" label="Status" testId="field-status">
      <Input
        kind="select"
        id="status"
        name="status"
        value={overrides.value ?? options[0] ?? ""}
        onChange={(v) => changes.push(v)}
        options={options}
        {...(overrides.disabled !== undefined && { disabled: overrides.disabled })}
      />
    </Field>,
  );
  return changes;
}

describe("DefaultInput select → segmented control (edit-existing feedback)", () => {
  test("≤4 short options render the segmented control, not the dropdown", () => {
    renderSelect(["Draft", "Review", "Published"]);
    expect(screen.queryByTestId("combobox-status")).toBeNull();
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  test("4 options render the segmented control", () => {
    renderSelect(["Draft", "Review", "Published", "Archived"]);
    expect(screen.queryByTestId("combobox-status")).toBeNull();
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
  });

  test("5 options keep the dropdown", () => {
    renderSelect(["Draft", "Review", "Published", "Archived", "Deleted"]);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByTestId("combobox-status")).toBeTruthy();
  });

  test("a long label no longer pushes the field into the dropdown", () => {
    renderSelect(["Draft", "Review", "Published Status"]);
    expect(screen.queryByTestId("combobox-status")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  test("clicking a segment reports the same value the dropdown's onChange would give", () => {
    const changes = renderSelect(["Draft", "Review", "Published"], { value: "Draft" });
    fireEvent.click(screen.getByRole("radio", { name: "Review" }));
    expect(changes).toEqual(["Review"]);
  });

  test("group has an accessible name and the selected segment is aria-checked", () => {
    renderSelect(["Draft", "Review", "Published"], { value: "Review" });
    expect(screen.getByRole("radiogroup", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Review" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Draft" }).getAttribute("aria-checked")).toBe("false");
  });

  test("disabled prevents selection", () => {
    const changes = renderSelect(["Draft", "Review", "Published"], {
      value: "Draft",
      disabled: true,
    });
    const review = screen.getByRole("radio", { name: "Review" });
    expect((review as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(review);
    expect(changes).toEqual([]);
  });
});

// offlot-app's language picker from #2606: same four option values, the German
// translations land at 14 chars and the English ones above it.
const LANGUAGE_OPTIONS_EN = [
  { value: "", label: "Select a language" },
  { value: "de", label: "German" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
];

const LANGUAGE_OPTIONS_DE = [
  { value: "", label: "Sprache wählen" },
  { value: "de", label: "Deutsch" },
  { value: "en", label: "Englisch" },
  { value: "es", label: "Spanisch" },
];

function renderedSelectWidget(
  options: readonly { readonly value: string; readonly label: string }[],
): "radiogroup" | "combobox" | "neither" {
  const { container, unmount } = render(
    <Field id="language" label="Language" testId="field-language">
      <Input
        kind="select"
        id="language"
        name="language"
        value=""
        onChange={() => {}}
        options={options}
      />
    </Field>,
  );
  const hasRadioGroup = container.querySelector('[role="radiogroup"]') !== null;
  const hasCombobox = container.querySelector('[data-testid="combobox-language"]') !== null;
  unmount();
  if (hasRadioGroup) return "radiogroup";
  return hasCombobox ? "combobox" : "neither";
}

describe("DefaultInput select → widget choice is independent of the UI language", () => {
  test("translated labels of different lengths pick the same widget", () => {
    expect(renderedSelectWidget(LANGUAGE_OPTIONS_EN)).toBe(
      renderedSelectWidget(LANGUAGE_OPTIONS_DE),
    );
  });

  test("and that widget is the segmented control both times", () => {
    expect(renderedSelectWidget(LANGUAGE_OPTIONS_EN)).toBe("radiogroup");
    expect(renderedSelectWidget(LANGUAGE_OPTIONS_DE)).toBe("radiogroup");
  });
});
