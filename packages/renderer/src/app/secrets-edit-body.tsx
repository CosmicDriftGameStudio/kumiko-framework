import type { SecretsEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useDispatcher } from "../context/dispatcher-context";
import { useQuery } from "../hooks/use-query";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import { dispatcherErrorText } from "./write-failed-error";

type SecretListRow = {
  readonly key: string;
  readonly redactedPreview: string | null;
  readonly hint: string | null;
};

export type SecretsEditBodyProps = {
  readonly screen: SecretsEditScreenDefinition;
  readonly translate?: Translate;
};

// secrets:query:list never returns plaintext (only a redacted preview), so
// unlike ConfigEditBody there is no server value to pre-fill a draft with —
// every input starts at "" and stays that way unless the user types into it.
export function SecretsEditBody({ screen, translate }: SecretsEditBodyProps): ReactNode {
  const { Banner, Form, Section, Field, Input, Button, Text } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const dispatcher = useDispatcher();
  const listQuery = useQuery<readonly SecretListRow[]>("secrets:query:list", {});

  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const rowsByQualifiedKey = useMemo(() => {
    const out = new Map<string, SecretListRow>();
    for (const row of listQuery.data ?? []) out.set(row.key, row);
    return out;
  }, [listQuery.data]);

  const setDraft = useCallback((fieldId: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const commands = Object.entries(screen.secretKeys).flatMap(([fieldId, qualified]) => {
      const value = drafts[fieldId]?.trim();
      return value ? [{ type: "secrets:write:set", payload: { key: qualified, value } }] : [];
    });
    if (commands.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await dispatcher.batch(commands);
    setSubmitting(false);
    if (!result.isSuccess) {
      setSubmitError(dispatcherErrorText(result.error, effectiveTranslate));
      return;
    }
    setDrafts({});
    await listQuery.refetch();
  }, [dispatcher, drafts, screen.secretKeys, listQuery.refetch, effectiveTranslate]);

  const handleDelete = useCallback(
    async (qualified: string): Promise<void> => {
      const result = await dispatcher.write("secrets:write:delete", { key: qualified });
      if (!result.isSuccess) {
        setSubmitError(dispatcherErrorText(result.error, effectiveTranslate));
        return;
      }
      await listQuery.refetch();
    },
    [dispatcher, listQuery.refetch, effectiveTranslate],
  );

  if (listQuery.loading && listQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (listQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(listQuery.error, effectiveTranslate)}
      </Banner>
    );
  }

  return (
    <Form
      onSubmit={() => {
        void handleSubmit();
      }}
      testId="secrets-edit-form"
      actions={
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          disabled={submitting}
          testId="secrets-edit-submit"
        >
          {effectiveTranslate("kumiko.actions.save")}
        </Button>
      }
    >
      {submitError !== null && (
        <Banner variant="error" testId="secrets-edit-error">
          {submitError}
        </Banner>
      )}
      {screen.sections.map((section, index) => (
        <Section
          key={section.title ?? `section-${index}`}
          {...(section.title !== undefined && { title: effectiveTranslate(section.title) })}
        >
          {section.fields.map((fieldId) => {
            const qualified = screen.secretKeys[fieldId];
            if (qualified === undefined) return null;
            const row = rowsByQualifiedKey.get(qualified);
            const hintKey = screen.fieldHints?.[fieldId];
            const isRequired = screen.requiredFields?.includes(fieldId) ?? false;
            return (
              <Field
                key={fieldId}
                id={fieldId}
                label={effectiveTranslate(screen.fieldLabels[fieldId] ?? fieldId)}
                required={isRequired}
                testId={`field-${fieldId}`}
                fieldAppendix={
                  <>
                    {hintKey !== undefined && (
                      <Text variant="small">{effectiveTranslate(hintKey)}</Text>
                    )}
                    {row !== undefined ? (
                      <>
                        <Text variant="small" testId={`secret-preview-${fieldId}`}>
                          {row.redactedPreview ?? effectiveTranslate("config.secrets.set")}
                        </Text>
                        <Button
                          type="button"
                          variant="danger-ghost"
                          size="sm"
                          onClick={() => handleDelete(qualified)}
                          testId={`secret-delete-${fieldId}`}
                        >
                          {effectiveTranslate("config.secrets.delete")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Text variant="small" testId={`secret-not-set-${fieldId}`}>
                          {effectiveTranslate("config.secrets.notSet")}
                        </Text>
                        {isRequired && (
                          <Text variant="small" testId={`required-marker-${fieldId}`}>
                            {effectiveTranslate("config.secrets.required")}
                          </Text>
                        )}
                      </>
                    )}
                  </>
                }
              >
                <Text variant="small">
                  {effectiveTranslate(
                    row !== undefined
                      ? "config.secrets.replacePlaceholder"
                      : "config.secrets.placeholder",
                  )}
                </Text>
                <Input
                  kind="password"
                  id={fieldId}
                  name={fieldId}
                  value={drafts[fieldId] ?? ""}
                  onChange={(v) => setDraft(fieldId, v)}
                  autoComplete="new-password"
                  disabled={submitting}
                  testId={`secret-input-${fieldId}`}
                />
              </Field>
            );
          })}
        </Section>
      ))}
    </Form>
  );
}
