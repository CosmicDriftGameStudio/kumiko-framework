import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { patchIssue } from "../document-op-blocks.ts";
import {
  composeLayoutHtml,
  LAYOUT_REGION_NAMES,
  type LayoutRegionName,
  readLayoutRegions,
} from "../layout-regions.ts";
import { DOCUMENT_OPS_KINDS, type DocumentOpsKind } from "../web/constants.ts";

export const documentTargetShape = {
  kind: z.enum(DOCUMENT_OPS_KINDS),
  region: z.enum(LAYOUT_REGION_NAMES).optional(),
};

// A pdf-layout is edited one region at a time; every other kind is the whole body.
export function regionIssue(
  kind: DocumentOpsKind,
  region: LayoutRegionName | undefined,
): FieldIssue | null {
  if (kind === "pdf-layout" && region === undefined) return patchIssue("region", "region_required");
  if (kind !== "pdf-layout" && region !== undefined) {
    return patchIssue("region", "region_not_allowed", { kind });
  }
  return null;
}

export function editableHtmlOf(
  kind: DocumentOpsKind,
  region: LayoutRegionName | undefined,
  content: string,
): string {
  return kind === "pdf-layout" && region !== undefined
    ? readLayoutRegions(content)[region]
    : content;
}

export function contentWithEditedHtml(
  kind: DocumentOpsKind,
  region: LayoutRegionName | undefined,
  content: string,
  editedHtml: string,
): string {
  if (kind !== "pdf-layout" || region === undefined) return editedHtml;
  return composeLayoutHtml({ ...readLayoutRegions(content), [region]: editedHtml });
}
