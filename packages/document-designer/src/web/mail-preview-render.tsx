import type { ReactNode } from "react";
import type { MailEditorBodyProps } from "./mail-editor-logic.ts";
import { previewPayload } from "./mail-editor-logic.ts";
import type { MailEditorModel } from "./mail-editor-model.ts";
import { MailPreviewMode } from "./mail-preview.tsx";

export function renderMailPreview(
  props: MailEditorBodyProps,
  m: MailEditorModel,
  controls: ReactNode,
  origin: React.ComponentProps<typeof MailPreviewMode>["origin"],
): ReactNode {
  const { ui, services } = m;
  const { testMail } = services;
  return (
    <MailPreviewMode
      payload={previewPayload({
        slug: props.slug,
        locale: props.locale,
        settled: ui.settled,
        variableSchema: m.variableSchema,
        pickedVariables: m.pickedVariables,
      })}
      picked={m.picked}
      onPick={m.setPicked}
      validation={m.validation ?? null}
      slug={props.slug}
      locale={props.locale}
      fromName={ui.settled.senderName}
      own={services.own}
      origin={origin}
      controls={controls}
      testMail={{
        availability: testMail.availability,
        pending: testMail.pending,
        onSend: m.sendTestMail,
        includeAttachments: ui.includeAttachments,
        onIncludeAttachments: ui.setIncludeAttachments,
        prefixSubject: ui.prefixSubject,
        onPrefixSubject: ui.setPrefixSubject,
      }}
    />
  );
}
