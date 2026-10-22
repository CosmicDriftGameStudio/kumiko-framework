//
// RenderList buffers keystrokes in the search input locally and sends
// onSearchChange only after 300ms without further keystrokes. Before this suite,
// this was verified only by reading the code—the race condition between the
// searchValue sync effect and debounce effect likely would have broken in a
// later refactor without CI catching it.

import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
  RenderList,
} from "../../index.ts";
import { defaultPrimitives } from "../primitives/index.tsx";

// Use a minimal entity so RenderList does not encounter missing fields.
// One column is sufficient because this tests only the search-debounce path,
// not the depth of DataTable rendering.
const entity: EntityDefinition = {
  fields: { title: { type: "text", allowPlaintext: "test fixture value, not personal data" } },
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
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
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
    jest.useFakeTimers();
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

    // Before the debounce expires: no call (each keypress reset the timer).
    //
    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(onSearchChange).not.toHaveBeenCalled();

    // At 300ms, it fires exactly once with the latest value.
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

    // An external source (browser back navigation or a cross-component reset)
    // changes searchValue, so RenderList must mirror it in the input value.
    rerender(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
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

  test("Taste im selben Commit wie das Mount geht nicht verloren", () => {
    const onSearchChange = mock();
    // The keystroke is delivered from a layout effect, i.e. inside the mount
    // commit and before RenderList's passive effects have run: an effect-based
    // searchValue sync would reset the buffer afterwards and swallow the key.
    function KeystrokeOnMount(): null {
      useLayoutEffect(() => {
        const input = document.querySelector("input");
        if (input === null) throw new Error("search input not mounted");
        fireEvent.change(input, { target: { value: "a" } });
      }, []);
      return null;
    }
    render(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
        <PrimitivesProvider value={defaultPrimitives}>
          <RenderList
            screen={screenDef}
            entity={entity}
            rows={[]}
            featureName="t"
            searchable
            searchValue=""
            onSearchChange={onSearchChange}
          />
          <KeystrokeOnMount />
        </PrimitivesProvider>
      </LocaleProvider>,
    );

    expect((screen.getByDisplayValue("a") as HTMLInputElement).value).toBe("a");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange).toHaveBeenCalledWith("a");
  });

  test("onSearchChange wird NICHT gerufen wenn lokal === searchValue (kein Echo)", () => {
    // If the parent sets searchValue to "x" while the local buffer is already
    // "x" (for example, due to cleanup timing), RenderList must not emit the
    // value again, or it would create a loop.
    const onSearchChange = mock();
    renderRL({ searchValue: "x", onSearchChange });
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(onSearchChange).not.toHaveBeenCalled();
  });

  test("verspätetes Echo des eigenen Emits überschreibt zwischenzeitlich getippte Tasten nicht", () => {
    const onSearchChange = mock();
    const tree = (searchValue: string) => (
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
        <PrimitivesProvider value={defaultPrimitives}>
          <RenderList
            screen={screenDef}
            entity={entity}
            rows={[]}
            featureName="t"
            searchable
            searchValue={searchValue}
            onSearchChange={onSearchChange}
          />
        </PrimitivesProvider>
      </LocaleProvider>
    );
    const { rerender } = render(tree(""));
    const input = screen.getByPlaceholderText(
      /kumiko\.list\.search-placeholder|suchen/i,
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ab" } });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onSearchChange).toHaveBeenCalledWith("ab");

    // User keeps typing while the parent (router) has not yet echoed "ab".
    fireEvent.change(input, { target: { value: "abc" } });
    rerender(tree("ab"));
    expect(input.value).toBe("abc");

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onSearchChange).toHaveBeenLastCalledWith("abc");
  });

  test("verspätetes Echo eines älteren Emits sendet den schon gesendeten neueren Wert nicht erneut", () => {
    const onSearchChange = mock();
    const tree = (searchValue: string) => (
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
        <PrimitivesProvider value={defaultPrimitives}>
          <RenderList
            screen={screenDef}
            entity={entity}
            rows={[]}
            featureName="t"
            searchable
            searchValue={searchValue}
            onSearchChange={onSearchChange}
          />
        </PrimitivesProvider>
      </LocaleProvider>
    );
    const { rerender } = render(tree(""));
    const input = screen.getByPlaceholderText(
      /kumiko\.list\.search-placeholder|suchen/i,
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "a" } });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    fireEvent.change(input, { target: { value: "ab" } });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onSearchChange.mock.calls).toEqual([["a"], ["ab"]]);

    rerender(tree("a"));
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(input.value).toBe("ab");
    expect(onSearchChange.mock.calls).toEqual([["a"], ["ab"]]);
  });

  test("externer Wechsel auf den zuletzt gesendeten Wert wird nach einem anderen externen Wert wieder übernommen", () => {
    const onSearchChange = mock();
    const tree = (searchValue: string) => (
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
        <PrimitivesProvider value={defaultPrimitives}>
          <RenderList
            screen={screenDef}
            entity={entity}
            rows={[]}
            featureName="t"
            searchable
            searchValue={searchValue}
            onSearchChange={onSearchChange}
          />
        </PrimitivesProvider>
      </LocaleProvider>
    );
    const { rerender } = render(tree(""));
    const input = screen.getByPlaceholderText(
      /kumiko\.list\.search-placeholder|suchen/i,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ab" } });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    rerender(tree("ab"));
    rerender(tree("other"));
    expect(input.value).toBe("other");
    rerender(tree("ab"));
    expect(input.value).toBe("ab");
  });

  test("Echo eines älteren Emits nach einem neueren Emit überschreibt die Eingabe nicht", () => {
    const onSearchChange = mock();
    const tree = (searchValue: string) => (
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
        <PrimitivesProvider value={defaultPrimitives}>
          <RenderList
            screen={screenDef}
            entity={entity}
            rows={[]}
            featureName="t"
            searchable
            searchValue={searchValue}
            onSearchChange={onSearchChange}
          />
        </PrimitivesProvider>
      </LocaleProvider>
    );
    const { rerender } = render(tree(""));
    const input = screen.getByPlaceholderText(
      /kumiko\.list\.search-placeholder|suchen/i,
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "a" } });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    fireEvent.change(input, { target: { value: "ab" } });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onSearchChange.mock.calls).toEqual([["a"], ["ab"]]);

    // The router answers the first emit only after the second one went out.
    rerender(tree("a"));
    expect(input.value).toBe("ab");
    rerender(tree("ab"));
    expect(input.value).toBe("ab");
  });
});
