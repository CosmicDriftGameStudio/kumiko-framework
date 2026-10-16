// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { UploadZone } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { RailField, RailHint, RailRow, RailSection } from "./rail.js";

// unsubscribeUrl belongs to mail; the PDF designer never offers it.
const HIDDEN_SYSTEM_PLACEHOLDERS: ReadonlySet<string> = new Set(["unsubscribeUrl"]);

export function visibleSystemPlaceholders(names: readonly string[]): readonly string[] {
  return names.filter((name) => !HIDDEN_SYSTEM_PLACEHOLDERS.has(name));
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function PdfResourceSection({
  resourceKeys,
  canUpload,
  layoutName,
  onInsert,
  onUpload,
}: {
  readonly resourceKeys: readonly string[];
  readonly canUpload: boolean;
  readonly layoutName: string;
  readonly onInsert: (key: string) => void;
  readonly onUpload: (file: File) => Promise<void>;
}): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  return (
    <RailSection title={t("documentDesigner.resources.title")} testId="pdf-editor-resources">
      {resourceKeys.length === 0 && <RailRow label={t("documentDesigner.resources.empty")} />}
      {resourceKeys.map((key) => (
        <RailRow
          key={key}
          testId={`pdf-resource-${key}`}
          symbol="▣"
          label={key}
          onPress={() => onInsert(key)}
        />
      ))}
      <RailField>
        {canUpload ? (
          <UploadZone
            multiple={false}
            accept={IMAGE_TYPES}
            title={t("documentDesigner.resources.upload")}
            onUpload={onUpload}
            testId="document-designer-upload"
          />
        ) : (
          <Button variant="secondary" size="sm" disabled>
            {t("documentDesigner.resources.upload")}
          </Button>
        )}
      </RailField>
      {!canUpload && <RailHint>{t("documentDesigner.resources.saveFirst")}</RailHint>}
      <RailHint>{t("documentDesigner.placeholders.layoutHint", { layout: layoutName })}</RailHint>
    </RailSection>
  );
}
