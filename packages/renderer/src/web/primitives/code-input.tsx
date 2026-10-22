import { type ChangeEvent, type ReactNode, useContext } from "react";
import type { InputProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { FieldDescriptionContext } from "./contexts.tsx";
import { useFocusOnMount } from "./use-focus-on-mount.ts";

export type CodeInputProps = Extract<InputProps, { readonly kind: "code" }>;

const MIN_LENGTH_FOR_SEPARATOR = 6;

export function CodeInput(props: CodeInputProps): ReactNode {
  const { length, value, hasError, disabled } = props;
  const describedBy = useContext(FieldDescriptionContext);
  const inputRef = useFocusOnMount(props.autoFocus);
  const activeIndex = Math.min(value.length, length - 1);
  const hasSeparator = length >= MIN_LENGTH_FOR_SEPARATOR && length % 2 === 0;

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.value.replace(/\D/g, "").slice(0, length);
    props.onChange(next);
    if (next.length === length && next !== value) props.onComplete?.(next);
  };

  const cells: ReactNode[] = [];
  for (let index = 0; index < length; index++) {
    const isActive = index === activeIndex;
    const char = value[index];
    if (hasSeparator && index === length / 2) {
      cells.push(
        <span key="separator" aria-hidden="true" className="shrink-0 text-muted-foreground">
          –
        </span>,
      );
    }
    cells.push(
      <div
        key={index}
        data-active={isActive}
        aria-hidden="true"
        className={cn(
          "flex h-12 min-w-0 flex-1 items-center justify-center rounded-md border border-input bg-transparent text-xl font-semibold tabular-nums shadow-xs transition-[color,box-shadow] dark:bg-input/30",
          hasError === true && "border-destructive",
          "data-[active=true]:group-focus-within:ring-[3px]",
          hasError === true
            ? "data-[active=true]:group-focus-within:border-destructive data-[active=true]:group-focus-within:ring-destructive/20 dark:data-[active=true]:group-focus-within:ring-destructive/40"
            : "data-[active=true]:group-focus-within:border-ring data-[active=true]:group-focus-within:ring-ring/50",
        )}
      >
        {char}
        {isActive && char === undefined ? (
          <span className="hidden h-6 w-px animate-pulse bg-foreground group-focus-within:block" />
        ) : null}
      </div>,
    );
  }

  return (
    <div
      className={cn(
        "group relative flex w-full items-center gap-2",
        disabled === true && "cursor-not-allowed opacity-50",
      )}
    >
      {cells}
      <input
        ref={inputRef}
        type="text"
        id={props.id}
        name={props.name}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        inputMode="numeric"
        autoComplete={props.autoComplete ?? "one-time-code"}
        spellCheck={false}
        data-testid={props.testId}
        aria-describedby={describedBy}
        aria-required={props.required}
        aria-invalid={hasError === true ? true : undefined}
        className="absolute inset-0 h-full w-full bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
      />
    </div>
  );
}
