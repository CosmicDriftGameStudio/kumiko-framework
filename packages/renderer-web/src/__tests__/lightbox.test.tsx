import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { defaultPrimitives } from "../primitives";
import { render, screen } from "./test-utils";

const { Lightbox } = defaultPrimitives;

describe("Lightbox", () => {
  test("open=true renders image with src and alt", () => {
    render(
      <Lightbox
        open
        onOpenChange={() => undefined}
        src="/demo.png"
        alt="Product screenshot"
        testId="lb"
      />,
    );
    const img = screen.getByRole("img", { name: "Product screenshot" });
    expect(img.getAttribute("src")).toBe("/demo.png");
    expect(screen.getByTestId("lb")).toBeTruthy();
  });

  test("open=false renders nothing", () => {
    render(
      <Lightbox
        open={false}
        onOpenChange={() => undefined}
        src="/demo.png"
        alt="Hidden"
        testId="lb-hidden"
      />,
    );
    expect(screen.queryByTestId("lb-hidden")).toBeNull();
  });

  test("close button calls onOpenChange(false)", async () => {
    const user = userEvent.setup();
    const onOpenChange = mock();
    render(
      <Lightbox open onOpenChange={onOpenChange} src="/demo.png" alt="Preview" testId="lb-close" />,
    );
    await user.click(screen.getByLabelText("Close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
