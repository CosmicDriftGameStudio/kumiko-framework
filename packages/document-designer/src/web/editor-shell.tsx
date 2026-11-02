import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  type EditorActionTestIds,
  type InfoBarTone,
  EditorFooter as WorkbenchFooter,
  EditorInfoBar as WorkbenchInfoBar,
} from "@cosmicdrift/kumiko-renderer/web";
import type { ComponentProps, ReactNode } from "react";
import { type EditorOrigin, OriginBadge } from "./editor-header.tsx";

export type { FooterTone, InfoBarTone } from "@cosmicdrift/kumiko-renderer/web";
export { EditorBody, EditorFrame } from "@cosmicdrift/kumiko-renderer/web";

const DESIGNER_ACTION_TEST_IDS: EditorActionTestIds = {
  discard: "document-designer-discard",
  save: "document-designer-save",
  publish: "document-designer-publish",
};

export function EditorInfoBar({
  origin,
  ...props
}: Omit<ComponentProps<typeof WorkbenchInfoBar>, "origin" | "tone"> & {
  readonly tone: InfoBarTone;
  readonly origin?: EditorOrigin | null;
}): ReactNode {
  return (
    <WorkbenchInfoBar
      {...props}
      origin={origin == null ? undefined : <OriginBadge origin={origin} />}
    />
  );
}

export function EditorFooter(
  props: Omit<
    ComponentProps<typeof WorkbenchFooter>,
    "actionTestIds" | "pendingMessage" | "onPublish" | "canPublish"
  > & { readonly canPublish: boolean; readonly onPublish: () => void },
): ReactNode {
  const t = useTranslation();
  return (
    <WorkbenchFooter
      {...props}
      actionTestIds={DESIGNER_ACTION_TEST_IDS}
      pendingMessage={t("documentDesigner.editor.footer.checking")}
    />
  );
}
