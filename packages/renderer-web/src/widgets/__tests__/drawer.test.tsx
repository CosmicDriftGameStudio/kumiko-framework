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

  describe("resize", () => {
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
