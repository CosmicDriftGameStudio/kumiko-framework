import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "../../__tests__/test-utils";
import { Drawer } from "../drawer";

describe("Drawer", () => {
  test("rendert Titel + Inhalt wenn open", () => {
    render(
      <Drawer open={true} onOpenChange={() => {}} title="Mail" testId="drawer">
        <div>Body</div>
      </Drawer>,
    );
    expect(screen.getByText("Mail")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
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

    test("false: kein Close-Button, Titel und Maximieren bleiben", () => {
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

    test("default: keine Blur, 20% Abdunklung", () => {
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

    test("backdrop={{ dimPercent: 0 }}: keine Abdunklung", () => {
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

    test("clamps an out-of-range defaultWidthPx on initial render, before any interaction (fw#1965)", () => {
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
    test("Startbreite folgt max(600px, 37.5vw) wenn resize.defaultWidthPx fehlt", () => {
      withViewportWidth(1920, () => {
        render(
          <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
            <div>Body</div>
          </Drawer>,
        );
        expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("720");
      });
    });

    test("Startbreite clamped auf effectiveMaxWidthPx wenn 37.5vw ueber MAX_WIDTH_PX hinauslaeuft", () => {
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

    test("resize.defaultWidthPx wird ebenfalls gegen effectiveMaxWidthPx geclamped", () => {
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

    test("Startbreite clamped auf 600px Minimum bei schmalem Viewport", () => {
      withViewportWidth(800, () => {
        render(
          <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
            <div>Body</div>
          </Drawer>,
        );
        expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("600");
      });
    });

    test("resize.defaultWidthPx schlägt die Viewport-Formel", () => {
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

    test("PointerDown on the handle locks text selection, PointerUp restores it (fw#1965)", () => {
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
});
