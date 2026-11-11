import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import type { EditFieldViewModel } from "../headless/index.ts";
import { REFERENCE_SEARCH_DEBOUNCE_MS } from "../hooks/reference-limits.ts";
import { useDebouncedValue } from "../hooks/use-debounced-value.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { useAiAssistPayload } from "./ai-assist-payload.tsx";
import { choiceChipClass } from "./choice-chip-class.ts";
import { documentHtmlToText, textToDocumentHtml } from "./document-text.ts";

type AiAssist = NonNullable<EditFieldViewModel["aiAssist"]>;

type AiAssistControlProps = {
  readonly field: EditFieldViewModel;
  readonly aiAssist: AiAssist;
  readonly onChange: (value: unknown) => void;
  readonly input: ReactNode;
  /** Current form values; `aiAssist.contextFields` are read from here. */
  readonly row?: Readonly<Record<string, unknown>>;
};

// Mounted only with a dispatcher; without one the field stays a plain input.
export function AiAssistControl(props: AiAssistControlProps): ReactNode {
  const dispatcher = useOptionalDispatcher();
  return dispatcher === undefined ? props.input : <AiAssistChips {...props} />;
}

// Chips stack: every active chip contributes its params, so "shorter" and "mention warranty"
// can be combined. A click toggles the chip and re-runs the query with the new set.
function AiAssistChips({ field, aiAssist, onChange, input, row }: AiAssistControlProps): ReactNode {
  const { Button, Input, Banner } = usePrimitives();
  const t = useTranslation();
  const dispatcher = useOptionalDispatcher();
  const contextPayload = useAiAssistPayload();
  const [active, setActive] = useState<ReadonlySet<number>>(new Set());
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const activeRun = useRef<AbortController | null>(null);

  const isDocument = field.editor === "document";
  const contextValues = Object.fromEntries(
    (aiAssist.contextFields ?? []).map((name) => {
      const value = row?.[name];
      return [
        name,
        typeof value === "string" && field.contextDocumentFields?.includes(name)
          ? documentHtmlToText(value)
          : value,
      ];
    }),
  );
  // Changed context (e.g. another selection) replaces an empty or AI-written text; the first render never fetches.
  // Debounced so a text context field does not fire one server-side LLM query per keystroke.
  const contextKey = useDebouncedValue(JSON.stringify(contextValues), REFERENCE_SEARCH_DEBOUNCE_MS);
  const seenContextKey = useRef(contextKey);
  const lastGeneratedText = useRef<string | undefined>(undefined);

  const run = async (chips: ReadonlySet<number>, typed: string | undefined): Promise<void> => {
    if (dispatcher === undefined) return;
    activeRun.current?.abort();
    const ctrl = new AbortController();
    activeRun.current = ctrl;
    const chipParams = Object.assign(
      {},
      ...[...chips].map((index) => aiAssist.chips?.[index]?.params),
    );
    const payload = {
      ...contextPayload,
      ...contextValues,
      ...chipParams,
      ...(typed !== undefined &&
        aiAssist.prompt !== undefined && { [aiAssist.prompt.param]: typed }),
    };
    setBusy(true);
    setFailed(false);
    let result: Awaited<ReturnType<typeof dispatcher.query<unknown>>>;
    try {
      result = await dispatcher.query<unknown>(aiAssist.query, payload, { signal: ctrl.signal });
    } catch {
      if (!ctrl.signal.aborted) {
        setBusy(false);
        setFailed(true);
      }
      return;
    }
    if (ctrl.signal.aborted) return;
    setBusy(false);
    const noteText =
      result.isSuccess && aiAssist.noteField !== undefined
        ? propertyOf(result.data, aiAssist.noteField)
        : undefined;
    setNote(typeof noteText === "string" && noteText !== "" ? noteText : undefined);
    const text = result.isSuccess ? propertyOf(result.data, aiAssist.resultField) : undefined;
    if (typeof text !== "string") {
      setFailed(true);
      return;
    }
    const written = isDocument ? textToDocumentHtml(text) : text;
    lastGeneratedText.current = written;
    onChange(written);
  };

  // The effect reads the latest run/active through a ref so it only fires when the context changes.
  const rerunWithCurrentChips = useRef(() => {});
  rerunWithCurrentChips.current = () => void run(active, undefined);
  const hasHandWrittenText = useRef(false);
  const isFieldEmpty = field.value === "" || field.value === null || field.value === undefined;
  hasHandWrittenText.current = !isFieldEmpty && field.value !== lastGeneratedText.current;
  useEffect(() => {
    // skip: nothing changed since the last run (or since mount).
    if (aiAssist.autoRun === false) return;
    if (seenContextKey.current === contextKey) return;
    seenContextKey.current = contextKey;
    // skip: the user's own text is never replaced silently.
    if (hasHandWrittenText.current) return;
    rerunWithCurrentChips.current();
  }, [contextKey, aiAssist.autoRun]);

  const toggle = (index: number): void => {
    const next = new Set(active);
    if (!next.delete(index)) next.add(index);
    setActive(next);
    void run(next, undefined);
  };

  return (
    <>
      {input}
      <div
        className="order-2 flex flex-wrap items-center gap-2"
        data-testid={`field-ai-assist-${field.field}`}
      >
        {aiAssist.chips?.map((chip, index) => (
          <Button
            key={chip.label}
            variant="secondary"
            size="sm"
            className={choiceChipClass(active.has(index))}
            pressed={active.has(index)}
            disabled={busy || field.readOnly}
            testId={`field-ai-chip-${field.field}-${index}`}
            onClick={() => toggle(index)}
          >
            {active.has(index) ? `✓ ${chip.label}` : chip.label}
          </Button>
        ))}
        {aiAssist.prompt !== undefined && (
          <Input
            kind="text"
            id={`${field.field}-ai-instruction`}
            name={`${field.field}-ai-instruction`}
            value={instruction}
            onChange={setInstruction}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // Enter must not submit the host form.
              event.preventDefault();
              if (busy || field.readOnly || instruction.trim() === "") return;
              void run(active, instruction.trim());
            }}
            disabled={busy || field.readOnly}
            placeholder={aiAssist.prompt.placeholder ?? t("kumiko.field.aiAssist.prompt")}
            testId={`field-ai-prompt-${field.field}`}
          />
        )}
      </div>
      {note !== undefined && (
        <span
          className="order-2 text-xs text-muted-foreground"
          data-testid={`field-ai-note-${field.field}`}
        >
          {note}
        </span>
      )}
      {failed && (
        <Banner variant="error" testId={`field-ai-error-${field.field}`}>
          {t("kumiko.field.aiAssist.failed")}
        </Banner>
      )}
    </>
  );
}
