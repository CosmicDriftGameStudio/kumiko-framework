import { describe, expect, test } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  type ScreenFocus,
  ScreenFocusProvider,
  useScreenFocus,
  useSetScreenFocus,
} from "../../index.ts";

function Reporter({ focus }: { readonly focus: ScreenFocus | null }): ReactNode {
  useSetScreenFocus(focus);
  return null;
}

function Reader(): ReactNode {
  const focus = useScreenFocus();
  return <output data-testid="focus">{focus === null ? "none" : JSON.stringify(focus)}</output>;
}

const renderCount = { value: 0 };

function CountingReader(): ReactNode {
  renderCount.value += 1;
  return <Reader />;
}

const first: ScreenFocus = {
  entityName: "template-resource",
  recordId: "r1",
  label: "Invoice",
  facts: { slug: "invoice" },
};

describe("screen focus", () => {
  test("is none by default", () => {
    render(
      <ScreenFocusProvider>
        <Reader />
      </ScreenFocusProvider>,
    );
    expect(screen.getByTestId("focus").textContent).toBe("none");
  });

  test("a screen sets, updates and on unmount clears the focus", () => {
    const view = render(
      <ScreenFocusProvider>
        <Reporter focus={first} />
        <Reader />
      </ScreenFocusProvider>,
    );
    expect(screen.getByTestId("focus").textContent).toBe(JSON.stringify(first));

    const second: ScreenFocus = { ...first, recordId: "r2", label: "Offer" };
    act(() => {
      view.rerender(
        <ScreenFocusProvider>
          <Reporter focus={second} />
          <Reader />
        </ScreenFocusProvider>,
      );
    });
    expect(screen.getByTestId("focus").textContent).toBe(JSON.stringify(second));

    act(() => {
      view.rerender(
        <ScreenFocusProvider>
          <Reader />
        </ScreenFocusProvider>,
      );
    });
    expect(screen.getByTestId("focus").textContent).toBe("none");
  });

  test("unmounting one of two reporters keeps the focus the other one holds", () => {
    const second: ScreenFocus = { ...first, recordId: "r2", label: "Offer" };
    const view = render(
      <ScreenFocusProvider>
        <Reporter key="a" focus={first} />
        <Reporter key="b" focus={second} />
        <Reader />
      </ScreenFocusProvider>,
    );
    expect(screen.getByTestId("focus").textContent).toBe(JSON.stringify(second));

    act(() => {
      view.rerender(
        <ScreenFocusProvider>
          <Reporter key="b" focus={second} />
          <Reader />
        </ScreenFocusProvider>,
      );
    });
    expect(screen.getByTestId("focus").textContent).toBe(JSON.stringify(second));
  });

  test("a fresh but equal focus object does not loop re-renders", () => {
    renderCount.value = 0;
    const view = render(
      <ScreenFocusProvider>
        <Reporter focus={{ ...first }} />
        <CountingReader />
      </ScreenFocusProvider>,
    );
    const before = renderCount.value;
    view.rerender(
      <ScreenFocusProvider>
        <Reporter focus={{ ...first }} />
        <CountingReader />
      </ScreenFocusProvider>,
    );
    expect(renderCount.value - before).toBeLessThanOrEqual(1);
  });
});
