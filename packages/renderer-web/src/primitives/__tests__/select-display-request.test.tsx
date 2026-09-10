// `kind: "select"` with an explicit `display` (#2711). The short-option-set
// heuristic covered by select-segmented.test.tsx stays the default; these
// tests only cover the case where the caller states a presentation and the
// heuristic would have decided the other way.

import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "../../__tests__/test-utils";
import { defaultPrimitives } from "../index";

const { Field, Input } = defaultPrimitives;

// Six options, every label past the 14-char threshold — the heuristic would
// render a dropdown for these.
const HEURISTIC_REJECTS = [
  "Background Jobs Queue",
  "Inbound Mail Processing",
  "Realtime Event Stream",
  "Scheduled Reporting",
  "Tenant Provisioning",
  "Search Index Rebuild",
];

// Three short labels — the heuristic would render the radio group for these.
const HEURISTIC_ACCEPTS = ["Draft", "Review", "Done"];

function renderSelect(
  options: readonly string[],
  overrides: {
    readonly display?: "radio" | "dropdown";
    readonly value?: string;
  } = {},
): string[] {
  const changes: string[] = [];
  render(
    <Field id="area" label="Area" testId="field-area">
      <Input
        kind="select"
        id="area"
        name="area"
        value={overrides.value ?? options[0] ?? ""}
        onChange={(v) => changes.push(v)}
        options={options}
        {...(overrides.display !== undefined && { display: overrides.display })}
      />
    </Field>,
  );
  return changes;
}

describe("DefaultInput select — explicit display request", () => {
  test('display: "radio" renders the radio group even where the heuristic says dropdown', () => {
    renderSelect(HEURISTIC_REJECTS, { display: "radio" });
    expect(screen.queryByTestId("combobox-area")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(6);
  });

  test("the forced radio group keeps the accessible group name and checked state", () => {
    renderSelect(HEURISTIC_REJECTS, {
      display: "radio",
      value: "Realtime Event Stream",
    });
    expect(screen.getByRole("radiogroup", { name: "Area" })).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Realtime Event Stream" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: "Background Jobs Queue" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  test("the forced radio group reports the raw option value on click", () => {
    const changes = renderSelect(HEURISTIC_REJECTS, {
      display: "radio",
      value: "Background Jobs Queue",
    });
    fireEvent.click(screen.getByRole("radio", { name: "Search Index Rebuild" }));
    expect(changes).toEqual(["Search Index Rebuild"]);
  });

  test('display: "dropdown" keeps the dropdown where the heuristic says radio group', () => {
    renderSelect(HEURISTIC_ACCEPTS, { display: "dropdown" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByTestId("combobox-area")).toBeTruthy();
  });

  test("no display stated: the heuristic still decides", () => {
    renderSelect(HEURISTIC_REJECTS);
    expect(screen.getByTestId("combobox-area")).toBeTruthy();
  });

  test('display: "radio" without options falls back to the dropdown, not an empty group', () => {
    renderSelect([], { display: "radio" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByTestId("combobox-area")).toBeTruthy();
  });

  test("labelled options render their label and report their value", () => {
    const changes: string[] = [];
    render(
      <Field id="area" label="Area" testId="field-area">
        <Input
          kind="select"
          id="area"
          name="area"
          value="jobs"
          onChange={(v) => changes.push(v)}
          display="radio"
          options={[
            { value: "jobs", label: "Background Jobs Queue" },
            { value: "mail", label: "Inbound Mail Processing" },
            { value: "search", label: "Search Index Rebuild" },
            { value: "events", label: "Realtime Event Stream" },
            { value: "tenants", label: "Tenant Provisioning" },
          ]}
        />
      </Field>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Inbound Mail Processing" }));
    expect(changes).toEqual(["mail"]);
  });
});
