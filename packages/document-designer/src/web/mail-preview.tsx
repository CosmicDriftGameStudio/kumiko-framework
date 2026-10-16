// @runtime client
import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { LoadingState, ModeSwitch } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import { formatKilobytes } from "./mail-draft.js";
import { PreviewSide } from "./mail-preview-side.js";
import type { MailPreview, MailValidation, PreviewAttachment } from "./mail-types.js";

type PreviewFormat = "html" | "text";
type PreviewWidth = "desktop" | "mobile";

export type PreviewPayload = {
  readonly slug: string;
  readonly kind: "mail";
  readonly locale: string;
  readonly content: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly variableSchema: unknown;
};

function attachmentText(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  attachment: PreviewAttachment,
): string | null {
  switch (attachment.kind) {
    case "inline":
      return null;
    case "file":
      return `⎘ ${attachment.name} · ${formatKilobytes(attachment.sizeBytes)}`;
    case "rendered-pdf":
      return `⎘ ${attachment.name} · ${t("documentDesigner.mail.preview.generatedOnSend")}`;
  }
}

function MailFrame({
  preview,
  format,
  width,
}: {
  readonly preview: MailPreview;
  readonly format: PreviewFormat;
  readonly width: PreviewWidth;
}): ReactNode {
  const t = useTranslation();
  const attachments = preview.attachments.flatMap((a) => attachmentText(t, a) ?? []);
  return (
    <div
      className="flex flex-col overflow-hidden rounded-md border"
      data-testid="mail-preview-frame"
    >
      <div className="flex flex-col gap-1 border-b bg-muted px-4 py-3 text-sm">
        <div className="flex gap-3">
          <span className="w-16 shrink-0 text-muted-foreground">
            {t("documentDesigner.mail.meta.subject")}
          </span>
          <span className="font-medium" data-testid="mail-preview-subject">
            {preview.subject ?? ""}
          </span>
        </div>
        {attachments.length > 0 && (
          <div className="flex gap-3">
            <span className="w-16 shrink-0 text-muted-foreground">
              {t("documentDesigner.mail.preview.attachments")}
            </span>
            <span className="flex flex-col" data-testid="mail-preview-attachments">
              {attachments.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
          </div>
        )}
      </div>
      {format === "html" ? (
        <iframe
          title={t("documentDesigner.mail.preview.frameTitle")}
          sandbox=""
          srcDoc={preview.displayHtml ?? preview.html}
          className={`h-[560px] border-0 bg-background ${width === "mobile" ? "w-[375px] self-center" : "w-full"}`}
          data-testid="mail-preview-iframe"
        />
      ) : (
        <pre
          className="h-[560px] overflow-auto whitespace-pre-wrap p-4 font-mono text-sm"
          data-testid="mail-preview-text"
        >
          {preview.text ?? ""}
        </pre>
      )}
    </div>
  );
}

function layoutText(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  preview: MailPreview | null,
): string {
  return preview?.layout == null
    ? t("documentDesigner.mail.preview.barPlain")
    : t("documentDesigner.mail.preview.bar", { layout: preview.layout.slug });
}

export function MailPreviewMode({
  payload,
  validation,
  slug,
  locale,
  testMail,
}: {
  readonly payload: PreviewPayload;
  readonly validation: MailValidation | null;
  readonly slug: string;
  readonly locale: string;
  readonly testMail: { readonly pending: boolean; readonly onSend: () => void };
}): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  const [format, setFormat] = useState<PreviewFormat>("html");
  const [width, setWidth] = useState<PreviewWidth>("desktop");
  const query = useQuery<MailPreview>(TemplateResolverQueries.preview, payload);
  const preview = query.data;

  return (
    <div className="flex flex-col gap-3" data-testid="mail-editor-preview">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted px-4 py-2.5">
        <span className="text-sm" data-testid="mail-preview-bar">
          {layoutText(t, preview)}
        </span>
        <div className="grow" />
        <ModeSwitch<PreviewFormat>
          value={format}
          onChange={setFormat}
          ariaLabel={t("documentDesigner.mail.preview.formatSwitch")}
          testId="mail-preview-format"
          options={[
            { value: "html", label: t("documentDesigner.mail.preview.html") },
            { value: "text", label: t("documentDesigner.mail.preview.text") },
          ]}
        />
        <ModeSwitch<PreviewWidth>
          value={width}
          onChange={setWidth}
          ariaLabel={t("documentDesigner.mail.preview.widthSwitch")}
          testId="mail-preview-width"
          options={[
            { value: "desktop", label: t("documentDesigner.mail.preview.desktop") },
            { value: "mobile", label: t("documentDesigner.mail.preview.mobile") },
          ]}
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3">
          {query.error !== null && (
            <Banner variant="error" testId="mail-preview-error">
              {dispatcherErrorText(query.error, t)}
            </Banner>
          )}
          {preview === null ? (
            query.error === null && <LoadingState />
          ) : (
            <MailFrame preview={preview} format={format} width={width} />
          )}
        </div>
        <PreviewSide
          preview={preview}
          validation={validation}
          slug={slug}
          locale={locale}
          testMail={testMail}
        />
      </div>
    </div>
  );
}
