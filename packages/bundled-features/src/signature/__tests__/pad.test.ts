import { describe, expect, test } from "bun:test";
import { bytesToBase64, createSignaturePad, type SignaturePadCanvas } from "../web/pad.ts";

type Listener = (event: PointerEvent) => void;

// Unit tests run without a DOM; the pad only needs this structural slice of a canvas.
function createFakeCanvas() {
  const listeners = new Map<string, Listener>();
  const drawn: string[] = [];
  const context = {
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    strokeStyle: "",
    fillStyle: "",
    beginPath: () => drawn.push("begin"),
    arc: () => drawn.push("arc"),
    fill: () => drawn.push("fill"),
    moveTo: () => drawn.push("move"),
    lineTo: () => drawn.push("line"),
    stroke: () => drawn.push("stroke"),
    clearRect: () => drawn.push("clear"),
  };
  const captured = new Set<number>();
  const canvas = {
    width: 400,
    height: 100,
    style: { touchAction: "" },
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 200, height: 50 }),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    toBlob: (callback: BlobCallback) => callback(new Blob([new Uint8Array([1, 2, 3])])),
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  } as unknown as SignaturePadCanvas;
  const fire = (type: string, init: { pointerId?: number; clientX?: number; clientY?: number }) =>
    listeners.get(type)?.({
      pointerId: init.pointerId ?? 1,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      preventDefault: () => undefined,
    } as PointerEvent);
  return { canvas, fire, drawn, listeners, captured };
}

describe("createSignaturePad", () => {
  test("starts empty and is drawn after a pointer stroke", () => {
    const { canvas, fire } = createFakeCanvas();
    const changes: boolean[] = [];
    const pad = createSignaturePad(canvas, { onChange: (empty) => changes.push(empty) });
    expect(pad.isEmpty()).toBe(true);

    fire("pointerdown", { clientX: 20, clientY: 20 });
    fire("pointermove", { clientX: 60, clientY: 40 });
    fire("pointerup", {});

    expect(pad.isEmpty()).toBe(false);
    expect(changes).toEqual([false]);
  });

  test("a single tap leaves a dot", () => {
    const { canvas, fire } = createFakeCanvas();
    const pad = createSignaturePad(canvas);
    fire("pointerdown", {});
    fire("pointerup", {});
    expect(pad.isEmpty()).toBe(false);
  });

  test("clear empties the field and reports it", () => {
    const { canvas, fire } = createFakeCanvas();
    const changes: boolean[] = [];
    const pad = createSignaturePad(canvas, { onChange: (empty) => changes.push(empty) });
    fire("pointerdown", {});
    fire("pointerup", {});
    pad.clear();
    expect(pad.isEmpty()).toBe(true);
    expect(changes).toEqual([false, true]);
  });

  test("a second pointer is ignored while one is drawing", () => {
    const { canvas, fire, drawn } = createFakeCanvas();
    createSignaturePad(canvas);
    fire("pointerdown", { pointerId: 1 });
    const strokesBefore = drawn.length;
    fire("pointerdown", { pointerId: 2 });
    fire("pointermove", { pointerId: 2, clientX: 50 });
    expect(drawn.length).toBe(strokesBefore);
  });

  test("blocks browser touch gestures on the canvas and removes its listeners on destroy", () => {
    const { canvas, listeners } = createFakeCanvas();
    const pad = createSignaturePad(canvas);
    expect(canvas.style.touchAction).toBe("none");
    expect(listeners.size).toBe(4);
    pad.destroy();
    expect(listeners.size).toBe(0);
  });

  test("exports the field as base64 without a data-URL prefix", async () => {
    const { canvas } = createFakeCanvas();
    const pad = createSignaturePad(canvas);
    expect(await pad.toPngBase64()).toBe(bytesToBase64(new Uint8Array([1, 2, 3])));
  });
});
