// Segment control for `kind: "select"` with a small closed option set
// (edit-existing screenshot feedback): a Status field with 3 short values
// no longer stretches into a full-width dropdown. Threshold: ≤4 options,
// each label ≤14 chars — otherwise the unchanged ComboboxInput dropdown.

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

  test("3 options with one long label (>14 chars) keep the dropdown", () => {
    renderSelect(["Draft", "Review", "Published Status"]);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByTestId("combobox-status")).toBeTruthy();
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
