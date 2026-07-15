// AiTextField / AiTextArea — Drop-in replacement for TextField/TextareaField
// with AI-augmented actions (ai-text-primitive plan doc, Phase 3).
//
// Built on raw <input>/<textarea> (not the generic Input primitive) because
// ghost-text needs a keydown handler (Tab/Esc) and an overlay that the
// discriminated-union Input contract doesn't expose. Same pattern as
// MoneyInput — a hand-built control wrapped in Field.
//
// Graceful degradation: `useAiTextAction`/`useCompletion` surface
// "unavailable" when the server feature isn't mounted (`feature_disabled`)
// — the toolbar hides and the field behaves like a plain text field, no
// error shown to the end-user.
//
// Ghost-text simplification: the overlay only ever appends after the
// current value (no mid-text ghost) — matches the server prompt design
// (ai-text's `complete` mode only ever continues forward from the given
// text). Two-layer overlay trick: an aria-hidden div behind the real
// input renders `value` (invisible, same font/box so it reserves space)
// followed by the suggestion in muted color; the real input sits on top
// with a transparent background so the suggestion shows through past the
// typed text. Both elements MUST share identical typography/box classes
// or the suggestion won't align with the caret.

import type { AiTextRewriteStyle } from "@cosmicdrift/kumiko-renderer";
import {
  useAiTextAction,
  useCompletion,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { Check, Languages, Wand2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { ModeSwitch } from "./mode-switch";

type AiTextAction = "correct" | "translate" | "rewrite";

interface AiTextFieldBaseProps {
  readonly label: string;
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly testId?: string;
  /** Ghost-text completion on/off. Default true. */
  readonly completion?: boolean;
  /** Debounce for ghost-text requests, ms. Default 500 — kept low in
   *  tests, tuned for real typing in production. */
  readonly completionDebounceMs?: number;
  /** Toolbar actions to expose. Default all three. */
  readonly actions?: readonly AiTextAction[];
  /** Target languages the translate action offers. First is preselected.
   *  Default `["en", "de", "fr", "es"]`. */
  readonly translateLanguages?: readonly string[];
}

export interface AiTextFieldProps extends AiTextFieldBaseProps {}
export interface AiTextAreaProps extends AiTextFieldBaseProps {
  readonly rows?: number;
}

const DEFAULT_LANGUAGES: readonly string[] = ["en", "de", "fr", "es"];
const DEFAULT_ACTIONS: readonly AiTextAction[] = ["correct", "translate", "rewrite"];
const REWRITE_STYLES: readonly AiTextRewriteStyle[] = ["formal", "casual", "concise", "expand"];

const sharedTextClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm shadow-sm leading-6 " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 " +
  "focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// Overlay and real control must share identical wrap/overflow behavior or the
// ghost suggestion drifts from the caret: <input> never wraps and scrolls
// horizontally, <textarea> soft-wraps and scrolls vertically.
const singleLineWrapClass = "whitespace-pre overflow-hidden";
const multilineWrapClass = "whitespace-pre-wrap break-words overflow-hidden";

function AiTextCore({
  multiline,
  label,
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  testId,
  rows,
  completion = true,
  completionDebounceMs = 500,
  actions = DEFAULT_ACTIONS,
  translateLanguages = DEFAULT_LANGUAGES,
}: AiTextFieldBaseProps & { readonly multiline: boolean; readonly rows?: number }): ReactNode {
  const { Field, Button, Dialog, Text } = usePrimitives();
  const t = useTranslation();

  const {
    suggestion,
    state: completionState,
    requestCompletion,
    clear: clearCompletion,
  } = useCompletion(completionDebounceMs);
  const {
    run: runAction,
    state: actionState,
    result: actionResult,
    reset: resetAction,
  } = useAiTextAction();

  const [dialogMode, setDialogMode] = useState<AiTextAction | null>(null);
  const [targetLanguage, setTargetLanguage] = useState(translateLanguages[0] ?? "en");
  const [rewriteStyle, setRewriteStyle] = useState<AiTextRewriteStyle>("concise");
  const overlayRef = useRef<HTMLDivElement>(null);

  const unavailable = completionState === "unavailable" || actionState === "unavailable";
  const capExceeded = completionState === "cap-exceeded" || actionState === "cap-exceeded";
  const showToolbar = !unavailable && actions.length > 0;
  const showGhost = completion && !unavailable && suggestion !== null && suggestion.length > 0;

  function handleChange(next: string): void {
    onChange(next);
    if (completion && !unavailable) {
      requestCompletion(next);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): void {
    if (suggestion === null) return;
    if (e.key === "Tab" && e.currentTarget.selectionStart === value.length) {
      e.preventDefault();
      onChange(value + suggestion);
      clearCompletion();
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearCompletion();
    }
  }

  function openDialog(mode: AiTextAction): void {
    resetAction();
    setDialogMode(mode);
    if (mode === "correct") {
      void runAction({ mode: "correct", text: value });
    }
  }

  function closeDialog(): void {
    setDialogMode(null);
    resetAction();
  }

  function runConfiguredAction(): void {
    if (dialogMode === "translate") {
      void runAction({ mode: "translate", text: value, targetLanguage });
    } else if (dialogMode === "rewrite") {
      void runAction({ mode: "rewrite", text: value, style: rewriteStyle });
    }
  }

  function applyResult(): void {
    if (actionResult?.type === "text") onChange(actionResult.text);
  }

  const needsConfig =
    (dialogMode === "translate" || dialogMode === "rewrite") &&
    actionState !== "loading" &&
    actionState !== "success";

  return (
    <>
      <Field id={id} label={label} required={required} testId={testId}>
        <div className="relative w-full">
          {showGhost && (
            <div
              ref={overlayRef}
              aria-hidden="true"
              className={cn(
                sharedTextClass,
                multiline ? multilineWrapClass : singleLineWrapClass,
                "pointer-events-none absolute inset-0 select-none border-transparent shadow-none",
              )}
            >
              <span className="invisible">{value}</span>
              <span className="text-muted-foreground">{suggestion}</span>
            </div>
          )}
          {multiline ? (
            <textarea
              id={id}
              name={name}
              value={value}
              required={required}
              disabled={disabled === true || unavailable}
              placeholder={placeholder}
              rows={rows ?? 4}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={clearCompletion}
              onScroll={(e) => {
                if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              className={cn(sharedTextClass, multilineWrapClass, "relative resize-y bg-transparent")}
              data-testid={testId !== undefined ? `${testId}-input` : undefined}
            />
          ) : (
            <input
              id={id}
              name={name}
              type="text"
              value={value}
              required={required}
              disabled={disabled === true || unavailable}
              placeholder={placeholder}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={clearCompletion}
              className={cn(sharedTextClass, singleLineWrapClass, "relative bg-transparent")}
              data-testid={testId !== undefined ? `${testId}-input` : undefined}
            />
          )}
        </div>

        {showGhost && <Text variant="muted">{t("kumiko.aiText.acceptHint")}</Text>}
        {capExceeded && <Text variant="muted">{t("kumiko.aiText.capExceeded")}</Text>}

        {showToolbar && (
          <div className="mt-1 flex gap-1">
            {actions.includes("correct") && (
              <Button
                variant="secondary"
                size="sm"
                disabled={value.length === 0}
                ariaLabel={t("kumiko.aiText.correct")}
                onClick={() => openDialog("correct")}
              >
                <Check className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            {actions.includes("translate") && (
              <Button
                variant="secondary"
                size="sm"
                disabled={value.length === 0}
                ariaLabel={t("kumiko.aiText.translate")}
                onClick={() => openDialog("translate")}
              >
                <Languages className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            {actions.includes("rewrite") && (
              <Button
                variant="secondary"
                size="sm"
                disabled={value.length === 0}
                ariaLabel={t("kumiko.aiText.rewrite")}
                onClick={() => openDialog("rewrite")}
              >
                <Wand2 className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </Field>

      {/* ponytail: Dialog's built-in Confirm button is always live, even
          while needsConfig is still showing the language/style picker —
          applyResult() no-ops until actionResult exists, so an early click
          just closes the dialog with nothing applied. Gating it needs a
          confirmDisabled prop on the shared Dialog primitive (other
          callers too); not worth widening that contract for one caller.
          Upgrade if this trips users up in practice. */}
      <Dialog
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        title={dialogMode !== null ? t(`kumiko.aiText.${dialogMode}`) : ""}
        onConfirm={applyResult}
        testId={testId !== undefined ? `${testId}-dialog` : undefined}
      >
        {dialogMode === "translate" && needsConfig && (
          <div className="mb-3 flex flex-col gap-2">
            <ModeSwitch
              value={targetLanguage}
              options={translateLanguages.map((l) => ({ value: l, label: l.toUpperCase() }))}
              onChange={setTargetLanguage}
            />
            <Button variant="primary" size="sm" onClick={runConfiguredAction}>
              {t(`kumiko.aiText.${dialogMode}`)}
            </Button>
          </div>
        )}
        {dialogMode === "rewrite" && needsConfig && (
          <div className="mb-3 flex flex-col gap-2">
            <ModeSwitch
              value={rewriteStyle}
              options={REWRITE_STYLES.map((s) => ({
                value: s,
                label: t(`kumiko.aiText.style.${s}`),
              }))}
              onChange={setRewriteStyle}
            />
            <Button variant="primary" size="sm" onClick={runConfiguredAction}>
              {t(`kumiko.aiText.${dialogMode}`)}
            </Button>
          </div>
        )}
        {actionState === "loading" && (
          <Text variant="muted">{t("kumiko.aiText.diff.generating")}</Text>
        )}
        {actionState === "success" && actionResult?.type === "text" && (
          <div className="flex flex-col gap-3">
            <div>
              <Text variant="small">{t("kumiko.aiText.diff.before")}</Text>
              <p className="whitespace-pre-wrap rounded-md border border-input bg-muted/40 p-2 text-sm">
                {value}
              </p>
            </div>
            <div>
              <Text variant="small">{t("kumiko.aiText.diff.after")}</Text>
              <p className="whitespace-pre-wrap rounded-md border border-input p-2 text-sm">
                {actionResult.text}
              </p>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/** Single-line AI text field — ghost-text completion + correct/translate/
 *  rewrite toolbar. Degrades to a plain text field when `ai-text` isn't
 *  mounted server-side. */
export function AiTextField(props: AiTextFieldProps): ReactNode {
  return <AiTextCore {...props} multiline={false} />;
}

/** Multi-line variant of {@link AiTextField}. */
export function AiTextArea(props: AiTextAreaProps): ReactNode {
  return <AiTextCore {...props} multiline={true} />;
}
