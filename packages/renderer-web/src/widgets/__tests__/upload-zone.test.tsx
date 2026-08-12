import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "../../__tests__/test-utils";
import { UploadZone } from "../upload-zone";

function pick(input: HTMLElement, files: readonly File[]): void {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

describe("UploadZone", () => {
  test("lädt eine Datei hoch und zeigt den done-Status", async () => {
    const onUpload = mock(async () => {});
    render(<UploadZone title="Datei hochladen" onUpload={onUpload} testId="zone" />);
    const file = new File(["hi"], "report.pdf", { type: "application/pdf" });
    pick(screen.getByTestId("zone-input"), [file]);

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload).toHaveBeenCalledWith(file);
    await waitFor(() => expect(screen.getByText("report.pdf")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Uploaded")).toBeTruthy());
  });

  test("zeigt die Fehlermeldung wenn onUpload wirft", async () => {
    const onUpload = mock(async () => {
      throw new Error("too_large");
    });
    render(<UploadZone title="Datei hochladen" onUpload={onUpload} testId="zone" />);
    const file = new File(["hi"], "huge.pdf", { type: "application/pdf" });
    pick(screen.getByTestId("zone-input"), [file]);

    await waitFor(() => expect(screen.getByText("too_large")).toBeTruthy());
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  test("multiple=false nimmt nur die erste Datei", async () => {
    const onUpload = mock(async () => {});
    render(
      <UploadZone title="Datei hochladen" onUpload={onUpload} multiple={false} testId="zone" />,
    );
    const a = new File(["a"], "a.pdf");
    const b = new File(["b"], "b.pdf");
    pick(screen.getByTestId("zone-input"), [a, b]);

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload).toHaveBeenCalledWith(a);
  });

  test("resettet den Input nach dem Upload-Batch", async () => {
    const onUpload = mock(async () => {});
    render(<UploadZone title="Datei hochladen" onUpload={onUpload} testId="zone" />);
    const input = screen.getByTestId("zone-input") as HTMLInputElement;
    pick(input, [new File(["a"], "a.pdf")]);

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("");
  });

  test("gibt Bilder verkleinert an onUpload weiter (nicht die Originaldatei)", async () => {
    class FakeOffscreenCanvas {
      getContext() {
        return { drawImage: mock(() => {}) };
      }
      convertToBlob() {
        return Promise.resolve(new Blob(["resized-bytes"], { type: "image/jpeg" }));
      }
    }
    // @ts-expect-error test stub for a browser-only API missing in happy-dom
    globalThis.OffscreenCanvas = FakeOffscreenCanvas;
    globalThis.createImageBitmap = mock(async () => ({
      close: mock(() => {}),
      height: 100,
      width: 100,
    }));

    try {
      const onUpload = mock(async (_uploaded: File) => {});
      render(<UploadZone title="Datei hochladen" onUpload={onUpload} testId="zone" />);
      const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
      pick(screen.getByTestId("zone-input"), [file]);

      await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
      const [uploaded] = onUpload.mock.calls[0] ?? [];
      expect(uploaded?.size).toBe("resized-bytes".length);
      expect(uploaded?.size).not.toBe(file.size);
    } finally {
      // @ts-expect-error restore missing-API baseline
      globalThis.OffscreenCanvas = undefined;
      // @ts-expect-error restore missing-API baseline
      globalThis.createImageBitmap = undefined;
    }
  });
});
