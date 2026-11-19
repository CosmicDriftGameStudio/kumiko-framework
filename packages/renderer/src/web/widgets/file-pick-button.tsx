import type { NavIconKey } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useRef } from "react";
import { type ButtonProps, usePrimitives } from "../../index.ts";
import { toAcceptAttr } from "../lib/accept-attr.ts";

export type FilePickButtonProps = {
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly children: ReactNode;
  readonly accept?: readonly string[];
  readonly multiple?: boolean;
  readonly capture?: "environment" | "user";
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly variant?: ButtonProps["variant"];
  readonly size?: "sm" | "md";
  readonly icon?: NavIconKey;
  readonly testId?: string;
};

/** Button that opens the file picker and hands the picked files over without uploading them. */
export function FilePickButton({
  onFilesPicked,
  children,
  accept,
  multiple,
  capture,
  disabled,
  loading,
  variant,
  size,
  icon,
  testId,
}: FilePickButtonProps): ReactNode {
  const { Button } = usePrimitives();
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptAttr = toAcceptAttr(accept);
  return (
    <>
      <Button
        type="button"
        {...(variant !== undefined && { variant })}
        {...(size !== undefined && { size })}
        {...(icon !== undefined && { icon })}
        {...(disabled !== undefined && { disabled })}
        {...(loading !== undefined && { loading })}
        {...(testId !== undefined && { testId })}
        onClick={() => inputRef.current?.click()}
      >
        {children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        multiple={multiple === true}
        disabled={disabled}
        data-testid={testId !== undefined ? `${testId}-input` : undefined}
        {...(acceptAttr !== undefined && { accept: acceptAttr })}
        {...(capture !== undefined && { capture })}
        onChange={(event) => {
          const picked = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (picked.length > 0) onFilesPicked(picked);
        }}
      />
    </>
  );
}
