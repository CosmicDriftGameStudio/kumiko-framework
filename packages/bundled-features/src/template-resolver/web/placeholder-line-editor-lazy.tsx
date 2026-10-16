// @runtime client
//
// Lazy boundary for the placeholder line editor: tiptap loads with the chunk,
// the fallback is a plain text input holding the same `{{name}}` text.
// Never import placeholder-line-editor statically here.

import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { lazy, type ReactNode, Suspense } from "react";
import type { PlaceholderLineEditorProps } from "./placeholder-line-editor.js";

export type { PlaceholderLineEditorProps } from "./placeholder-line-editor.js";

const LazyPlaceholderLineEditor = lazy(() => import("./placeholder-line-editor.js"));

function PlainLineFallback({
  id,
  value,
  onChange,
  readOnly = false,
  "aria-label": ariaLabel,
}: PlaceholderLineEditorProps): ReactNode {
  const { Field, Input } = usePrimitives();
  return (
    <Field id={id} label={ariaLabel} hideLabel>
      <Input kind="text" id={id} name={id} value={value} onChange={onChange} disabled={readOnly} />
    </Field>
  );
}

export function PlaceholderLineEditor(props: PlaceholderLineEditorProps): ReactNode {
  return (
    <Suspense fallback={<PlainLineFallback {...props} />}>
      <LazyPlaceholderLineEditor {...props} />
    </Suspense>
  );
}
