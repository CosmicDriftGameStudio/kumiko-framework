import { PreviewPane, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ModeSwitch } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { EditorOrigin } from "./editor-header.tsx";
import { EditorBody, EditorInfoBar } from "./editor-shell.tsx";
import {
  isMailPreview,
  MailPreviewViewContext,
  type PreviewFormat,
  type PreviewWidth,
} from "./mail-preview-renderer.tsx";
import { PreviewSide, type TestMailControls } from "./mail-preview-side.tsx";
import type { MailPreview, MailValidation, PickedValues } from "./mail-types.ts";
import type { OwnAddress } from "./use-own-address.ts";

export type PreviewPayload = {
  readonly slug: string;
  readonly kind: "mail";
  readonly locale: string;
  readonly content: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly variableSchema: unknown;
  readonly variables?: PickedValues;
};

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
  const [format, setFormat] = useState<PreviewFormat>("html");
  const [width, setWidth] = useState<PreviewWidth>("desktop");
  const [preview, setPreview] = useState<MailPreview | null>(null);
  const onResult = useCallback(
    (result: unknown) => setPreview(isMailPreview(result) ? result : null),
    [],
  );
  const view = useMemo(() => ({ format, width, fromName, own }), [format, width, fromName, own]);

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
          <MailPreviewViewContext.Provider value={view}>
            <PreviewPane
              target="mail"
              content={payload.content}
              editFormat="document"
              variables={payload.variables ?? {}}
              subject={{
                kind: "template",
                templateKind: payload.kind,
                slug: payload.slug,
                locale: payload.locale,
                meta: payload.meta,
                variableSchema: payload.variableSchema,
              }}
              onResult={onResult}
            />
          </MailPreviewViewContext.Provider>
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
