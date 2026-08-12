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
    // "files" is stubbed the same way; a plain `expect(input.value).toBe("")`
    // is vacuous because happy-dom never wrote anything else there — a spy on
    // the setter is what actually proves the component performs the reset.
    const setValue = mock((_value: string) => {});
    Object.defineProperty(input, "value", { set: setValue, get: () => "", configurable: true });
    pick(input, [new File(["a"], "a.pdf")]);

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(setValue).toHaveBeenCalledWith(""));
  });

  test("ruft onUpload bei Drop mit Dateien auf", async () => {
    const onUpload = mock(async () => {});
    render(<UploadZone title="Datei hochladen" onUpload={onUpload} testId="zone" />);
    const file = new File(["hi"], "dropped.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByTestId("zone-dropzone"), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  test("a dropped file that doesn't match `accept` is rejected, not passed to onUpload", async () => {
    const onUpload = mock(async () => {});
    render(
      <UploadZone title="Datei hochladen" onUpload={onUpload} accept={["image/*"]} testId="zone" />,
    );
    const file = new File(["hi"], "dropped.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByTestId("zone-dropzone"), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByText("dropped.pdf")).toBeTruthy());
    expect(screen.getByText("File type not allowed")).toBeTruthy();
    expect(onUpload).not.toHaveBeenCalled();
  });

  test("a dropped file that matches `accept` still uploads normally", async () => {
    const onUpload = mock(async () => {});
    render(
      <UploadZone title="Datei hochladen" onUpload={onUpload} accept={["image/*"]} testId="zone" />,
    );
    const file = new File(["hi"], "photo.png", { type: "image/png" });
    fireEvent.drop(screen.getByTestId("zone-dropzone"), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  test("a non-Error throw from onUpload shows the translated fallback, not the raw token", async () => {
    const onUpload = mock(async () => {
      throw "upload_failed";
    });
    render(<UploadZone title="Datei hochladen" onUpload={onUpload} testId="zone" />);
    const file = new File(["hi"], "huge.pdf", { type: "application/pdf" });
    pick(screen.getByTestId("zone-input"), [file]);

    // Both the sr-only status label and the visible error line now read
    // "Failed" (same i18n key) — assert at least one is present rather than
    // requiring a single match.
    await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(0));
    expect(screen.queryByText("upload_failed")).toBeNull();
  });

  test("uploads multiple files with distinct, stable row keys even without crypto.randomUUID (insecure-context LAN preview)", async () => {
    // `crypto.randomUUID` only exists in a secure context — an HTTP-over-LAN
    // preview leaves it undefined, so calling it throws TypeError. Row ids
    // must not depend on it.
    const originalRandomUUID = crypto.randomUUID;
    (crypto as unknown as { randomUUID?: () => string }).randomUUID = undefined;
    try {
      const onUpload = mock(async () => {});
      render(<UploadZone title="Datei hochladen" onUpload={onUpload} testId="zone" />);
      const a = new File(["a"], "a.pdf");
      const b = new File(["b"], "b.pdf");
      pick(screen.getByTestId("zone-input"), [a, b]);

      await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
      expect(screen.getByText("a.pdf")).toBeTruthy();
      expect(screen.getByText("b.pdf")).toBeTruthy();
      // Two distinct rows in the DOM (not collapsed onto one shared/undefined
      // React key) proves the ids stayed unique without crypto.randomUUID.
      expect(screen.getAllByTestId("zone-row")).toHaveLength(2);
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });

  test("disabled unterdrückt den Drop", () => {
    const onUpload = mock(async () => {});
    render(<UploadZone title="Datei hochladen" onUpload={onUpload} disabled testId="zone" />);
    const file = new File(["hi"], "dropped.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByTestId("zone-dropzone"), { dataTransfer: { files: [file] } });

    expect(onUpload).not.toHaveBeenCalled();
  });

  test("dragLeave auf ein Kind-Element behält den aktiven State, auf ein Element außerhalb setzt ihn zurück", () => {
    const onUpload = mock(async () => {});
    render(<UploadZone title="Datei hochladen" onUpload={onUpload} testId="zone" />);
    const dropzone = screen.getByTestId("zone-dropzone");
    const childIcon = screen.getByText("Datei hochladen");

    fireEvent.dragOver(dropzone, { dataTransfer: {} });
    expect(dropzone.className).toContain("border-primary");

    // happy-dom's DragEvent constructor ignores `relatedTarget` in the init
    // dict, so it must be forced via defineProperty rather than passed
    // through fireEvent.dragLeave(el, init).
    const leaveTo = (relatedTarget: Element): void => {
      const evt = new DragEvent("dragleave", { bubbles: true, cancelable: true });
      Object.defineProperty(evt, "relatedTarget", { value: relatedTarget, configurable: true });
      fireEvent(dropzone, evt);
    };

    leaveTo(childIcon);
    expect(dropzone.className).toContain("border-primary");

    leaveTo(document.body);
    expect(dropzone.className).not.toContain("border-primary");
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
      // Content sized well above the fake resize's 13 bytes — resizeImageBeforeUpload
      // (framework#1979) only takes the re-encode when it's actually smaller.
      const file = new File(["x".repeat(2000)], "photo.jpg", { type: "image/jpeg" });
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
