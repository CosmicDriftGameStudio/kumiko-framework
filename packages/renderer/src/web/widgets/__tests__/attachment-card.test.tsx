import { describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { AttachmentCard } from "../attachment-card.tsx";

describe("AttachmentCard", () => {
  test("shows name and meta", () => {
    render(<AttachmentCard name="vertrag.pdf" meta="PDF, 4 Seiten" kind="pdf" testId="card" />);
    expect(screen.getByText("vertrag.pdf")).toBeTruthy();
    expect(screen.getByText("PDF, 4 Seiten")).toBeTruthy();
  });

  test("href renders a new-tab anchor", () => {
    render(<AttachmentCard name="a.pdf" href="/files/a.pdf" />);
    const link = screen.getByText("View original");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/files/a.pdf");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  test("onOpen without href renders a button that calls it", () => {
    const onOpen = mock(() => {});
    render(<AttachmentCard name="a.pdf" onOpen={onOpen} />);
    const button = screen.getByText("View original");
    expect(button.tagName).toBe("BUTTON");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("thumbnailUrl renders an image, otherwise the kind icon", () => {
    const { container, rerender } = render(
      <AttachmentCard name="a.jpg" kind="image" thumbnailUrl="/t.png" />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/t.png");
    rerender(<AttachmentCard name="a.jpg" kind="image" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
