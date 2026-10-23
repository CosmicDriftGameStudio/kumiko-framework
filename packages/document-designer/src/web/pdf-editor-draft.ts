import type { MailVariable } from "./mail-types.ts";
import { type PdfMetaDraft, parsePdfMeta, serializePdfMeta } from "./pdf-meta.ts";
import type { PdfPreviewResult, TemplateDetail, VariableInfo } from "./types.ts";

export const SETTLE_MS = 500;
export const NO_VARIABLES: Readonly<Record<string, VariableInfo>> = {};

export type Draft = { readonly content: string; readonly meta: PdfMetaDraft };

export type EditorState = {
  readonly key: string;
  readonly draft: Draft;
  // The draft the server-side checks run against; trails the draft by SETTLE_MS while typing.
  readonly settled: Draft;
  readonly snapshot: string;
};

export type GeneratedPdf = { readonly forSnapshot: string; readonly result: PdfPreviewResult };

export const draftFromDetail = (detail: TemplateDetail): Draft => ({
  content: detail.content,
  meta: parsePdfMeta(detail.meta),
});

export const snapshotOf = (draft: Draft): string =>
  JSON.stringify({ content: draft.content, meta: serializePdfMeta(draft.meta) });

// Only the label of an images variable is needed, for the Images block and its picker.
export function imageLabelSource(
  variables: Readonly<Record<string, VariableInfo>>,
): Readonly<Record<string, MailVariable>> {
  const result: Record<string, MailVariable> = {};
  for (const [name, info] of Object.entries(variables)) {
    if (info.type === "images" && info.label !== undefined) {
      result[name] = { type: "text", label: info.label };
    }
  }
  return result;
}

export function textVariablesOf(
  variables: Readonly<Record<string, VariableInfo>>,
): Readonly<Record<string, MailVariable>> {
  const result: Record<string, MailVariable> = {};
  for (const [name, info] of Object.entries(variables)) {
    if (info.type === "images") continue;
    const { item, ...rest } = info;
    const columns = Object.entries(item ?? {}).flatMap(([column, def]) =>
      def.type === "images" ? [] : [[column, { ...def, type: def.type }] as const],
    );
    result[name] = {
      ...rest,
      type: info.type,
      ...(item !== undefined && { item: Object.fromEntries(columns) }),
    };
  }
  return result;
}
