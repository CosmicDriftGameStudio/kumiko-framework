// @runtime client
import type { DocumentEditorHandle } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useRef } from "react";

export type InsertField =
  | "subject"
  | "previewText"
  | "headerChip"
  | "footerNote"
  | "body"
  | "title"
  | "author";

export type InsertTargets = {
  readonly register: (field: InsertField) => (handle: DocumentEditorHandle) => void;
  readonly markFocused: (field: InsertField) => () => void;
  readonly insertPlaceholder: (name: string) => void;
  readonly insertResource: (key: string) => void;
};

// The editors are lazy and report their handle once loaded; the rails insert into whichever
// field had focus last (the content when none had).
export function useInsertTargets(): InsertTargets {
  const handles = useRef<Partial<Record<InsertField, DocumentEditorHandle>>>({});
  const lastFocused = useRef<InsertField>("body");
  return {
    register: (field) => (handle) => {
      handles.current[field] = handle;
    },
    markFocused: (field) => () => {
      lastFocused.current = field;
    },
    insertPlaceholder: (name) => handles.current[lastFocused.current]?.insertPlaceholder(name),
    insertResource: (key) => handles.current.body?.insertResource(key),
  };
}
