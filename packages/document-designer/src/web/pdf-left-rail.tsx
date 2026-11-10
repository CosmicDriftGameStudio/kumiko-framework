import { COMPANY_PLACEHOLDERS } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { UploadZone } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { CompanyDataRail } from "./company-data-rail.tsx";
import { RailField, RailHint, RailRow, RailSection } from "./rail.tsx";

const COMPANY_DATA_NAMES: readonly string[] = ["tenantName", ...COMPANY_PLACEHOLDERS];

// unsubscribeUrl belongs to mail.
export function visibleSystemPlaceholders(names: readonly string[]): readonly string[] {
  return names.filter((name) => name !== "unsubscribeUrl");
}

// The company names have their own rail in the PDF designer, so the placeholder lists skip them.
export function railSystemPlaceholders(names: readonly string[]): readonly string[] {
  return visibleSystemPlaceholders(names).filter((name) => !COMPANY_DATA_NAMES.includes(name));
}

// The validation never lists system placeholders as used, so the rail reads the draft itself.
export function placeholdersUsedIn(content: string, names: readonly string[]): ReadonlySet<string> {
  return new Set(
    names.filter(
      (name) => content.includes(`data-variable="${name}"`) || content.includes(`{{${name}}}`),
    ),
  );
}

export function companyNamesUsedIn(content: string): ReadonlySet<string> {
  return placeholdersUsedIn(content, COMPANY_DATA_NAMES);
}

export function withoutCompanyNames<T>(
  variables: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  return Object.fromEntries(
    Object.entries(variables).filter(([name]) => !COMPANY_DATA_NAMES.includes(name)),
  );
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function PdfResourceSection({
  resourceKeys,
  canUpload,
  filesAvailable,
  layoutName,
  onInsert,
  onUpload,
}: {
  readonly resourceKeys: readonly string[];
  readonly canUpload: boolean;
  readonly filesAvailable: boolean;
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
        {canUpload && filesAvailable ? (
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
      {!filesAvailable && <RailHint>{t("documentDesigner.resources.noFilesFeature")}</RailHint>}
      {filesAvailable && !canUpload && (
        <RailHint>{t("documentDesigner.resources.saveFirst")}</RailHint>
      )}
      <RailHint>{t("documentDesigner.placeholders.layoutHint", { layout: layoutName })}</RailHint>
    </RailSection>
  );
}

// Company data of the tenant as placeholders, shown in the left rail beside the resources.
export function PdfCompanyDataSection({
  onInsertPlaceholder,
  used,
}: {
  readonly onInsertPlaceholder: (name: string) => void;
  readonly used: ReadonlySet<string>;
}): ReactNode {
  return <CompanyDataRail onInsert={onInsertPlaceholder} used={used} />;
}
