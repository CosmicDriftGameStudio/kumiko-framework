import { type ColumnRendererProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { Icon, type NavIconKey } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";

const KIND_ICON: Readonly<Record<string, NavIconKey>> = {
  device: "server",
  folder: "folder",
  file: "file",
};

// Folders and devices open on click: bold, in the active hue (primary is near-black in this theme) with a tinted icon; files stay regular and muted.
export function FileNameCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  const kind = String(row["kind"]);
  const opens = kind !== "file" && row["deleting"] !== true;
  const container = kind !== "file";
  const tone = opens
    ? "cursor-pointer font-semibold text-status-active"
    : container
      ? "font-semibold"
      : "font-normal text-foreground";
  return (
    <span
      className={`inline-flex items-center gap-2 ${row["deleting"] === true ? "text-muted-foreground" : tone}`}
    >
      <Icon
        name={KIND_ICON[kind] ?? "file"}
        className={`size-4 shrink-0 ${container ? "fill-status-active/25" : "text-muted-foreground"}`}
      />
      <span>{String(row["name"])}</span>
      {row["deleting"] === true ? (
        <span className="text-xs italic">{t("connectors.files.deleting")}</span>
      ) : null}
    </span>
  );
}
