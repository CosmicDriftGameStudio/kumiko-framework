// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { displayValue } from "./mail-draft.js";
import type { MailPreview, MailValidation, PreviewCheck } from "./mail-types.js";
import { usePreviewRecordPicker } from "./preview-record-picker.js";
import { RailHint, RailRow, RailSection } from "./rail.js";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

// Check params list names as arrays; the message templates expect one string.
function checkText(t: Translate, check: PreviewCheck): string {
  const params = Object.fromEntries(
    Object.entries(check.params ?? {}).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(", ") : value,
    ]),
  );
  const translated = t(check.i18nKey, params);
  return translated === check.i18nKey ? check.code : translated;
}

function SampleValues({
  preview,
  validation,
  picked,
}: {
  readonly preview: MailPreview | null;
  readonly validation: MailValidation | null;
  readonly picked: Readonly<Record<string, unknown>> | null;
}): ReactNode {
  const t = useTranslation();
  const values = { ...(preview?.sampleValues ?? {}), ...(picked ?? {}) };
  const names = Object.keys(validation?.variables ?? values);
  return (
    <>
      {names.map((name) => {
        const missing = validation?.missingRequired.includes(name) === true;
        return (
          <RailRow
            key={name}
            testId={`mail-sample-${name}`}
            label={validation?.variables[name]?.label ?? name}
            bad={missing}
            trailing={
              missing
                ? t("documentDesigner.mail.preview.missingInContent")
                : displayValue(t, values[name])
            }
          />
        );
      })}
    </>
  );
}

function RecordPickerLink({
  slug,
  locale,
  onPick,
}: {
  readonly slug: string;
  readonly locale: string;
  readonly onPick: (values: Readonly<Record<string, unknown>>) => void;
}): ReactNode {
  const picker = usePreviewRecordPicker();
  const { Button, Modal } = usePrimitives();
  const [open, setOpen] = useState(false);
  if (picker === null) return null;
  return (
    <>
      <Button variant="link" onClick={() => setOpen(true)} testId="mail-record-picker-open">
        {picker.label}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={picker.label}
        testId="mail-record-picker-modal"
      >
        {picker.renderPicker({
          slug,
          locale,
          onPick: (values) => {
            onPick(values);
            setOpen(false);
          },
        })}
      </Modal>
    </>
  );
}

export function PreviewSide({
  preview,
  validation,
  slug,
  locale,
  testMail,
}: {
  readonly preview: MailPreview | null;
  readonly validation: MailValidation | null;
  readonly slug: string;
  readonly locale: string;
  readonly testMail: { readonly pending: boolean; readonly onSend: () => void };
}): ReactNode {
  const t = useTranslation();
  const { Button, Field, Text } = usePrimitives();
  const [picked, setPicked] = useState<Readonly<Record<string, unknown>> | null>(null);
  return (
    <div className="flex flex-col" data-testid="mail-preview-side">
      <RailSection
        title={t("documentDesigner.mail.preview.samples")}
        action={<RecordPickerLink slug={slug} locale={locale} onPick={setPicked} />}
      >
        <SampleValues preview={preview} validation={validation} picked={picked} />
        <RailHint>{t("documentDesigner.mail.preview.samplesHint")}</RailHint>
      </RailSection>
      <RailSection title={t("documentDesigner.mail.testMail.title")}>
        <div className="flex flex-col gap-2 px-2">
          <Field id="mail-test-recipient" label={t("documentDesigner.mail.testMail.recipient")}>
            <Text>{t("documentDesigner.mail.testMail.ownAddress")}</Text>
          </Field>
          <Text variant="muted">✓ {t("documentDesigner.mail.testMail.prefix")}</Text>
          <Text variant="muted">✓ {t("documentDesigner.mail.testMail.attachments")}</Text>
          <Button
            variant="secondary"
            disabled={testMail.pending}
            loading={testMail.pending}
            onClick={testMail.onSend}
            testId="mail-test-send"
          >
            {t("documentDesigner.mail.testMail.send")}
          </Button>
        </div>
        <RailHint>{t("documentDesigner.mail.testMail.hint")}</RailHint>
      </RailSection>
      <RailSection title={t("documentDesigner.mail.preview.checks")} testId="mail-preview-checks">
        {(preview?.checks ?? []).map((check) => (
          <RailRow
            key={check.code}
            testId={`mail-check-${check.code}`}
            symbol={check.ok ? "✓" : "!"}
            label={checkText(t, check)}
            bad={!check.ok}
          />
        ))}
      </RailSection>
    </div>
  );
}
