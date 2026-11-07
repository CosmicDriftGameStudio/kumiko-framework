import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { useCallback, useRef, useState } from "react";
import { createSignaturePad, type SignaturePad as SignaturePadController } from "./pad.ts";

export type SignaturePadLabels = {
  readonly fieldLabel: string;
  readonly clear: string;
  readonly signOnPaper: string;
};

export const DEFAULT_SIGNATURE_PAD_LABELS: SignaturePadLabels = {
  fieldLabel: "Signature field: draw your signature with finger, pen or mouse",
  clear: "Clear",
  signOnPaper: "Sign on paper instead",
};

export type SignaturePadProps = {
  /** Gets the controller once the canvas is mounted and null on unmount; read `toPngBase64()` from it on submit. Keep it referentially stable, a new function recreates the field. */
  readonly onPadReady: (pad: SignaturePadController | null) => void;
  /** Same stability requirement as `onPadReady`. */
  readonly onChange?: (isEmpty: boolean) => void;
  /** Shows the "sign on paper" exit; the signer who cannot draw must always have a way out. */
  readonly onSignOnPaper?: () => void;
  readonly labels?: Partial<SignaturePadLabels>;
  readonly width?: number;
  readonly height?: number;
};

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 240;

// Drawing needs a pointer; everything else (clear, the paper exit) is a plain focusable button.
// The pad lives in a callback ref instead of an effect: it follows the canvas element's mount and unmount.
export function SignaturePad(props: SignaturePadProps) {
  const { Button } = usePrimitives();
  const labels = { ...DEFAULT_SIGNATURE_PAD_LABELS, ...props.labels };
  const padRef = useRef<SignaturePadController | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const { onPadReady, onChange } = props;

  const mountPad = useCallback(
    (canvas: HTMLCanvasElement) => {
      const pad = createSignaturePad(canvas, {
        onChange: (empty) => {
          setIsEmpty(empty);
          onChange?.(empty);
        },
      });
      padRef.current = pad;
      onPadReady(pad);
      return () => {
        pad.destroy();
        padRef.current = null;
        onPadReady(null);
      };
    },
    [onPadReady, onChange],
  );

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={mountPad}
        width={props.width ?? DEFAULT_WIDTH}
        height={props.height ?? DEFAULT_HEIGHT}
        role="img"
        aria-label={labels.fieldLabel}
        className="w-full rounded border border-input bg-white"
      />
      <div className="flex gap-2">
        <Button variant="secondary" disabled={isEmpty} onClick={() => padRef.current?.clear()}>
          {labels.clear}
        </Button>
        {props.onSignOnPaper === undefined ? null : (
          <Button variant="ghost" onClick={props.onSignOnPaper}>
            {labels.signOnPaper}
          </Button>
        )}
      </div>
    </div>
  );
}
