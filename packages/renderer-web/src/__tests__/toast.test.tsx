// @vitest-environment jsdom
//
// ToastProvider + useToast pinnt: toast() rendert Title+Description in
// einem Radix-Toast; mehrere toasts stapeln; Variant=destructive setzt
// die destructive-Klasse; useToast außerhalb des Providers ist no-op
// (kein crash); IDs sind kollisionsfrei auch bei zwei Calls im selben
// Tick (Counter-Race-Bug).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { describe, expect, test } from "vitest";
import { type ToastOptions, ToastProvider, useToast } from "../primitives/toast";

// Trigger-Component die im Mount toast() aufruft. So testen wir den
// Hook ohne userEvent-Klick-Pfad und ohne fragile timer.
function ToastTrigger({ options }: { readonly options: readonly ToastOptions[] }): ReactNode {
  const { toast } = useToast();
  useEffect(() => {
    for (const o of options) toast(o);
    // toast() ist in der ToastApi memoized — keine Re-Trigger-Loops.
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

  test("docsUrl: rendert 'Mehr erfahren →' Link mit target=_blank", () => {
    render(
      <ToastProvider>
        <ToastTrigger
          options={[
            {
              title: "Konflikt",
              variant: "destructive",
              docsUrl: "https://docs.kumiko.so/errors/stale_state",
            },
          ]}
        />
      </ToastProvider>,
    );
    const link = screen.getByRole("link", { name: /Mehr erfahren/i });
    expect(link.getAttribute("href")).toBe(
      "https://docs.kumiko.so/errors/stale_state",
    );
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
              docsUrl: "https://docs.kumiko.so/errors/stale_state",
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

  test("variant=destructive: setzt die destructive-Klasse auf den Root", () => {
    render(
      <ToastProvider>
        <ToastTrigger options={[{ title: "Failed", variant: "destructive" }]} />
      </ToastProvider>,
    );
    // Class-Mapping ist der Public-Vertrag mit Tailwind-Tokens. Wir
    // suchen den nearest Ancestor des Title-Knotens dessen Klassen-
    // String "destructive" enthält — Radix-Toast.Root rendert in einem
    // <li>, aber die genaue Role wechselt je nach priority/type.
    let node: HTMLElement | null = screen.getByText("Failed");
    while (node !== null && !node.className.includes("destructive")) {
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
    // Vorher hatte ToastProvider einen useState-counter, der wegen
    // Closure-Capture bei Doppel-Calls denselben Wert sah → identische
    // IDs → React-key-Kollision (Warning + UI-Glitch). Der Fix nutzt
    // useRef. Test: zwei toasts + console.error darf kein "duplicate
    // key" loggen.
    const errors: string[] = [];
    /* biome-ignore lint/suspicious/noConsole: test spy auf React's duplicate-key-Warning, die nur über console.error gemeldet wird */
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
    // Component die useToast nutzt aber NICHT in <ToastProvider> mounted
    // ist — z.B. ein Test ohne Provider, oder ein Pre-Mount-Code-Path.
    // Soll ohne Throw rendern.
    function Outside(): ReactNode {
      const { toast } = useToast();
      return (
        <button type="button" onClick={() => toast({ title: "Stub" })}>
          trigger
        </button>
      );
    }
    render(<Outside />);
    // Click feuert toast() — sollte einfach durchlaufen ohne Effekt.
    act(() => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.queryByText("Stub")).toBeNull();
  });
});
