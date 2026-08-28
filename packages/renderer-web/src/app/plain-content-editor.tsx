// @runtime client
//
// "plain" contentFormat editor: the primitives textarea (TextareaContentEditor,
// unchanged — keeps its styling and its Field/label association) plus a
// variable-chip bar underneath. A chip click inserts `{{name}}` at the caret
// instead of appending to the end.
//
// ponytail: looks the textarea up via document.getElementById(id) rather
// than a ref threaded through the primitives Input contract — that contract
// is cross-platform (RN has no DOM node), this file is `@runtime client`-
// only. `id` is per-instance (caller passes a stable unique id via
// ContentEditorProps.id), so two plain editors mounted at once don't collide.

import {
  type ContentEditorProps,
  TextareaContentEditor,
  VariableChips,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function PlainContentEditor({
  id,
  value,
  onChange,
  variables,
  readOnly,
}: ContentEditorProps): ReactNode {
  const [caret, setCaret] = useState<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on value only — must fire once per committed insert, not on every caret write
  useEffect(() => {
    if (caret === null) return;
    const el = document.getElementById(id);
    if (el instanceof HTMLTextAreaElement) {
      el.focus();
      el.setSelectionRange(caret, caret);
    }
    setCaret(null);
  }, [value]);

  const insertAtCaret = (name: string): void => {
    const el = document.getElementById(id);
    const placeholder = `{{${name}}}`;
    if (!(el instanceof HTMLTextAreaElement)) {
      onChange(value + placeholder);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    setCaret(start + placeholder.length);
    onChange(value.slice(0, start) + placeholder + value.slice(end));
  };

  return (
    <div className="rounded-md border border-input bg-transparent">
      <TextareaContentEditor
        id={id}
        value={value}
        onChange={onChange}
        variables={variables}
        readOnly={readOnly}
      />
      {variables.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-input p-1">
          <VariableChips variables={variables} onInsert={insertAtCaret} disabled={readOnly} />
        </div>
      )}
    </div>
  );
}
