import { describe, expect, mock, test } from "bun:test";
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
    test("Startbreite folgt max(520px, 25vw) wenn resize.defaultWidthPx fehlt", () => {
      const originalInnerWidth = window.innerWidth;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 3000,
      });
      try {
        render(
          <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
            <div>Body</div>
          </Drawer>,
        );
        expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("750");
      } finally {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          writable: true,
          value: originalInnerWidth,
        });
      }
    });

    test("Startbreite clamped auf effectiveMaxWidthPx wenn 25vw ueber MAX_WIDTH_PX hinauslaeuft", () => {
      const originalInnerWidth = window.innerWidth;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 8000,
      });
      try {
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
      } finally {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          writable: true,
          value: originalInnerWidth,
        });
      }
    });

    test("resize.defaultWidthPx wird ebenfalls gegen effectiveMaxWidthPx geclamped", () => {
      const originalInnerWidth = window.innerWidth;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 2000,
      });
      try {
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
      } finally {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          writable: true,
          value: originalInnerWidth,
        });
      }
    });

    test("Startbreite clamped auf 520px Minimum bei schmalem Viewport", () => {
      const originalInnerWidth = window.innerWidth;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 800,
      });
      try {
        render(
          <Drawer open={true} onOpenChange={() => {}} side="right" testId="drawer" resize={{}}>
            <div>Body</div>
          </Drawer>,
        );
        expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("520");
      } finally {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          writable: true,
          value: originalInnerWidth,
        });
      }
    });

    test("resize.defaultWidthPx schlägt die Viewport-Formel", () => {
      const originalInnerWidth = window.innerWidth;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: 3000,
      });
      try {
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
      } finally {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          writable: true,
          value: originalInnerWidth,
        });
      }
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
});
