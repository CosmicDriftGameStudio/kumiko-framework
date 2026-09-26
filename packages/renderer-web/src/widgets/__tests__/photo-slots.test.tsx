import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "../../__tests__/test-utils";
import { type PhotoSlotSpec, PhotoSlots } from "../photo-slots";
import { UploadZone } from "../upload-zone";

function pick(input: HTMLElement, files: readonly File[]): void {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

const SLOTS: readonly PhotoSlotSpec[] = [
  { id: "front", label: "Front schräg", previewUrl: "blob:front", badge: "Titelbild" },
  { id: "side", label: "Seite" },
  { id: "interior", label: "Innenraum" },
];

describe("PhotoSlots", () => {
  test("a filled slot shows its thumbnail and badge, an empty slot its shot label and hint", () => {
    render(
      <PhotoSlots
        slots={SLOTS}
        onUpload={async () => {}}
        pickHint="Kamera oder Galerie"
        testId="photos"
      />,
    );
    const front = screen.getByTestId("photos-slot-front");
    expect(front.getAttribute("data-filled")).toBe("true");
    expect(screen.getByRole("img", { name: "Front schräg" }).getAttribute("src")).toBe(
      "blob:front",
    );
    expect(front.textContent).toContain("Titelbild");

    const side = screen.getByTestId("photos-slot-side");
    expect(side.getAttribute("data-filled")).toBeNull();
    expect(side.textContent).toContain("Seite");
    expect(side.textContent).toContain("Kamera oder Galerie");
  });

  test("the first slot spans the full row by default", () => {
    render(<PhotoSlots slots={SLOTS} onUpload={async () => {}} testId="photos" />);
    expect(screen.getByTestId("photos-slot-front").parentElement?.className).toContain(
      "col-span-2",
    );
    expect(screen.getByTestId("photos-slot-side").parentElement?.className).not.toContain(
      "col-span-2",
    );
  });

  test("picking a photo uploads it for exactly that slot", async () => {
    const onUpload = mock(async (_slotId: string, _file: File) => {});
    render(<PhotoSlots slots={SLOTS} onUpload={onUpload} testId="photos" />);
    const photo = new File(["jpeg"], "side.jpg", { type: "image/jpeg" });

    pick(screen.getByTestId("photos-slot-side-input"), [photo]);

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload.mock.calls[0]?.[0]).toBe("side");
    expect(onUpload.mock.calls[0]?.[1]?.name).toBe("side.jpg");
  });

  test("a failed upload shows the error under that slot only", async () => {
    render(
      <PhotoSlots
        slots={SLOTS}
        onUpload={async () => {
          throw new Error("photo_limit_reached");
        }}
        testId="photos"
      />,
    );
    pick(screen.getByTestId("photos-slot-interior-input"), [
      new File(["jpeg"], "in.jpg", { type: "image/jpeg" }),
    ]);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("photo_limit_reached");
    expect(screen.getByTestId("photos-slot-interior").parentElement?.contains(alert)).toBe(true);
  });

  test("a non-image file is rejected before any upload", async () => {
    const onUpload = mock(async () => {});
    render(<PhotoSlots slots={SLOTS} onUpload={onUpload} testId="photos" />);
    pick(screen.getByTestId("photos-slot-side-input"), [
      new File(["pdf"], "doc.pdf", { type: "application/pdf" }),
    ]);

    expect((await screen.findByRole("alert")).textContent).toBe("File type not allowed");
    expect(onUpload).not.toHaveBeenCalled();
  });

  test("capture is forwarded only when set, so the gallery stays available by default", () => {
    const { rerender } = render(
      <PhotoSlots slots={SLOTS} onUpload={async () => {}} testId="photos" />,
    );
    expect(screen.getByTestId("photos-slot-side-input").hasAttribute("capture")).toBe(false);
    rerender(
      <PhotoSlots slots={SLOTS} onUpload={async () => {}} capture="environment" testId="photos" />,
    );
    expect(screen.getByTestId("photos-slot-side-input").getAttribute("capture")).toBe(
      "environment",
    );
  });
});

describe("UploadZone capture", () => {
  test("forwards capture to the file input", () => {
    render(
      <UploadZone title="Fotos" onUpload={async () => {}} capture="environment" testId="zone" />,
    );
    expect(screen.getByTestId("zone-input").getAttribute("capture")).toBe("environment");
  });
});
