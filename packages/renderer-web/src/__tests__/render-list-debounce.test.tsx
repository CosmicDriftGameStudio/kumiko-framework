//
// RenderList puffert Tipps im Search-Input lokal und schickt
// onSearchChange erst nach 300ms ohne weitere Tasten. Vor dieser Suite
// nur durch Code-Read bewiesen — bei der nächsten Refactor-Welle wäre
// die Race-Condition (Sync-Effect auf searchValue + Debounce-Effect)
// wahrscheinlich kaputt gegangen ohne dass eine CI das fängt.

import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
  RenderList,
} from "@cosmicdrift/kumiko-renderer";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { defaultPrimitives } from "../primitives";

// Minimal-Entity damit RenderList nicht über fehlende Felder stolpert.
// Eine Spalte reicht — wir testen nur den Search-Debounce-Pfad, nicht
// die DataTable-Render-Tiefe.
const entity: EntityDefinition = {
  fields: { title: { type: "text" } },
} as EntityDefinition;

const screenDef: EntityListScreenDefinition = {
  id: "items",
  type: "entityList",
  entity: "item",
  columns: ["title"],
};

function renderRL(props: {
  readonly searchValue?: string;
  readonly onSearchChange?: (next: string) => void;
}) {
  return render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de" })}>
      <PrimitivesProvider value={defaultPrimitives}>
        <RenderList
          screen={screenDef}
          entity={entity}
          rows={[]}
          featureName="t"
          searchable
          {...props}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderList — Search-Debounce", () => {
  beforeEach(() => {
    jest.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("Tippen unter 300ms feuert NICHT mehrfach onSearchChange", () => {
    const onSearchChange = mock();
    renderRL({ searchValue: "", onSearchChange });

    const input = screen.getByPlaceholderText(/kumiko\.list\.search-placeholder|suchen/i);
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ac" } });
    fireEvent.change(input, { target: { value: "acm" } });
    fireEvent.change(input, { target: { value: "acme" } });

    // Vor Debounce-Ablauf: kein call (jeder Keypress hat den Timer
    // resettet).
    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(onSearchChange).not.toHaveBeenCalled();

    // 300ms: jetzt feuert es exakt einmal mit dem letzten Wert.
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange).toHaveBeenCalledWith("acme");
  });

  test("searchValue-Update von außen syncs lokalen Buffer (Browser-Back)", () => {
    const onSearchChange = mock();
    const { rerender } = renderRL({ searchValue: "first", onSearchChange });
    const input = screen.getByDisplayValue("first") as HTMLInputElement;
    expect(input.value).toBe("first");

    // Externe Quelle (Browser-Back, Cross-Component-Reset) ändert
    // searchValue → RenderList soll den Input-Wert spiegeln.
    rerender(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de" })}>
        <PrimitivesProvider value={defaultPrimitives}>
          <RenderList
            screen={screenDef}
            entity={entity}
            rows={[]}
            featureName="t"
            searchable
            searchValue="second"
            onSearchChange={onSearchChange}
          />
        </PrimitivesProvider>
      </LocaleProvider>,
    );
    expect((screen.getByDisplayValue("second") as HTMLInputElement).value).toBe("second");
  });

  test("onSearchChange wird NICHT gerufen wenn lokal === searchValue (kein Echo)", () => {
    // Wenn der Parent searchValue auf "x" setzt UND der lokale Buffer
    // schon "x" ist (z.B. Cleanup-Timing), darf RenderList nicht den
    // Wert nochmal zurückrufen — sonst wäre's eine Loop.
    const onSearchChange = mock();
    renderRL({ searchValue: "x", onSearchChange });
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(onSearchChange).not.toHaveBeenCalled();
  });
});
