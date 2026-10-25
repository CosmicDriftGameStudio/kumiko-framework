import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { usePrimitives } from "../../../index.ts";
import { act, fireEvent, render, renderHook, screen } from "../../__tests__/test-utils.tsx";
import { DetailList } from "../detail-list.tsx";
import {
  BooleanField,
  DateField,
  FileField,
  MoneyField,
  NumberField,
  PercentField,
  RangeField,
  SelectField,
  TextareaField,
  TextField,
} from "../form-fields.tsx";
import { ComparisonTable, ResultPanel, ResultTable } from "../result-panel.tsx";
import { useDraft } from "../use-draft.ts";

describe("useDraft", () => {
  test("field() provides wired props, onChange patches the draft", () => {
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

  test("idPrefix prevents duplicate DOM ids across multiple useDraft forms with the same field name", () => {
    const a = renderHook(() =>
      useDraft<{ sum: number | undefined }>({ sum: 1 }, { idPrefix: "a" }),
    );
    const b = renderHook(() =>
      useDraft<{ sum: number | undefined }>({ sum: 2 }, { idPrefix: "b" }),
    );
    expect(a.result.current.field("sum").id).toBe("a-sum");
    expect(b.result.current.field("sum").id).toBe("b-sum");
    // `name` remains the raw key; only the DOM id gets prefixed.
    expect(a.result.current.field("sum").name).toBe("sum");
  });
});

describe("NumberField", () => {
  test("renders a label and reports a number on input", () => {
    const onChange = mock();
    render(<NumberField label="Summe" id="sum" name="sum" value={300} onChange={onChange} />);
    expect(screen.getByText("Summe")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  test("leeres Feld meldet undefined", () => {
    const onChange = mock();
    render(<NumberField label="X" id="x" name="x" value={5} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  test("MoneyField/PercentField render as a labeled number field without a unit badge", () => {
    const noop = (): void => {};
    const { rerender } = render(
      <MoneyField label="Betrag (€)" id="b" name="b" value={1} onChange={noop} />,
    );
    expect(screen.getByText("Betrag (€)")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.queryByText("€")).toBeNull(); // The unit belongs in the label; no separate badge
    rerender(<PercentField label="Zins (%)" id="z" name="z" value={1} onChange={noop} />);
    expect(screen.queryByText("%")).toBeNull();
  });
});

describe("DetailList emphasize", () => {
  test("emphasize highlights the label and value", () => {
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
  test("empty shows the placeholder, not a list", () => {
    render(<ResultPanel title="Ergebnis" empty emptyText="Werte eingeben" />);
    expect(screen.getByText("Werte eingeben")).toBeTruthy();
  });

  test("filled shows metrics and children", () => {
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
  test("renders the header, rows, and a right-aligned numeric column", () => {
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

  test("SelectField renders the label and the currently selected value", () => {
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

  test("DateField renders with a value", () => {
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
  test("renders the footer slot", () => {
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

describe("RangeField", () => {
  test("reports the slider value as a number", () => {
    const onChange = mock();
    render(
      <RangeField
        label="Abruf"
        id="r"
        name="r"
        value={20}
        min={0}
        max={100}
        step={5}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Abruf")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "45" } });
    expect(onChange).toHaveBeenCalledWith(45);
  });
});

describe("FileField", () => {
  test("rendert Label", () => {
    render(
      <FileField label="Bild" id="f" name="f" value={null} onChange={() => {}} variant="image" />,
    );
    expect(screen.getByText("Bild")).toBeTruthy();
  });

  test('variant="image" with a set FileRef shows a preview + Remove button', () => {
    render(
      <FileField
        label="Bild"
        id="f3"
        name="f3"
        value="11111111-2222-4333-8444-555555555555"
        onChange={() => {}}
        variant="image"
      />,
    );
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.src).toContain("/api/files/11111111-2222-4333-8444-555555555555");
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  test("Remove-Button ruft onChange(null)", () => {
    const onChange = mock();
    render(
      <FileField
        label="Bild"
        id="f4"
        name="f4"
        value="11111111-2222-4333-8444-555555555555"
        onChange={onChange}
        variant="image"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  test("entityType/fieldName are forwarded to the /api/files upload request", async () => {
    const originalFetch = global.fetch;
    const fetchSpy = mock(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: "file-1" })),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      render(
        <FileField
          label="Anhang"
          id="f2"
          name="f2"
          value={null}
          onChange={() => {}}
          entityType="property"
          fieldName="brochure"
        />,
      );
      const input = document.getElementById("f2") as HTMLInputElement;
      const file = new File(["x"], "brochure.pdf", { type: "application/pdf" });
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
      });
      expect(fetchSpy).toHaveBeenCalled();
      const body = fetchSpy.mock.calls[0]?.[1]?.body as FormData;
      expect(body.get("entityType")).toBe("property");
      expect(body.get("fieldName")).toBe("brochure");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("Button size", () => {
  function SizedButton({ size }: { readonly size: "sm" | "md" | "icon" }): ReactNode {
    const { Button } = usePrimitives();
    return (
      <Button size={size} onClick={() => {}}>
        X
      </Button>
    );
  }
  test("size=sm renders the compact shadcn size (h-8)", () => {
    render(<SizedButton size="sm" />);
    expect(screen.getByRole("button", { name: "X" }).className).toContain("h-8");
  });

  test("ariaLabel gives icon-only buttons an accessible name", () => {
    function IconBtn(): ReactNode {
      const { Button } = usePrimitives();
      return (
        <Button size="icon" ariaLabel="Entfernen" onClick={() => {}}>
          ✕
        </Button>
      );
    }
    render(<IconBtn />);
    expect(screen.getByRole("button", { name: "Entfernen" })).toBeTruthy();
  });

  test('width="full" stretches the button (w-full)', () => {
    function WideBtn(): ReactNode {
      const { Button } = usePrimitives();
      return (
        <Button width="full" onClick={() => {}}>
          Upgrade
        </Button>
      );
    }
    render(<WideBtn />);
    expect(screen.getByRole("button", { name: "Upgrade" }).className).toContain("w-full");
  });
});

describe("ComparisonTable", () => {
  test("transposed matrix with a best highlight for each metric", () => {
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
    // B (850) is cheaper → highlighted (`font-semibold text-primary` span)
    expect(screen.getByText("850 €").className).toContain("text-primary");
    expect(screen.getByText("900 €").className).not.toContain("text-primary");
  });
});
