import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { defaultPrimitives } from "../primitives/index.js";
import { render, screen } from "./test-utils.js";

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

describe("Lightbox navigation", () => {
  const images = [
    { src: "/a.png", alt: "First" },
    { src: "/b.png", alt: "Second" },
    { src: "/c.png", alt: "Third" },
  ];

  function renderGallery(index: number, onIndexChange = mock()) {
    render(
      <Lightbox
        open
        onOpenChange={() => undefined}
        images={images}
        index={index}
        onIndexChange={onIndexChange}
        testId="lb-nav"
      />,
    );
    return onIndexChange;
  }

  test("shows the current image and a position counter", () => {
    renderGallery(1);
    expect(screen.getByRole("img", { name: "Second" }).getAttribute("src")).toBe("/b.png");
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  test("next click advances the index", async () => {
    const onIndexChange = renderGallery(0);
    await userEvent.setup().click(screen.getByLabelText("Next image"));
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  test("previous at the first image wraps to the last", async () => {
    const onIndexChange = renderGallery(0);
    await userEvent.setup().click(screen.getByLabelText("Previous image"));
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  test("next at the last image wraps to the first", async () => {
    const onIndexChange = renderGallery(2);
    await userEvent.setup().click(screen.getByLabelText("Next image"));
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  test("ArrowRight and ArrowLeft navigate like the buttons", async () => {
    const user = userEvent.setup();
    const onIndexChange = renderGallery(0);
    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
  });

  test("an out-of-range index is clamped when rendering", () => {
    renderGallery(9);
    expect(screen.getByRole("img", { name: "Third" })).toBeTruthy();
  });

  test("a single image shows no navigation", () => {
    render(
      <Lightbox
        open
        onOpenChange={() => undefined}
        images={images.slice(0, 1)}
        index={0}
        onIndexChange={() => undefined}
      />,
    );
    expect(screen.queryByLabelText("Next image")).toBeNull();
    expect(screen.queryByLabelText("Previous image")).toBeNull();
    expect(screen.queryByText("1 / 1")).toBeNull();
  });
});

describe("Lightbox actions and position", () => {
  const images = [
    { src: "/a.png", alt: "First" },
    { src: "/b.png", alt: "Second" },
  ];

  test("actions render next to the image and receive clicks", async () => {
    const onDownload = mock();
    render(
      <Lightbox
        open
        onOpenChange={() => undefined}
        images={images}
        index={1}
        onIndexChange={() => undefined}
        actions={
          <button type="button" onClick={() => onDownload(images[1]?.src)}>
            Download
          </button>
        }
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Download" }));
    expect(onDownload).toHaveBeenCalledWith("/b.png");
  });

  test("the single-image form takes actions too", () => {
    render(
      <Lightbox
        open
        onOpenChange={() => undefined}
        src="/demo.png"
        alt="Preview"
        actions={<a href="/demo.png">Download</a>}
      />,
    );
    expect(screen.getByRole("link", { name: "Download" })).toBeTruthy();
  });

  test("showPosition={false} hides the counter but keeps the navigation", () => {
    render(
      <Lightbox
        open
        onOpenChange={() => undefined}
        images={images}
        index={0}
        onIndexChange={() => undefined}
        showPosition={false}
      />,
    );
    expect(screen.queryByText("1 / 2")).toBeNull();
    expect(screen.getByLabelText("Next image")).toBeTruthy();
  });
});
