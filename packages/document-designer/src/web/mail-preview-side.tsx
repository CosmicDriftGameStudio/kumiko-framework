// @runtime client
import { useNav, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { displayValue } from "./mail-draft.ts";
import type { MailPreview, MailValidation, PreviewCheck } from "./mail-types.ts";
import { usePreviewRecordPicker } from "./preview-record-picker.tsx";
import { RailField, RailHint, RailRow, RailSection } from "./rail.tsx";
import type { OwnAddress } from "./use-own-address.ts";
import { variableLabelText } from "./used-by-label.ts";

const noop = (): void => undefined;

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
            label={variableLabelText(t, name, validation?.variables[name]?.label)}
            nameHint={name}
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

export type TestMailControls = {
  readonly pending: boolean;
  readonly onSend: () => void;
  readonly includeAttachments: boolean;
  readonly onIncludeAttachments: (next: boolean) => void;
  readonly prefixSubject: boolean;
  readonly onPrefixSubject: (next: boolean) => void;
};

function TestMailRecipient({ own }: { readonly own: OwnAddress }): ReactNode {
  const t = useTranslation();
  const nav = useNav();
  const { Field, Input, Link } = usePrimitives();
  const { profileScreenId } = own;
  return (
    <RailField>
      <Field id="mail-test-recipient" label={t("documentDesigner.mail.testMail.recipient")}>
        <Input
          kind="text"
          id="mail-test-recipient"
          name="mail-test-recipient"
          testId="mail-test-recipient"
          value={own.email ?? t("documentDesigner.mail.testMail.ownAddress")}
          onChange={noop}
          disabled
        />
      </Field>
      {profileScreenId !== null && (
        <Link
          href={nav.hrefFor({ screenId: profileScreenId })}
          onPress={() => nav.navigate({ screenId: profileScreenId })}
          testId="mail-test-recipient-edit"
        >
          {t("documentDesigner.mail.testMail.changeAddress")}
        </Link>
      )}
    </RailField>
  );
}

export function PreviewSide({
  preview,
  validation,
  slug,
  locale,
  own,
  testMail,
}: {
  readonly preview: MailPreview | null;
  readonly validation: MailValidation | null;
  readonly slug: string;
  readonly locale: string;
  readonly own: OwnAddress;
  readonly testMail: TestMailControls;
}): ReactNode {
  const t = useTranslation();
  const { Button, Field, Input, Text } = usePrimitives();
  const hasAttachments = preview?.attachments.some((a) => a.kind !== "inline") === true;
  const [picked, setPicked] = useState<Readonly<Record<string, unknown>> | null>(null);
  return (
    <div data-testid="mail-preview-side">
      <RailSection
        title={t("documentDesigner.mail.preview.samples")}
        action={<RecordPickerLink slug={slug} locale={locale} onPick={setPicked} />}
      >
        <SampleValues preview={preview} validation={validation} picked={picked} />
        <RailHint>{t("documentDesigner.mail.preview.samplesHint")}</RailHint>
      </RailSection>
      <RailSection title={t("documentDesigner.mail.testMail.title")}>
        <TestMailRecipient own={own} />
        <RailField>
          <Field
            id="mail-test-prefix"
            label={t("documentDesigner.mail.testMail.prefixSubject")}
            layout="inline"
          >
            <Input
              kind="boolean"
              id="mail-test-prefix"
              name="mail-test-prefix"
              value={testMail.prefixSubject}
              onChange={testMail.onPrefixSubject}
            />
          </Field>
          {hasAttachments ? (
            <Field
              id="mail-test-attachments"
              label={t("documentDesigner.mail.testMail.attachments")}
              layout="inline"
            >
              <Input
                kind="boolean"
                id="mail-test-attachments"
                name="mail-test-attachments"
                value={testMail.includeAttachments}
                onChange={testMail.onIncludeAttachments}
              />
            </Field>
          ) : (
            <Text variant="muted" testId="mail-test-no-attachments">
              {t("documentDesigner.mail.testMail.noAttachments")}
            </Text>
          )}
          <Button
            variant="secondary"
            width="full"
            disabled={testMail.pending}
            loading={testMail.pending}
            onClick={testMail.onSend}
            testId="mail-test-send"
          >
            {t("documentDesigner.mail.testMail.send")}
          </Button>
        </RailField>
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
        <RailHint>{t("documentDesigner.mail.preview.checksHint")}</RailHint>
      </RailSection>
    </div>
  );
}
