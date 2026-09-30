import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "../../__tests__/test-utils";
import { defaultPrimitives } from "../index";

const { Field, Input } = defaultPrimitives;

const OPTIONS = [
  {
    value: "same",
    label: "Ja, dieselbe Person",
    description: "Bestehenden Kontakt aktualisieren.",
  },
  { value: "other", label: "Nein, neuer Kontakt", description: "Für eine andere Person." },
  { value: "skip", label: "Überspringen" },
] as const;

function renderCards(value: string, changes: string[]): void {
  render(
    <Field id="decision" label="Ist das dieselbe Person?" testId="field-decision">
      <Input
        kind="select"
        id="decision"
        name="decision"
        value={value}
        onChange={(v) => changes.push(v)}
        options={OPTIONS}
        radioVariant="card"
      />
    </Field>,
  );
}

describe("select radioVariant=card", () => {
  test("renders a labelled radiogroup with title and description per option", () => {
    renderCards("same", []);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText("Bestehenden Kontakt aktualisieren.")).toBeTruthy();
    expect(screen.getByText("Für eine andere Person.")).toBeTruthy();
    expect(screen.getByText("Überspringen").parentElement?.children).toHaveLength(1);
  });

  test("marks only the current value as checked and reports a click", () => {
    const changes: string[] = [];
    renderCards("same", changes);
    const [same, other] = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(same?.checked).toBe(true);
    expect(other?.checked).toBe(false);
    fireEvent.click(other as HTMLInputElement);
    expect(changes).toEqual(["other"]);
  });

  test("forces the radio group even beyond the segmented option threshold", () => {
    render(
      <Field id="many" label="Viele" testId="field-many">
        <Input
          kind="select"
          id="many"
          name="many"
          value="a"
          onChange={() => {}}
          options={["a", "b", "c", "d", "e"]}
          radioVariant="card"
        />
      </Field>,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.queryByTestId("combobox-many")).toBeNull();
  });

  test("without radioVariant the same options keep the plain radio list without descriptions", () => {
    render(
      <Field id="decision" label="Ist das dieselbe Person?" testId="field-decision">
        <Input
          kind="select"
          id="decision"
          name="decision"
          value="same"
          onChange={() => {}}
          options={OPTIONS}
        />
      </Field>,
    );
    expect(screen.queryByText("Für eine andere Person.")).toBeNull();
  });
});

describe("select radioVariant=card: description", () => {
  test("unchecked cards stay clickable through their label text", () => {
    const changes: string[] = [];
    renderCards("same", changes);
    fireEvent.click(screen.getByText("Nein, neuer Kontakt"));
    expect(changes).toEqual(["other"]);
  });
});
