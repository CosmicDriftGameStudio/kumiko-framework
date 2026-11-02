import {
  dispatcherErrorText,
  type PreviewRenderer,
  type PreviewRendererProps,
  substituteVariables,
  useDebouncedValue,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import {
  HtmlMailFrame,
  LoadingState,
  ModeSwitch,
  type PreviewDevice,
  PreviewWidthFrame,
} from "@cosmicdrift/kumiko-renderer/web";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useState } from "react";
import { TemplateResolverQueries } from "./qualified-names.ts";

const PREVIEW_DEBOUNCE_MS = 300;

function htmlOf(value: unknown): string | null {
  return isPlainObject(value) && typeof value["html"] === "string" ? value["html"] : null;
}

export function stringExamples(
  variables: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const strings: Record<string, string> = {};
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === "string") strings[name] = value;
  }
  return strings;
}

// The paper frame around a rendered body, with the optional Desktop/Mobil width switch of the web
// target. A null `html` is still loading unless `notice` (an error banner) explains the gap.
export function HtmlPaperFrame({
  html,
  devices,
  notice,
}: {
  readonly html: string | null;
  readonly devices: boolean;
  readonly notice?: ReactNode;
}): ReactNode {
  const t = useTranslation();
  const { Card } = usePrimitives();
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-8 py-6">
      {devices && (
        <div className="flex justify-end">
          <ModeSwitch<PreviewDevice>
            value={device}
            onChange={setDevice}
            ariaLabel={t("kumiko.editor.deviceSwitch")}
            testId="web-preview-device-switch"
            options={[
              { value: "desktop", label: t("kumiko.editor.device.desktop") },
              { value: "mobile", label: t("kumiko.editor.device.mobile") },
            ]}
          />
        </div>
      )}
      {notice}
      {html === null ? (
        notice === undefined && <LoadingState />
      ) : (
        <PreviewWidthFrame device={device} testId="web-preview-frame">
          <Card>
            <HtmlMailFrame
              html={html}
              title={t("template-resolver.preview.frameTitle")}
              allowRemoteImages
              testId="web-preview-iframe"
            />
          </Card>
        </PreviewWidthFrame>
      )}
    </div>
  );
}

// Shows server-sanitized body HTML (`template-resolver:query:body-preview`) in the paper frame; the
// same sanitizer and markdown core as the visitor paths of managed-pages and legal-pages, without
// saving.
export function BodyPreviewFrame({
  body,
  bodyFormat,
}: {
  readonly body: string;
  readonly bodyFormat: "markdown" | "document";
}): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  const settled = useDebouncedValue(body, PREVIEW_DEBOUNCE_MS);
  const query = useQuery<unknown>(TemplateResolverQueries.bodyPreview, {
    body: settled,
    bodyFormat,
  });
  return (
    <HtmlPaperFrame
      html={htmlOf(query.data)}
      devices
      notice={
        query.error !== null ? (
          <Banner variant="error" testId="web-preview-error">
            {dispatcherErrorText(query.error, t)}
          </Banner>
        ) : undefined
      }
    />
  );
}

// The "web" target. A plain-text body (legal text with `{{placeholders}}`) is previewed as
// Markdown with the example values filled in.
export const WebPreviewRenderer: PreviewRenderer = ({
  content,
  editFormat,
  variables,
}: PreviewRendererProps): ReactNode => {
  const isDocument = editFormat === "document";
  return (
    <BodyPreviewFrame
      body={isDocument ? content : substituteVariables(content, stringExamples(variables))}
      bodyFormat={isDocument ? "document" : "markdown"}
    />
  );
};
