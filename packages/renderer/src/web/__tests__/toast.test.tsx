// ToastProvider + useToast contract: toast() renders Title and Description in
// a Radix toast; multiple toasts stack; variant=bad applies the
// StatusTone class; useToast outside the provider is a no-op (no crash);
// IDs remain collision-free for two calls in the same tick (counter race).

import { describe, expect, test } from "bun:test";
import { act, fireEvent, screen } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { type ToastOptions, ToastProvider, useToast } from "../primitives/toast.tsx";
import { render } from "./test-utils.tsx";

// Component that calls toast() on mount. This tests the hook without a
// userEvent click path or fragile timers.
function ToastTrigger({ options }: { readonly options: readonly ToastOptions[] }): ReactNode {
  const { toast } = useToast();
  useEffect(() => {
    for (const o of options) toast(o);
    // toast() is memoized in the ToastApi, preventing re-trigger loops.
  }, [toast, options]);
  return null;
}

describe("ToastProvider + useToast", () => {
  test("toast() pushed Title und Description in den Viewport", () => {
    render(
      <ToastProvider>
        <ToastTrigger options={[{ title: "Saved", description: "Changes applied" }]} />
      </ToastProvider>,
    );
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("Changes applied")).toBeTruthy();
  });

  test("toast() ohne description rendert nur den Title", () => {
    render(
      <ToastProvider>
        <ToastTrigger options={[{ title: "Copied" }]} />
      </ToastProvider>,
    );
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  test("docsUrl: rendert Learn-more-Link (i18n-Default) mit target=_blank", () => {
    render(
      <ToastProvider>
        <ToastTrigger
          options={[
            {
              title: "Konflikt",
              variant: "bad",
              docsUrl: "https://docs.kumiko.rocks/errors/stale_state",
            },
          ]}
        />
      </ToastProvider>,
    );
    const link = screen.getByRole("link", { name: /Learn more/i });
    expect(link.getAttribute("href")).toBe("https://docs.kumiko.rocks/errors/stale_state");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  test("docsLinkLabel override: nutzt vom Caller gegebenen Text", () => {
    render(
      <ToastProvider>
        <ToastTrigger
          options={[
            {
              title: "Conflict",
              docsUrl: "https://docs.kumiko.rocks/errors/stale_state",
              docsLinkLabel: "Learn more",
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole("link", { name: /Learn more/i })).toBeTruthy();
  });

  test("ohne docsUrl: kein Link gerendert", () => {
    render(
      <ToastProvider>
        <ToastTrigger options={[{ title: "Saved", description: "ok" }]} />
      </ToastProvider>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("variant=bad: setzt die status-bad StatusTone-Klasse auf den Root", () => {
    render(
      <ToastProvider>
        <ToastTrigger options={[{ title: "Failed", variant: "bad" }]} />
      </ToastProvider>,
    );
    // Class mapping is the public contract with Tailwind tokens. Find the
    // nearest ancestor of the title node whose class string contains
    // "status-bad": Radix-Toast.Root renders an <li>, but the exact role
    // varies with priority/type.
    let node: HTMLElement | null = screen.getByText("Failed");
    while (node !== null && !node.className.includes("status-bad")) {
      node = node.parentElement;
    }
    expect(node).not.toBeNull();
  });

  test("zwei toasts: beide Entries sind im DOM (Stacking)", () => {
    render(
      <ToastProvider>
        <ToastTrigger options={[{ title: "First" }, { title: "Second" }]} />
      </ToastProvider>,
    );
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  test("zwei toasts im selben Tick: getrennte React-keys (Counter-Race-Regression)", () => {
    // Previously, ToastProvider used a useState counter whose closure capture
    // caused double calls to see the same value, producing identical IDs
    // and React-key collisions (warning and UI glitch). The fix uses
    // useRef. The test verifies that two toasts do not log a "duplicate key"
    // error through console.error.
    const errors: string[] = [];
    /* biome-ignore lint/suspicious/noConsole: test spy for React's duplicate-key warning, which is reported only through console.error */
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      errors.push(args.map(String).join(" "));
    };
    try {
      render(
        <ToastProvider>
          <ToastTrigger options={[{ title: "A" }, { title: "B" }]} />
        </ToastProvider>,
      );
      const dup = errors.filter((e) => /duplicate key|Encountered two children/i.test(e));
      expect(dup).toEqual([]);
    } finally {
      console.error = original;
    }
  });

  test("useToast außerhalb des Providers: no-op, kein Crash", () => {
    // Component that uses useToast but is not mounted inside <ToastProvider>,
    // such as a test without a provider or a pre-mount code path.
    // It must render without throwing.
    function Outside(): ReactNode {
      const { toast } = useToast();
      return (
        <button type="button" onClick={() => toast({ title: "Stub" })}>
          trigger
        </button>
      );
    }
    render(<Outside />);
    // Clicking calls toast() and should complete without producing an effect.
    act(() => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.queryByText("Stub")).toBeNull();
  });
  test("requestId: zeigt die Fehler-ID und Kopieren schreibt sie in die Zwischenablage", async () => {
    const written: string[] = [];
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    try {
      render(
        <ToastProvider>
          <ToastTrigger
            options={[{ title: "Failed", variant: "bad", requestId: "req-1234-abcd" }]}
          />
        </ToastProvider>,
      );
      expect(screen.getByTestId("toast-error-reference").textContent).toContain(
        "Error ID: req-1234-abcd",
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId("toast-error-reference-copy"));
      });
      expect(written).toEqual(["req-1234-abcd"]);
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
  });

  test("ohne requestId bleibt der Toast ohne Fehler-ID-Zeile", () => {
    render(
      <ToastProvider>
        <ToastTrigger options={[{ title: "Failed", variant: "bad" }]} />
      </ToastProvider>,
    );
    expect(screen.queryByTestId("toast-error-reference")).toBeNull();
  });
});
