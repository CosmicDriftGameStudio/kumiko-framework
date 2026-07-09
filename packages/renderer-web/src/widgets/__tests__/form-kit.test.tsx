import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, renderHook, screen } from "../../__tests__/test-utils";
import { DetailList } from "../detail-list";
import { MoneyField, NumberField, PercentField } from "../form-fields";
import { ResultPanel, ResultTable } from "../result-panel";
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
