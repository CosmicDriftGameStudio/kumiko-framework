// Framework-free signature field: Pointer Events (finger, pen, mouse) on a canvas. Imports nothing,
// so the static-sign entry stays free of React and of any runtime dependency.

export type SignaturePadCanvas = Pick<
  HTMLCanvasElement,
  | "width"
  | "height"
  | "addEventListener"
  | "removeEventListener"
  | "getBoundingClientRect"
  | "getContext"
  | "toBlob"
  | "setPointerCapture"
  | "releasePointerCapture"
> & { readonly style: Pick<CSSStyleDeclaration, "touchAction"> };

export type SignaturePadOptions = {
  /** Stroke width in canvas pixels. Default 3. */
  readonly lineWidth?: number;
  /** Stroke colour. Default near-black. */
  readonly strokeStyle?: string;
  /** Called whenever the field switches between empty and drawn. */
  readonly onChange?: (isEmpty: boolean) => void;
};

export type SignaturePad = {
  readonly clear: () => void;
  readonly isEmpty: () => boolean;
  /** PNG with transparent background as base64 without the data-URL prefix. */
  readonly toPngBase64: () => Promise<string>;
  readonly destroy: () => void;
};

const DEFAULT_LINE_WIDTH = 3;
const DEFAULT_STROKE_STYLE = "#111111";
const BASE64_CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

type Point = { readonly x: number; readonly y: number };

// Closures of the pad need the non-null context; narrowing a const does not carry into them.
function requireContext(canvas: SignaturePadCanvas): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("createSignaturePad: the canvas has no 2d context");
  return context;
}

export function createSignaturePad(
  canvas: SignaturePadCanvas,
  options: SignaturePadOptions = {},
): SignaturePad {
  const context = requireContext(canvas);
  const lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = options.strokeStyle ?? DEFAULT_STROKE_STYLE;
  context.fillStyle = options.strokeStyle ?? DEFAULT_STROKE_STYLE;
  canvas.style.touchAction = "none";

  let drawnAny = false;
  let activePointerId: number | null = null;
  let lastPoint: Point | null = null;

  function setDrawn(next: boolean): void {
    if (drawnAny === next) return;
    drawnAny = next;
    options.onChange?.(!next);
  }

  // The canvas may be displayed at another size than its pixel size (CSS scaling).
  function pointOf(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  }

  function onPointerDown(event: PointerEvent): void {
    if (activePointerId !== null) return;
    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const point = pointOf(event);
    lastPoint = point;
    context.beginPath();
    context.arc(point.x, point.y, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    setDrawn(true);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== activePointerId || lastPoint === null) return;
    const point = pointOf(event);
    context.beginPath();
    context.moveTo(lastPoint.x, lastPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPoint = point;
    event.preventDefault();
  }

  function onPointerEnd(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    canvas.releasePointerCapture(event.pointerId);
    activePointerId = null;
    lastPoint = null;
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);

  return {
    clear: () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      setDrawn(false);
    },
    isEmpty: () => !drawnAny,
    toPngBase64: () =>
      new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) {
            reject(new Error("createSignaturePad: the canvas could not be exported as PNG"));
            return;
          }
          blob
            .arrayBuffer()
            .then((buffer) => resolve(bytesToBase64(new Uint8Array(buffer))), reject);
        }, "image/png");
      }),
    destroy: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
    },
  };
}
