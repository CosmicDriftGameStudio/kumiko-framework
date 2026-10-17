// @runtime client
import type { StatusBadgeTone } from "@cosmicdrift/kumiko-renderer-web";
import type { OverviewRowView } from "./overview-row.js";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

const STATUS_TONE: Readonly<Record<OverviewRowView["status"], StatusBadgeTone>> = {
  active: "ok",
  draft: "muted",
  archived: "muted",
};

export function statusTone(status: OverviewRowView["status"]): StatusBadgeTone {
  return STATUS_TONE[status];
}

export function statusLabel(
  t: Translate,
  status: OverviewRowView["status"],
  version: number,
): string {
  if (status === "archived") return t("documentDesigner.status.archived");
  return t(
    status === "active"
      ? "documentDesigner.status.activeVersion"
      : "documentDesigner.status.draftVersion",
    { version },
  );
}

export function draftBesideActiveSentence(
  t: Translate,
  row: {
    readonly status: string;
    readonly version: number;
    readonly active?: { readonly version: number } | null;
  },
): string | null {
  if (asRowStatus(row.status) !== "draft" || row.active == null) return null;
  return t("documentDesigner.origin.draftBesideActive", {
    active: row.active.version,
    draft: row.version,
  });
}

export function asRowStatus(status: string): OverviewRowView["status"] {
  return status === "active" || status === "archived" ? status : "draft";
}
