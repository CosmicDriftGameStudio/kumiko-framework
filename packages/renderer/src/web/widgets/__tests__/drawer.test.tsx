import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "../../__tests__/test-utils.tsx";
import { Drawer } from "../drawer.tsx";

describe("Drawer", () => {
  test("renders title + content when open", () => {
    render(
      <Drawer open={true} onOpenChange={() => {}} title="Mail" testId="drawer">
        <div>Body</div>
      </Drawer>,
    );
    expect(screen.getByText("Mail")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
  });

  test("footer wraps (flex-wrap) so many actions do not run past the panel edge", () => {
    render(
      <Drawer
        open={true}
        onOpenChange={() => {}}
        title="Mail"
        footer={<button type="button">Save</button>}
      >
        <div>Body</div>
      </Drawer>,
    );
    const footer = screen
      .getByRole("button", { name: "Save" })
      .closest('[data-slot="sheet-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.className).toContain("flex-wrap");
  });

  test("open=false rendert nichts", () => {
    render(
      <Drawer open={false} onOpenChange={() => {}} title="Mail">
        <div>Body</div>
      </Drawer>,
    );
    expect(screen.queryByText("Body")).toBeNull();
  });

  test("Escape ruft onOpenChange(false)", () => {
    const onOpenChange = mock((_open: boolean) => {});
    render(
      <Drawer open={true} onOpenChange={onOpenChange} title="Mail" testId="drawer">
        <div>Body</div>
      </Drawer>,
    );
    fireEvent.keyDown(screen.getByTestId("drawer"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe("showCloseButton", () => {
    test("default true: Close-Button im Header vorhanden", () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} title="Mail" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    });

    test("false: no Close button, title and maximize remain", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          title="Mail"
          testId="drawer"
          showCloseButton={false}
          resize={{}}
        >
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
      expect(screen.getByText("Mail")).toBeTruthy();
      expect(screen.getByRole("button", { name: /maximize drawer width/i })).toBeTruthy();
    });
  });

  describe("backdrop", () => {
    function getOverlay(): HTMLElement {
      const overlay = document.querySelector('[data-slot="sheet-overlay"]');
      if (overlay === null) throw new Error("sheet-overlay not found");
      return overlay as HTMLElement;
    }

    test("default: no blur, 20% dimming", () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} title="Mail" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      const overlay = getOverlay();
      expect(overlay.style.backdropFilter).toBe("");
      expect(overlay.style.backgroundColor).toBe("rgb(0 0 0 / 20%)");
    });

    test("backdrop={{ blurPx: 4 }}: backdrop-filter blur(4px)", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          title="Mail"
          testId="drawer"
          backdrop={{ blurPx: 4 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      expect(getOverlay().style.backdropFilter).toBe("blur(4px)");
    });

    test("backdrop={{ dimPercent: 0 }}: no dimming", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          title="Mail"
          testId="drawer"
          backdrop={{ dimPercent: 0 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      expect(getOverlay().style.backgroundColor).toBe("rgb(0 0 0 / 0%)");
    });
  });

  describe("variant", () => {
    test("default (no variant prop): flush against the right edge, full height, no radius, default width", () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("inset-y-0");
      expect(content.className).toContain("right-0");
      expect(content.className).toContain("border-l");
      expect(content.className).not.toContain("rounded-[2rem]");
      expect(content.className).toContain("w-[max(600px,37.5vw)]");
    });

    test('variant="floating": detached panel with margin and radius', () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" variant="floating" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("inset-y-8");
      expect(content.className).toContain("right-8");
      expect(content.className).toContain("rounded-[2rem]");
    });

    test('variant="flush" with side="right": inset-y-0, no radius, border-l only', () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" variant="flush" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("inset-y-0");
      expect(content.className).not.toContain("rounded-[2rem]");
      expect(content.className).not.toContain("inset-y-8");
      expect(content.className).toContain("border-l");
      expect(content.className).not.toContain("border-r");
    });

    test('variant="flush" with side="left": border-r only', () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="left" variant="flush" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("border-r");
      expect(content.className).not.toContain("border-l");
    });
  });

  describe("belowHeader", () => {
    test("default (false): variant=flush keeps inset-y-0 + h-full, no header offset", () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" variant="flush" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("inset-y-0");
      expect(content.className).toContain("h-full");
      expect(content.style.top).toBe("");
    });

    test("true + variant=flush + side=right: offsets top by the header var via inline style, sticks to bottom, swaps h-full for h-auto", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          variant="flush"
          belowHeader
          testId="drawer"
        >
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.style.top).toBe("var(--shell-header-height)");
      expect(content.style.bottom).toBe("0px");
      expect(content.className).toContain("inset-y-0");
      expect(content.className).not.toContain("h-full");
      expect(content.className).toContain("h-auto");
    });

    test("true + variant=flush + side=left: same h-full-to-h-auto swap as side=right", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="left"
          variant="flush"
          belowHeader
          testId="drawer"
        >
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.style.top).toBe("var(--shell-header-height)");
      expect(content.style.bottom).toBe("0px");
      expect(content.className).not.toContain("h-full");
      expect(content.className).toContain("h-auto");
    });

    test("true + variant=flush + side=top: top offset instead of top-0", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="top"
          variant="flush"
          belowHeader
          testId="drawer"
        >
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("top-(--shell-header-height)");
      expect(content.className).not.toContain("top-0");
    });

    test("true + variant=flush + side=bottom: unaffected (still bottom-anchored)", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="bottom"
          variant="flush"
          belowHeader
          testId="drawer"
        >
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.getByTestId("drawer").className).toContain("bottom-0");
      expect(screen.getByTestId("drawer").className).not.toContain("--shell-header-height");
    });

    test("true + variant=floating: ignored, floating classes unchanged", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          variant="floating"
          belowHeader
          testId="drawer"
        >
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("inset-y-8");
      expect(content.className).not.toContain("--shell-header-height");
    });
  });

  describe("width", () => {
    test("width={420}: reflected as inline pixel width", () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" width={420} testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.getByTestId("drawer").style.width).toBe("420px");
      expect(screen.getByTestId("drawer").style.maxWidth).toBe("85vw");
    });

    test('width="30rem": reflected as-is (CSS length string)', () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" width="30rem" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.getByTestId("drawer").style.width).toBe("30rem");
    });

    test("no width prop: no inline width style (default stays class-driven)", () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.getByTestId("drawer").style.width).toBe("");
    });

    test('side="top": width prop is ignored', () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="top" width={420} testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.getByTestId("drawer").style.width).toBe("");
    });

    test("resize set + width set: resize wins", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          width={420}
          resize={{ defaultWidthPx: 350, minWidthPx: 300, maxWidthPx: 500 }}
          testId="drawer"
        >
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.getByTestId("drawer").style.width).toBe("350px");
    });
  });

  describe("resize", () => {
    // happy-dom exposes innerWidth as an accessor (get/set) on the window
    // instance. Object.defineProperty(...) with a plain `value` replaces
    // that accessor with a data property, permanently — later test files
    // sharing this single-process happy-dom then read a frozen, stale
    // width instead of happy-dom's real viewport state.
    // Capturing and restoring the exact original descriptor keeps the
    // accessor (or its absence) intact for every test that runs after.
    function withViewportWidth(px: number, run: () => void): void {
      const originalDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: px,
      });
      try {
        run();
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(window, "innerWidth", originalDescriptor);
        } else {
          delete (window as unknown as { innerWidth?: number }).innerWidth;
        }
      }
    }

    test("clamps an out-of-range defaultWidthPx on initial render, before any interaction", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          testId="drawer"
          resize={{ defaultWidthPx: 1200, minWidthPx: 300, maxWidthPx: 800 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("800");
    });
    test("Initial width follows max(600px, 37.5vw) when resize.defaultWidthPx is missing", () => {
      withViewportWidth(1920, () => {
        render(
          <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
            <div>Body</div>
          </Drawer>,
        );
        expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("720");
      });
    });

    test("Initial width is clamped to effectiveMaxWidthPx when 37.5vw exceeds MAX_WIDTH_PX", () => {
      withViewportWidth(8000, () => {
        render(
          <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
            <div>Body</div>
          </Drawer>,
        );
        const handle = screen.getByRole("separator");
        const valueNow = Number(handle.getAttribute("aria-valuenow"));
        const valueMax = Number(handle.getAttribute("aria-valuemax"));
        expect(valueMax).toBe(1000);
        expect(valueNow).toBe(valueMax);
        expect(valueNow).toBeLessThanOrEqual(valueMax);
      });
    });

    test("resize.defaultWidthPx is also clamped against effectiveMaxWidthPx", () => {
      withViewportWidth(2000, () => {
        render(
          <Drawer
            open={true}
            onOpenChange={() => {}}
            side="right"
            testId="drawer"
            resize={{ defaultWidthPx: 5000 }}
          >
            <div>Body</div>
          </Drawer>,
        );
        expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("1000");
      });
    });

    test("Initial width is clamped to a 600px minimum on a narrow viewport", () => {
      withViewportWidth(800, () => {
        render(
          <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
            <div>Body</div>
          </Drawer>,
        );
        expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("600");
      });
    });

    test("resize.defaultWidthPx takes precedence over the viewport formula", () => {
      withViewportWidth(3000, () => {
        render(
          <Drawer
            open={true}
            onOpenChange={() => {}}
            side="right"
            testId="drawer"
            resize={{ defaultWidthPx: 600 }}
          >
            <div>Body</div>
          </Drawer>,
        );
        expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("600");
      });
    });

    test("side='right': ArrowLeft grows, ArrowRight shrinks", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          testId="drawer"
          resize={{ defaultWidthPx: 400, minWidthPx: 300, maxWidthPx: 500 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      const handle = screen.getByRole("separator");
      expect(handle.getAttribute("aria-valuenow")).toBe("400");
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      expect(handle.getAttribute("aria-valuenow")).toBe("416");
      fireEvent.keyDown(handle, { key: "ArrowRight" });
      expect(handle.getAttribute("aria-valuenow")).toBe("400");
    });

    test("side='left': ArrowRight grows, ArrowLeft shrinks (direction mirrored)", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="left"
          testId="drawer"
          resize={{ defaultWidthPx: 400, minWidthPx: 300, maxWidthPx: 500 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      const handle = screen.getByRole("separator");
      fireEvent.keyDown(handle, { key: "ArrowRight" });
      expect(handle.getAttribute("aria-valuenow")).toBe("416");
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      expect(handle.getAttribute("aria-valuenow")).toBe("400");
    });

    test("clamps growth at maxWidthPx and shrink at minWidthPx (shift = 40px step)", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          testId="drawer"
          resize={{ defaultWidthPx: 490, minWidthPx: 300, maxWidthPx: 500 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      const handle = screen.getByRole("separator");
      fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
      expect(handle.getAttribute("aria-valuenow")).toBe("500");
      for (let i = 0; i < 20; i++) {
        fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
      }
      expect(handle.getAttribute("aria-valuenow")).toBe("300");
    });

    test("maximize toggle switches aria-pressed and expands to maxWidthPx", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          testId="drawer"
          resize={{ defaultWidthPx: 400, minWidthPx: 300, maxWidthPx: 500 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      const maximizeButton = screen.getByRole("button", { name: /maximize drawer width/i });
      expect(maximizeButton.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(maximizeButton);
      expect(maximizeButton.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("500");
      fireEvent.click(maximizeButton);
      expect(maximizeButton.getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("400");
    });

    test("arrow key after maximize resizes from the maximized width, not the pre-maximize width", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          testId="drawer"
          resize={{ defaultWidthPx: 400, minWidthPx: 300, maxWidthPx: 500 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      const maximizeButton = screen.getByRole("button", { name: /maximize drawer width/i });
      fireEvent.click(maximizeButton);
      expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("500");

      const handle = screen.getByRole("separator");
      fireEvent.keyDown(handle, { key: "ArrowRight" });
      // Shrinking from the visible 500px maximized width, not from the
      // stale 400px `width` state that was never updated while maximized.
      expect(handle.getAttribute("aria-valuenow")).toBe("484");
    });

    test("PointerDown on the handle locks text selection, PointerUp restores it", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          testId="drawer"
          resize={{ defaultWidthPx: 400, minWidthPx: 300, maxWidthPx: 500 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      const handle = screen.getByRole("separator");
      expect(document.body.style.userSelect).toBe("");

      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
      expect(document.body.style.userSelect).toBe("none");

      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 });
      expect(document.body.style.userSelect).toBe("");
    });

    test("side='top' with resize set: no resize handle, no maximize button (vertical drawers can't resize)", () => {
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="top"
          testId="drawer"
          resize={{ defaultWidthPx: 400 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.queryByRole("separator")).toBeNull();
      expect(screen.queryByRole("button", { name: /maximize drawer width/i })).toBeNull();
    });

    test("resize prop omitted: no resize handle, no maximize button", () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.queryByRole("separator")).toBeNull();
      expect(screen.queryByRole("button", { name: /maximize drawer width/i })).toBeNull();
    });
  });

  describe("narrow viewport", () => {
    // matchMedia is set via Object.defineProperty on window, same leak trap
    // as innerWidth above (resize describe): without restoring the original
    // descriptor in afterEach, the mock survives into the next test file's
    // happy-dom instance and corrupts unrelated tests there.
    let originalDescriptor: PropertyDescriptor | undefined;

    function mockMatchMedia(matches: boolean): void {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: (query: string) => ({
          matches,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      });
    }

    beforeEach(() => {
      originalDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
    });

    afterEach(() => {
      if (originalDescriptor) {
        Object.defineProperty(window, "matchMedia", originalDescriptor);
      } else {
        delete (window as unknown as { matchMedia?: unknown }).matchMedia;
      }
    });

    test("narrow: full-screen classes replace the floating panel treatment", () => {
      mockMatchMedia(true);
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("inset-0");
      expect(content.className).toContain("w-full");
      expect(content.className).not.toContain("rounded-[2rem]");
      expect(content.className).not.toContain("inset-y-8");
    });

    test('narrow with variant="flush": fullscreen branch unaffected, no inline width', () => {
      mockMatchMedia(true);
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          variant="flush"
          width={420}
          testId="drawer"
        >
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("inset-0");
      expect(content.className).toContain("w-full");
      expect(content.className).not.toContain("rounded-[2rem]");
      expect(content.className).not.toContain("inset-y-8");
      expect(content.className).not.toContain("border-l");
      expect(content.style.width).toBe("");
    });

    test("narrow with resize set: no inline width style", () => {
      mockMatchMedia(true);
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.getByTestId("drawer").style.width).toBe("");
    });

    test("narrow: resize handle is not rendered", () => {
      mockMatchMedia(true);
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.queryByRole("separator")).toBeNull();
    });

    test("narrow: maximize button is not rendered", () => {
      mockMatchMedia(true);
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
          <div>Body</div>
        </Drawer>,
      );
      expect(screen.queryByRole("button", { name: /maximize drawer width/i })).toBeNull();
    });

    test("narrow with belowHeader: fullscreen branch unaffected (already covers the header)", () => {
      mockMatchMedia(true);
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          variant="flush"
          belowHeader
          testId="drawer"
        >
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.className).toContain("inset-0");
      expect(content.className).not.toContain("--shell-header-height");
    });

    test("wide (regression clamp): inline width and handle still present with resize set", () => {
      mockMatchMedia(false);
      render(
        <Drawer
          open={true}
          onOpenChange={() => {}}
          side="right"
          testId="drawer"
          resize={{ defaultWidthPx: 400, minWidthPx: 300, maxWidthPx: 500 }}
        >
          <div>Body</div>
        </Drawer>,
      );
      const content = screen.getByTestId("drawer");
      expect(content.style.width).toBe("400px");
      expect(screen.getByRole("separator")).toBeTruthy();
    });
  });

  describe("modal", () => {
    function queryOverlay(): Element | null {
      return document.querySelector('[data-slot="sheet-overlay"]');
    }

    // Two Radix details make the naive version silently pass: the outside-
    // pointerdown listener is registered inside a setTimeout(0), and a
    // left-button pointerdown only arms the dismissal — the following click
    // fires it. Without both, no outside click would ever dismiss and the
    // modal={false} assertion would hold for the wrong reason.
    async function clickOutside(): Promise<void> {
      const pageBehind = document.createElement("div");
      document.body.appendChild(pageBehind);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        fireEvent.pointerDown(pageBehind);
        fireEvent.click(pageBehind);
      });
      pageBehind.remove();
    }

    test("default (no modal prop): overlay element present, page behind locked", () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} title="Mail" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      expect(queryOverlay()).not.toBeNull();
      expect(document.body.style.pointerEvents).toBe("none");
    });

    test("modal={false}: no overlay element, page behind stays selectable", () => {
      render(
        <Drawer open={true} onOpenChange={() => {}} title="Mail" testId="drawer" modal={false}>
          <div>Body</div>
        </Drawer>,
      );
      expect(queryOverlay()).toBeNull();
      expect(screen.getByText("Body")).toBeTruthy();
      // The overlay element is only half of it — what actually stops the
      // text behind the drawer from being selected and copied is Radix
      // locking the body's pointer events, so assert the lock is absent
      // rather than just the element.
      expect(document.body.style.pointerEvents).not.toBe("none");
    });

    test("modal={false}: Escape still closes", () => {
      const onOpenChange = mock((_open: boolean) => {});
      render(
        <Drawer open={true} onOpenChange={onOpenChange} title="Mail" testId="drawer" modal={false}>
          <div>Body</div>
        </Drawer>,
      );
      fireEvent.keyDown(screen.getByTestId("drawer"), { key: "Escape" });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    test("default: a click beside the drawer closes it", async () => {
      const onOpenChange = mock((_open: boolean) => {});
      render(
        <Drawer open={true} onOpenChange={onOpenChange} title="Mail" testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      await clickOutside();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    test("modal={false}: a click beside the drawer does NOT close it", async () => {
      const onOpenChange = mock((_open: boolean) => {});
      render(
        <Drawer open={true} onOpenChange={onOpenChange} title="Mail" testId="drawer" modal={false}>
          <div>Body</div>
        </Drawer>,
      );
      await clickOutside();
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  describe("content inset of a non-modal side drawer", () => {
    const INSET_RIGHT = "--kumiko-drawer-inset-right";
    const INSET_LEFT = "--kumiko-drawer-inset-left";
    const originals = new Map<string, PropertyDescriptor | undefined>();
    let observerCallbacks: Array<() => void> = [];

    function stub(target: object, name: string, value: unknown): void {
      originals.set(name, Object.getOwnPropertyDescriptor(target, name));
      Object.defineProperty(target, name, { configurable: true, writable: true, value });
    }

    function restore(target: object, name: string): void {
      const original = originals.get(name);
      if (original) Object.defineProperty(target, name, original);
      else delete (target as Record<string, unknown>)[name];
    }

    function mockLayout(narrow: boolean, layout: { left: number; width: number }): void {
      stub(window, "matchMedia", (query: string) => ({
        matches: narrow,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
      stub(window, "innerWidth", 1280);
      stub(HTMLElement.prototype, "offsetLeft", undefined);
      Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
        configurable: true,
        get: () => layout.left,
      });
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get: () => layout.width,
      });
    }

    beforeEach(() => {
      observerCallbacks = [];
      stub(
        globalThis,
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            observerCallbacks.push(callback);
          }
          observe(): void {}
          disconnect(): void {}
        },
      );
      originals.set(
        "offsetWidth",
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
      );
    });

    afterEach(() => {
      restore(window, "matchMedia");
      restore(window, "innerWidth");
      restore(globalThis, "ResizeObserver");
      restore(HTMLElement.prototype, "offsetLeft");
      restore(HTMLElement.prototype, "offsetWidth");
      document.documentElement.style.removeProperty(INSET_RIGHT);
      document.documentElement.style.removeProperty(INSET_LEFT);
    });

    const insetOf = (property: string): string =>
      document.documentElement.style.getPropertyValue(property);

    test("an open non-modal right drawer publishes its occupied width, closing removes it", () => {
      mockLayout(false, { left: 880, width: 400 });
      const view = render(
        <Drawer open={true} onOpenChange={() => {}} side="right" modal={false} testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      expect(insetOf(INSET_RIGHT)).toBe("400px");
      expect(insetOf(INSET_LEFT)).toBe("");

      view.rerender(
        <Drawer open={false} onOpenChange={() => {}} side="right" modal={false} testId="drawer">
          <div>Body</div>
        </Drawer>,
      );
      expect(insetOf(INSET_RIGHT)).toBe("");
    });

    test("a resize of the sheet republishes the width, unmount removes it", () => {
      const layout = { left: 880, width: 400 };
      mockLayout(false, layout);
      const view = render(
        <Drawer open={true} onOpenChange={() => {}} side="right" modal={false}>
          <div>Body</div>
        </Drawer>,
      );
      layout.left = 780;
      act(() => {
        for (const callback of observerCallbacks) callback();
      });
      expect(insetOf(INSET_RIGHT)).toBe("500px");
      view.unmount();
      expect(insetOf(INSET_RIGHT)).toBe("");
    });

    test("a left drawer publishes the left inset", () => {
      mockLayout(false, { left: 0, width: 360 });
      render(
        <Drawer open={true} onOpenChange={() => {}} side="left" modal={false}>
          <div>Body</div>
        </Drawer>,
      );
      expect(insetOf(INSET_LEFT)).toBe("360px");
      expect(insetOf(INSET_RIGHT)).toBe("");
    });

    test("a modal drawer never publishes an inset", () => {
      mockLayout(false, { left: 880, width: 400 });
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right">
          <div>Body</div>
        </Drawer>,
      );
      expect(insetOf(INSET_RIGHT)).toBe("");
    });

    test("a narrow viewport keeps overlaying and publishes no inset", () => {
      mockLayout(true, { left: 0, width: 1280 });
      render(
        <Drawer open={true} onOpenChange={() => {}} side="right" modal={false}>
          <div>Body</div>
        </Drawer>,
      );
      expect(insetOf(INSET_RIGHT)).toBe("");
    });
  });
});
