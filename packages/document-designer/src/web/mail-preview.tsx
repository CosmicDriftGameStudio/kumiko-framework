import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { LoadingState, ModeSwitch } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";
import type { EditorOrigin } from "./editor-header.tsx";
import { EditorBody, EditorInfoBar } from "./editor-shell.tsx";
import { formatKilobytes } from "./mail-draft.ts";
import { PreviewSide, type TestMailControls } from "./mail-preview-side.tsx";
import type { MailPreview, MailValidation, PickedValues, PreviewAttachment } from "./mail-types.ts";
import type { OwnAddress } from "./use-own-address.ts";

type PreviewFormat = "html" | "text";
type PreviewWidth = "desktop" | "mobile";

export type PreviewPayload = {
  readonly slug: string;
  readonly kind: "mail";
  readonly locale: string;
  readonly content: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly variableSchema: unknown;
  readonly variables?: PickedValues;
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

function HeadRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </>
  );
}

function MailFrame({
  preview,
  format,
  width,
  fromName,
  recipient,
}: {
  readonly preview: MailPreview;
  readonly format: PreviewFormat;
  readonly width: PreviewWidth;
  readonly fromName: string;
  readonly recipient: string | null;
}): ReactNode {
  const t = useTranslation();
  const attachments = preview.attachments.flatMap((a) => attachmentText(t, a) ?? []);
  return (
    <div
      className="mx-auto flex min-h-0 w-full max-w-[680px] flex-1 flex-col border bg-card shadow-md"
      data-testid="mail-preview-frame"
    >
      <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-y-1 border-b px-5 py-3.5 text-sm">
        <HeadRow label={t("documentDesigner.mail.preview.from")}>
          <span data-testid="mail-preview-from">
            {fromName === "" ? t("documentDesigner.mail.props.senderDefault") : fromName}
          </span>
        </HeadRow>
        {recipient !== null && (
          <HeadRow label={t("documentDesigner.mail.preview.to")}>
            <span data-testid="mail-preview-to">{recipient}</span>
          </HeadRow>
        )}
        <HeadRow label={t("documentDesigner.mail.meta.subject")}>
          <span className="font-medium" data-testid="mail-preview-subject">
            {preview.subject ?? ""}
          </span>
        </HeadRow>
        {attachments.length > 0 && (
          <HeadRow label={t("documentDesigner.mail.preview.attachments")}>
            <span
              className="flex flex-col items-start gap-1"
              data-testid="mail-preview-attachments"
            >
              {attachments.map((line) => (
                <span key={line} className="rounded border bg-muted px-2 py-0.5 text-xs">
                  {line}
                </span>
              ))}
            </span>
          </HeadRow>
        )}
      </div>
      {format === "html" ? (
        <iframe
          title={t("documentDesigner.mail.preview.frameTitle")}
          sandbox=""
          srcDoc={preview.displayHtml ?? preview.html}
          className={`min-h-[420px] flex-1 border-0 bg-background ${width === "mobile" ? "w-[375px] self-center" : "w-full"}`}
          data-testid="mail-preview-iframe"
        />
      ) : (
        <pre
          className="min-h-[420px] flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-sm"
          data-testid="mail-preview-text"
        >
          {preview.text ?? ""}
        </pre>
      )}
    </div>
  );
}

// The preview mail goes to the example recipient of the sample values, not to the test-mail address.
function recipientOf(preview: MailPreview, own: OwnAddress): string | null {
  const { recipientName: name, recipientEmail: email } = preview.sampleValues;
  if (typeof name !== "string" || name === "") return own.email;
  return typeof email === "string" && email !== "" ? `${name} <${email}>` : name;
}

function layoutText(
  t: (key: string, params?: Readonly<Record<string, unknown>>) => string,
  preview: MailPreview | null,
): string {
  return preview?.mailLayout == null
    ? t("documentDesigner.mail.preview.barPlain")
    : t("documentDesigner.mail.preview.bar", { version: preview.mailLayout.version });
}

export function MailPreviewMode({
  payload,
  validation,
  slug,
  locale,
  fromName,
  own,
  controls,
  origin,
  testMail,
  picked,
  onPick,
}: {
  readonly picked: PickedValues | null;
  readonly onPick: (values: PickedValues) => void;
  readonly payload: PreviewPayload;
  readonly validation: MailValidation | null;
  readonly slug: string;
  readonly locale: string;
  readonly fromName: string;
  readonly own: OwnAddress;
  readonly controls: ReactNode;
  readonly origin: EditorOrigin | null;
  readonly testMail: TestMailControls;
}): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  const [format, setFormat] = useState<PreviewFormat>("html");
  const [width, setWidth] = useState<PreviewWidth>("desktop");
  const query = useQuery<MailPreview>(TemplateResolverQueries.preview, payload);
  const preview = query.data;

  return (
    <>
      <EditorInfoBar
        tone="muted"
        testId="mail-preview-bar"
        origin={origin}
        controls={controls}
        links={
          <>
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
          </>
        }
      >
        {layoutText(t, preview)}
      </EditorInfoBar>
      <EditorBody
        testId="mail-editor-preview"
        center={
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-8 py-6">
            {query.error !== null && (
              <Banner variant="error" testId="mail-preview-error">
                {dispatcherErrorText(query.error, t)}
              </Banner>
            )}
            {preview === null ? (
              query.error === null && <LoadingState />
            ) : (
              <MailFrame
                preview={preview}
                format={format}
                width={width}
                fromName={fromName}
                recipient={recipientOf(preview, own)}
              />
            )}
          </div>
        }
        right={
          <PreviewSide
            preview={preview}
            validation={validation}
            slug={slug}
            locale={locale}
            own={own}
            testMail={testMail}
            picked={picked}
            onPick={onPick}
          />
        }
      />
    </>
  );
}
