import type { DocumentFrameControl } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import {
  DIN_5008_FORMS,
  din5008Box,
  type FrameBox,
  frameOverhangOf,
  framePositionOf,
  hasFrameOverhang,
} from "./frame-position.ts";
import type { MarginsMm, PaperSize } from "./paper-geometry.ts";
import { RailField, RailHint, RailSection } from "./rail.tsx";

export type RecipientOption = { readonly value: string; readonly label: string };

const NO_RECIPIENT = "";

const BOX_FIELDS: readonly {
  readonly key: keyof FrameBox;
  readonly testId: string;
  readonly labelKey: string;
  readonly patch: (value: number) => Partial<FrameBox>;
}[] = [
  {
    key: "xMm",
    testId: "frame-x",
    labelKey: "documentDesigner.frame.left",
    patch: (xMm) => ({ xMm }),
  },
  {
    key: "yMm",
    testId: "frame-y",
    labelKey: "documentDesigner.frame.top",
    patch: (yMm) => ({ yMm }),
  },
  {
    key: "widthMm",
    testId: "frame-width",
    labelKey: "documentDesigner.frame.width",
    patch: (widthMm) => ({ widthMm }),
  },
  {
    key: "heightMm",
    testId: "frame-height",
    labelKey: "documentDesigner.frame.height",
    patch: (heightMm) => ({ heightMm }),
  },
];

export function FrameSettingsSection({
  control,
  paper,
  margins,
  recipientOptions,
}: {
  readonly control: DocumentFrameControl;
  readonly paper: PaperSize;
  readonly margins: MarginsMm;
  readonly recipientOptions: readonly RecipientOption[];
}): ReactNode {
  const t = useTranslation();
  const { Button, Field, Input } = usePrimitives();
  const { attrs } = control;
  const isAddress = attrs.preset === "address";
  const overhang = frameOverhangOf(attrs, paper, margins);

  return (
    <RailSection
      title={t(isAddress ? "documentDesigner.frame.titleAddress" : "documentDesigner.frame.title")}
      testId="pdf-editor-frame"
    >
      <RailField>
        {isAddress && (
          <div data-testid="frame-position">
            <Field id="dd-frame-position" label={t("documentDesigner.frame.position")}>
              <Input
                kind="select"
                id="dd-frame-position"
                name="framePosition"
                value={framePositionOf(attrs)}
                onChange={(value) => {
                  const form = DIN_5008_FORMS.find((candidate) => candidate === value);
                  if (form !== undefined) control.update(din5008Box(form));
                }}
                display="dropdown"
                options={[
                  ...DIN_5008_FORMS.map((form) => ({
                    value: form,
                    label: t(`documentDesigner.frame.position.${form}`),
                  })),
                  { value: "free", label: t("documentDesigner.frame.position.free") },
                ]}
              />
            </Field>
          </div>
        )}
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-1 p-0 text-[13px] font-medium text-foreground">
            {t("documentDesigner.frame.positionMm")}
          </legend>
          <div className="grid grid-cols-4 gap-1">
            {BOX_FIELDS.map((field) => (
              <Field key={field.key} id={`dd-${field.testId}`} label={t(field.labelKey)}>
                <Input
                  kind="number"
                  id={`dd-${field.testId}`}
                  name={field.key}
                  value={attrs[field.key]}
                  onChange={(value) => {
                    if (value !== undefined) control.update(field.patch(value));
                  }}
                  testId={field.testId}
                />
              </Field>
            ))}
          </div>
        </fieldset>
        {isAddress && (
          <div data-testid="frame-sender">
            <Field id="dd-frame-sender" label={t("documentDesigner.frame.sender")} layout="inline">
              <Input
                kind="boolean"
                id="dd-frame-sender"
                name="frameSender"
                value={control.senderLine}
                onChange={control.setSenderLine}
              />
            </Field>
          </div>
        )}
        {isAddress && (
          <div data-testid="frame-recipient">
            <Field id="dd-frame-recipient" label={t("documentDesigner.frame.recipient")}>
              <Input
                kind="select"
                id="dd-frame-recipient"
                name="frameRecipient"
                value={control.recipient ?? NO_RECIPIENT}
                onChange={(name) => control.setRecipient(name === NO_RECIPIENT ? null : name)}
                display="dropdown"
                options={[
                  { value: NO_RECIPIENT, label: t("documentDesigner.frame.recipientNone") },
                  ...recipientOptions,
                ]}
              />
            </Field>
          </div>
        )}
        <div data-testid="frame-reserve-flow">
          <Field
            id="dd-frame-reserve-flow"
            label={t("documentDesigner.frame.reserveFlow")}
            layout="inline"
          >
            <Input
              kind="boolean"
              id="dd-frame-reserve-flow"
              name="frameReserveFlow"
              value={attrs.reserveFlow}
              onChange={(reserveFlow) => control.update({ reserveFlow })}
            />
          </Field>
        </div>
      </RailField>
      {isAddress && <RailHint>{t("documentDesigner.frame.positionHint")}</RailHint>}
      {hasFrameOverhang(overhang) && (
        <div data-testid="frame-margin-hint">
          <RailHint>
            {overhang.beyondPaper
              ? t("documentDesigner.frame.beyondPaper")
              : t("documentDesigner.frame.intoMargin")}
          </RailHint>
        </div>
      )}
      <div className="flex justify-start px-3.5 pb-2">
        <Button variant="danger-ghost" size="sm" onClick={control.remove} testId="frame-remove">
          {t(isAddress ? "documentDesigner.frame.removeAddress" : "documentDesigner.frame.remove")}
        </Button>
      </div>
    </RailSection>
  );
}
