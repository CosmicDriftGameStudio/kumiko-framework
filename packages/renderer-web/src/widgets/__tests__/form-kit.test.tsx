import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, renderHook, screen } from "../../__tests__/test-utils";
import { DetailList } from "../detail-list";
import {
  BooleanField,
  DateField,
  MoneyField,
  NumberField,
  PercentField,
  SelectField,
  TextareaField,
  TextField,
} from "../form-fields";
import { ComparisonTable, ResultPanel, ResultTable } from "../result-panel";
import { useDraft } from "../use-draft";

describe("useDraft", () => {
  test("field() liefert verdrahtete Props, onChange patcht den Draft", () => {
    const { result } = renderHook(() => useDraft<{ sum: number | undefined }>({ sum: 100 }));
    expect(result.current.field("sum")).toMatchObject({ id: "sum", name: "sum", value: 100 });
    act(() => result.current.field("sum").onChange(250));
    expect(result.current.draft.sum).toBe(250);
  });

  test("reset stellt die Defaults wieder her", () => {
    const { result } = renderHook(() => useDraft<{ a: number | undefined }>({ a: 1 }));
    act(() => result.current.patch({ a: 9 }));
    expect(result.current.draft.a).toBe(9);
    act(() => result.current.reset());
    expect(result.current.draft.a).toBe(1);
  });
});

describe("NumberField", () => {
  test("rendert Label und meldet Zahl bei Eingabe", () => {
    const onChange = mock();
    render(<NumberField label="Summe" id="sum" name="sum" value={300} onChange={onChange} />);
    expect(screen.getByText("Summe")).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  test("leeres Feld meldet undefined", () => {
    const onChange = mock();
    render(<NumberField label="X" id="x" name="x" value={5} onChange={onChange} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  test("MoneyField/PercentField rendern als beschriftetes Zahlenfeld ohne Einheit-Badge", () => {
    const noop = (): void => {};
    const { rerender } = render(
      <MoneyField label="Betrag (€)" id="b" name="b" value={1} onChange={noop} />,
    );
    expect(screen.getByText("Betrag (€)")).toBeTruthy();
    expect(screen.getByRole("spinbutton")).toBeTruthy();
    expect(screen.queryByText("€")).toBeNull(); // Einheit lebt im Label, kein separates Badge
    rerender(<PercentField label="Zins (%)" id="z" name="z" value={1} onChange={noop} />);
    expect(screen.queryByText("%")).toBeNull();
  });
});

describe("DetailList emphasize", () => {
  test("emphasize hebt Label und Wert hervor", () => {
    render(
      <DetailList
        testId="dl"
        rows={[
          { label: "Summe", value: "100" },
          { label: "Effektiv", value: "3,1 %", emphasize: true },
        ]}
      />,
    );
    expect(screen.getByText("Effektiv").className).toContain("font-semibold");
    expect(screen.getByText("Summe").className).not.toContain("font-semibold");
  });
});

describe("ResultPanel", () => {
  test("empty zeigt den Platzhalter, keine Liste", () => {
    render(<ResultPanel title="Ergebnis" empty emptyText="Werte eingeben" />);
    expect(screen.getByText("Werte eingeben")).toBeTruthy();
  });

  test("gefüllt zeigt Kennzahlen und children", () => {
    render(
      <ResultPanel title="Ergebnis" rows={[{ label: "Rate", value: "890 €" }]}>
        <span>extra</span>
      </ResultPanel>,
    );
    expect(screen.getByText("Rate")).toBeTruthy();
    expect(screen.getByText("extra")).toBeTruthy();
  });
});

describe("ResultTable", () => {
  test("rendert Header, Zeilen und rechtsbündige Zahlenspalte", () => {
    render(
      <ResultTable
        testId="rt"
        columns={[
          { header: "Tranche", cell: (r: { name: string; sum: string }) => r.name },
          { header: "Summe", align: "right", cell: (r) => r.sum },
        ]}
        rows={[{ name: "Bank", sum: "300.000 €" }]}
        rowKey={(r) => r.name}
      />,
    );
    expect(screen.getByText("Tranche")).toBeTruthy();
    expect(screen.getByText("Bank")).toBeTruthy();
    expect(screen.getByText("Summe").className).toContain("text-right");
    expect(screen.getByText("300.000 €").className).toContain("tabular-nums");
  });
});

describe("Feld-Widgets (Select/Date/Text/Boolean/Textarea)", () => {
  const noopStr = (): void => {};

  test("SelectField rendert Label und den aktuell gewählten Wert", () => {
    render(
      <SelectField
        label="Land"
        id="l"
        name="l"
        value="NW"
        onChange={noopStr}
        options={[
          { value: "NW", label: "Nordrhein-Westfalen" },
          { value: "BY", label: "Bayern" },
        ]}
      />,
    );
    expect(screen.getByText("Land")).toBeTruthy();
    expect(screen.getByText("Nordrhein-Westfalen")).toBeTruthy();
  });

  test("TextField meldet Eingabe", () => {
    const onChange = mock();
    render(<TextField label="Name" id="n" name="n" value="A" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Neu" } });
    expect(onChange).toHaveBeenCalledWith("Neu");
  });

  test("DateField rendert mit Wert", () => {
    render(
      <DateField
        label="Datum"
        id="d"
        name="d"
        value="2026-07-10"
        onChange={noopStr}
        max="2030-01-01"
      />,
    );
    expect(screen.getByText("Datum")).toBeTruthy();
  });

  test("BooleanField meldet Umschalten", () => {
    const onChange = mock();
    render(<BooleanField label="Aktiv" id="b" name="b" value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("TextareaField meldet Eingabe", () => {
    const onChange = mock();
    render(<TextareaField label="Notiz" id="t" name="t" value="" onChange={onChange} rows={3} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Text" } });
    expect(onChange).toHaveBeenCalledWith("Text");
  });
});

describe("ResultPanel footer", () => {
  test("rendert den footer-Slot", () => {
    render(
      <ResultPanel
        title="R"
        rows={[{ label: "X", value: "1" }]}
        footer={<button type="button">Los</button>}
      >
        <span>body</span>
      </ResultPanel>,
    );
    expect(screen.getByRole("button", { name: "Los" })).toBeTruthy();
  });
});

describe("ComparisonTable", () => {
  test("transponierte Matrix mit Best-Highlight je Kennzahl", () => {
    const cols = [
      { name: "A", rate: 900 },
      { name: "B", rate: 850 },
    ];
    render(
      <ComparisonTable
        testId="cmp"
        columns={cols}
        columnHeader={(c) => c.name}
        columnKey={(c) => c.name}
        metricLabel="Kennzahl"
        metrics={[
          {
            label: "Rate",
            value: (c: { name: string; rate: number }) => `${c.rate} €`,
            bestIndex: (cs) => ((cs[0]?.rate ?? 0) <= (cs[1]?.rate ?? 0) ? 0 : 1),
          },
        ]}
      />,
    );
    expect(screen.getByText("Kennzahl")).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
    // B (850) ist günstiger → hervorgehoben (font-semibold text-primary span)
    expect(screen.getByText("850 €").className).toContain("text-primary");
    expect(screen.getByText("900 €").className).not.toContain("text-primary");
  });
});
