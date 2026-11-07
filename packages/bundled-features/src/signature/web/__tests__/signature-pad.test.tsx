// Synchronous assertions only: awaiting on the shared happy-dom document is the known flake source.
import { afterEach, describe, expect, test } from "bun:test";
import { PrimitivesProvider } from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { SignaturePad as SignaturePadController } from "../pad.ts";
import { SignaturePad } from "../signature-pad.tsx";

const originalProto = {
  getContext: HTMLCanvasElement.prototype.getContext,
  setPointerCapture: HTMLCanvasElement.prototype.setPointerCapture,
  releasePointerCapture: HTMLCanvasElement.prototype.releasePointerCapture,
};

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = originalProto.getContext;
  HTMLCanvasElement.prototype.setPointerCapture = originalProto.setPointerCapture;
  HTMLCanvasElement.prototype.releasePointerCapture = originalProto.releasePointerCapture;
});

// happy-dom has no 2d canvas context; the pad needs one to draw.
function stubCanvasContext(): void {
  const context = {
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    clearRect: () => undefined,
  };
  HTMLCanvasElement.prototype.getContext = (() =>
    context) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.setPointerCapture = () => undefined;
  HTMLCanvasElement.prototype.releasePointerCapture = () => undefined;
}

function mountPad(extra: { onSignOnPaper?: () => void } = {}) {
  stubCanvasContext();
  const pads: Array<SignaturePadController | null> = [];
  const onPadReady = (pad: SignaturePadController | null) => pads.push(pad);
  const view = render(
    <PrimitivesProvider value={defaultPrimitives}>
      <SignaturePad onPadReady={onPadReady} {...extra} />
    </PrimitivesProvider>,
  );
  return { view, pads };
}

describe("SignaturePad", () => {
  test("hands the controller out and starts empty with the clear button disabled", () => {
    const { view, pads } = mountPad();
    expect(pads.at(-1)?.isEmpty()).toBe(true);
    expect(view.getByRole("button", { name: "Clear" }).hasAttribute("disabled")).toBe(true);
  });

  test("drawing enables clear, clear empties the field again", () => {
    const { view, pads } = mountPad();
    const canvas = view.getByRole("img");
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    const clear = view.getByRole("button", { name: "Clear" });
    expect(pads.at(-1)?.isEmpty()).toBe(false);
    expect(clear.hasAttribute("disabled")).toBe(false);

    fireEvent.click(clear);
    expect(pads.at(-1)?.isEmpty()).toBe(true);
  });

  test("offers the paper exit only when a handler is given and it is a real button", () => {
    const withoutExit = mountPad();
    expect(withoutExit.view.queryByRole("button", { name: "Sign on paper instead" })).toBeNull();
    cleanup();

    let chosen = 0;
    const { view } = mountPad({ onSignOnPaper: () => (chosen += 1) });
    const exit = view.getByRole("button", { name: "Sign on paper instead" });
    expect(exit.tagName).toBe("BUTTON");
    fireEvent.click(exit);
    expect(chosen).toBe(1);
  });

  test("releases the controller on unmount", () => {
    const { view, pads } = mountPad();
    view.unmount();
    expect(pads.at(-1)).toBeNull();
  });
});
