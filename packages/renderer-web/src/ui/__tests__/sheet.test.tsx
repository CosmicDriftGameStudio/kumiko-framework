import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../__tests__/test-utils";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../sheet";

describe("Sheet", () => {
  test.each([
    ["right", "slide-in-from-right"],
    ["left", "slide-in-from-left"],
    ["top", "slide-in-from-top"],
    ["bottom", "slide-in-from-bottom"],
  ] as const)("open sheet side=%s applies side-specific slide class", (side, slideClass) => {
    render(
      <Sheet open>
        <SheetContent side={side}>
          <SheetHeader>
            <SheetTitle>Title</SheetTitle>
            <SheetDescription>Description</SheetDescription>
          </SheetHeader>
          Body
          <SheetFooter>Footer</SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    const content = document.querySelector('[data-slot="sheet-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain(slideClass);
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByText("Footer")).toBeTruthy();
    expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="sheet-header"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="sheet-footer"]')).not.toBeNull();
  });

  test("showCloseButton=true renders accessible Close control", () => {
    render(
      <Sheet open>
        <SheetContent showCloseButton>
          Content
        </SheetContent>
      </Sheet>,
    );
    const content = document.querySelector('[data-slot="sheet-content"]');
    const closeButton = content?.querySelector("button");
    expect(closeButton).not.toBeNull();
    expect(closeButton?.textContent).toContain("Close");
  });

  test("showCloseButton=false hides Close control", () => {
    render(
      <Sheet open>
        <SheetContent showCloseButton={false}>
          Content
        </SheetContent>
      </Sheet>,
    );
    const content = document.querySelector('[data-slot="sheet-content"]');
    expect(content?.querySelector("button")).toBeNull();
  });

  test("Close button calls onOpenChange(false)", async () => {
    const user = userEvent.setup();
    const onOpenChange = mock();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent>
          Content
        </SheetContent>
      </Sheet>,
    );
    const closeButton = document.querySelector('[data-slot="sheet-content"] button') as HTMLButtonElement;
    await user.click(closeButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("SheetTrigger and SheetClose render with data-slot", () => {
    render(
      <Sheet open>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent showCloseButton={false}>
          <SheetClose data-testid="sheet-dismiss">Dismiss</SheetClose>
        </SheetContent>
      </Sheet>,
    );
    expect(document.querySelector('[data-slot="sheet-trigger"]')).not.toBeNull();
    expect(screen.getByTestId("sheet-dismiss")).toBeTruthy();
    expect(document.querySelector('[data-slot="sheet-close"]')).not.toBeNull();
  });
});


