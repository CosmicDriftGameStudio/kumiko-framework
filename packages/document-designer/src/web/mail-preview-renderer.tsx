import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  type PreviewRenderer,
  type PreviewRendererProps,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { LoadingState } from "@cosmicdrift/kumiko-renderer/web";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { formatKilobytes } from "./mail-draft.ts";
import type { MailPreview, PreviewAttachment } from "./mail-types.ts";
import type { OwnAddress } from "./use-own-address.ts";

export type PreviewFormat = "html" | "text";
export type PreviewWidth = "desktop" | "mobile";

/** View state the mail editor keeps in its info bar; the renderer shows what it says. */
export type MailPreviewView = {
  readonly format: PreviewFormat;
  readonly width: PreviewWidth;
  readonly fromName: string;
  readonly own: OwnAddress | null;
};

const DEFAULT_VIEW: MailPreviewView = { format: "html", width: "desktop", fromName: "", own: null };

export const MailPreviewViewContext = createContext<MailPreviewView>(DEFAULT_VIEW);

export function isMailPreview(value: unknown): value is MailPreview {
  return isPlainObject(value) && typeof value["html"] === "string";
}

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

function attachmentText(t: Translate, attachment: PreviewAttachment): string | null {
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

// The preview mail goes to the example recipient of the sample values, not to the test-mail address.
function recipientOf(preview: MailPreview, own: OwnAddress | null): string | null {
  const { recipientName: name, recipientEmail: email } = preview.sampleValues;
  if (typeof name !== "string" || name === "") return own?.email ?? null;
  return typeof email === "string" && email !== "" ? `${name} <${email}>` : name;
}

function MailFrame({
  preview,
  view,
}: {
  readonly preview: MailPreview;
  readonly view: MailPreviewView;
}): ReactNode {
  const t = useTranslation();
  const { format, width, fromName } = view;
  const recipient = recipientOf(preview, view.own);
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

// The mail target: renders through `query:preview` (admin access), which composes the layout,
// substitutes sample values and returns subject, html and text.
export const MailPreviewRenderer: PreviewRenderer = ({
  content,
  variables,
  subject,
  onResult,
}: PreviewRendererProps): ReactNode => {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  const view = useContext(MailPreviewViewContext);
  const hasVariables = Object.keys(variables).length > 0;
  const query = useQuery<MailPreview>(
    TemplateResolverQueries.preview,
    {
      slug: subject.kind === "template" ? subject.slug : "",
      kind: "mail",
      locale: subject.kind === "template" ? subject.locale : "",
      content,
      meta: subject.kind === "template" ? subject.meta : {},
      variableSchema: subject.kind === "template" ? subject.variableSchema : undefined,
      ...(hasVariables && { variables }),
    },
    { enabled: subject.kind === "template" },
  );
  const preview = query.data;
  useEffect(() => {
    onResult?.(preview);
  }, [preview, onResult]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-8 py-6">
      {query.error !== null && (
        <Banner variant="error" testId="mail-preview-error">
          {dispatcherErrorText(query.error, t)}
        </Banner>
      )}
      {preview === null ? (
        query.error === null && <LoadingState />
      ) : (
        <MailFrame preview={preview} view={view} />
      )}
    </div>
  );
};
