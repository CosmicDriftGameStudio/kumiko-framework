import type { ChangeEvent, KeyboardEvent } from "react";
import { cn } from "../lib/cn.ts";
import { Input as UiInput } from "../ui/input.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { CodeInput } from "./code-input.tsx";
import {
  fieldIconFor,
  textareaMinHeight,
  withFieldIcon,
  withInputAddons,
  withTrailingAction,
} from "./field.tsx";
import type { KindRenderer, PropsOfKind } from "./input-shared.ts";

export const renderTextKind: KindRenderer<"text"> = (props, { common, textInputRef }) =>
  withInputAddons(
    props,
    withFieldIcon(
      props.icon,
      <UiInput
        type="text"
        ref={textInputRef}
        {...common}
        {...props.dataAttributes}
        data-testid={props.testId}
        readOnly={props.readOnly}
        value={props.value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
        onKeyDown={props.onKeyDown}
        {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
        {...(props.autoComplete !== undefined && { autoComplete: props.autoComplete })}
        className={cn(fieldIconFor(props.icon) !== undefined ? "pl-8" : undefined)}
      />,
    ),
  );

export const renderCodeKind: KindRenderer<"code"> = (props) => <CodeInput {...props} />;

export const renderEmailKind: KindRenderer<"email"> = (props, { common }) => (
  <UiInput
    type="email"
    {...common}
    data-testid={props.testId}
    value={props.value}
    onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
    {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
    autoComplete={props.autoComplete ?? "email"}
  />
);

export const renderMonthKind: KindRenderer<"month"> = (props, { common }) => (
  <UiInput
    type="month"
    {...common}
    data-testid={props.testId}
    value={props.value}
    onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
  />
);

export const renderPasswordKind: KindRenderer<"password"> = (props, { common }) =>
  withTrailingAction(
    props.trailingAction,
    <UiInput
      type="password"
      {...common}
      data-testid={props.testId}
      value={props.value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
      {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
      autoComplete={props.autoComplete ?? "current-password"}
      className={props.trailingAction !== undefined ? "pr-9" : undefined}
    />,
    true,
  );

type TextareaShortcutInput = Pick<PropsOfKind<"textarea">, "onKeyDown" | "onSubmitShortcut">;

function textareaShortcutProps({ onKeyDown, onSubmitShortcut }: TextareaShortcutInput) {
  if (onSubmitShortcut === undefined && onKeyDown === undefined) return {};
  return {
    ...(onSubmitShortcut !== undefined && {
      "aria-keyshortcuts": "Control+Enter Meta+Enter",
    }),
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(e);
      // Lets a caller that already handles Ctrl/Cmd+Enter (e.g. an
      // "Enter sends" handler that ignores only Shift) opt out of the
      // shortcut instead of submitting twice.
      if (e.defaultPrevented) return;
      if (onSubmitShortcut === undefined || e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      onSubmitShortcut();
    },
  };
}

export const renderTextareaKind: KindRenderer<"textarea"> = (props, { common }) => (
  <Textarea
    {...common}
    {...props.dataAttributes}
    readOnly={props.readOnly}
    value={props.value}
    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => props.onChange(e.target.value)}
    rows={props.rows ?? 4}
    className="resize-y"
    {...(props.placeholder !== undefined && { placeholder: props.placeholder })}
    {...(props.rows !== undefined && { style: textareaMinHeight(props.rows) })}
    {...textareaShortcutProps(props)}
  />
);
