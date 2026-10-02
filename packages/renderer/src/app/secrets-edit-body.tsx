import type { SecretsEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useDispatcher } from "../context/dispatcher-context.js";
import { useQuery } from "../hooks/use-query.js";
import { useTranslation } from "../i18n.js";
import { STICKY_PRIMARY_ACTION_PROP, usePrimitives } from "../primitives.js";
import { QueryErrorBanner, QueryLoadingBanner } from "./query-state-banners.js";
import { dispatcherErrorText } from "./write-failed-error.js";

type SecretListRow = {
  readonly key: string;
  readonly redactedPreview: string | null;
  readonly hint: string | null;
};

export type SecretsEditBodyProps = {
  readonly screen: SecretsEditScreenDefinition;
  readonly translate?: Translate;
};

function groupSectionsByTitle(
  sections: SecretsEditScreenDefinition["sections"],
): readonly { readonly title: string; readonly fields: readonly string[] }[] {
  const byTitle = new Map<string, string[]>();
  for (const section of sections) {
    const title = section.title ?? "config.secrets.section";
    // kumiko-lint-ignore section-fields-raw secretsEdit section fields are field-id strings, not EditFieldSpec
    byTitle.set(title, [...(byTitle.get(title) ?? []), ...section.fields]);
  }
  return [...byTitle].map(([title, fields]) => ({ title, fields }));
}

// secrets:query:list never returns plaintext (only a redacted preview), so
// unlike ConfigEditBody there is no server value to pre-fill a draft with —
// every input starts at "" and stays that way unless the user types into it.
export function SecretsEditBody({ screen, translate }: SecretsEditBodyProps): ReactNode {
  const { Banner, Dialog, Form, Section, Field, Input, Button, Text, Grid } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const dispatcher = useDispatcher();
  const listQuery = useQuery<readonly SecretListRow[]>("secrets:query:list", {});

  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    try {
      const result = await dispatcher.batch(commands);
      if (!result.isSuccess) {
        setSubmitError(dispatcherErrorText(result.error, effectiveTranslate));
        return;
      }
      setDrafts({});
      await listQuery.refetch();
    } catch {
      // Transport failures reject instead of returning a result; drafts stay
      // so the user can retry without retyping the secrets.
      setSubmitError(effectiveTranslate("kumiko.form.error.generic"));
    } finally {
      setSubmitting(false);
    }
  }, [dispatcher, drafts, screen.secretKeys, listQuery.refetch, effectiveTranslate]);

  const handleDelete = useCallback(
    async (qualified: string): Promise<void> => {
      setDeleting(true);
      try {
        const result = await dispatcher.write("secrets:write:delete", { key: qualified });
        if (!result.isSuccess) {
          setSubmitError(dispatcherErrorText(result.error, effectiveTranslate));
          return;
        }
        setSubmitError(null);
        await listQuery.refetch();
      } catch {
        setSubmitError(effectiveTranslate("kumiko.form.error.generic"));
      } finally {
        setDeleting(false);
      }
    },
    [dispatcher, listQuery.refetch, effectiveTranslate],
  );

  if (listQuery.loading && listQuery.data === null) return <QueryLoadingBanner />;
  if (listQuery.error) {
    return (
      <QueryErrorBanner
        error={listQuery.error}
        translate={effectiveTranslate}
        onRetry={listQuery.refetch}
      />
    );
  }

  // The generator emits one section per feature; features without a declared
  // title all fall under the generic "Secrets" heading and share one band.
  const sectionGroups = groupSectionsByTitle(screen.sections);
  const unsavedCount = Object.values(drafts).filter((value) => value.trim() !== "").length;

  return (
    <>
      <Form
        onSubmit={() => {
          void handleSubmit();
        }}
        testId="secrets-edit-form"
        width="full"
        fillHeight
        stickyActions
        screenForm
        unsavedCount={unsavedCount}
        {...(screen.description !== undefined && {
          subtitle: effectiveTranslate(screen.description),
        })}
        actions={
          <>
            {unsavedCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                disabled={submitting}
                onClick={() => setDrafts({})}
                testId="secrets-edit-discard"
                {...{ [STICKY_PRIMARY_ACTION_PROP]: true }}
              >
                {effectiveTranslate("kumiko.form.discard")}
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={submitting || unsavedCount === 0}
              testId="secrets-edit-submit"
            >
              {effectiveTranslate("kumiko.form.saveChanges")}
            </Button>
          </>
        }
      >
        {submitError !== null && (
          <Banner variant="error" testId="secrets-edit-error">
            {submitError}
          </Banner>
        )}
        {sectionGroups.map((section) => (
          <Section
            key={section.title}
            layout="settings-list"
            title={effectiveTranslate(section.title)}
            subtitle={effectiveTranslate("config.secrets.description")}
          >
            <Grid columns={1} list>
              {/* kumiko-lint-ignore section-fields-raw secretsEdit section fields are field-id strings, not EditFieldSpec */}
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
                    layout="row"
                    label={effectiveTranslate(screen.fieldLabels[fieldId] ?? fieldId)}
                    required={isRequired}
                    testId={`field-${fieldId}`}
                    status={
                      row !== undefined
                        ? {
                            tone: "ok",
                            label: effectiveTranslate("config.secrets.saved"),
                            testId: `secret-saved-${fieldId}`,
                          }
                        : {
                            tone: isRequired ? "bad" : "muted",
                            label: effectiveTranslate("config.secrets.notSet"),
                            testId: `secret-not-set-${fieldId}`,
                          }
                    }
                    {...(hintKey !== undefined && { description: effectiveTranslate(hintKey) })}
                    {...(row !== undefined && {
                      fieldAppendix: (
                        <Grid columns="auto">
                          <Text variant="muted" testId={`secret-preview-${fieldId}`}>
                            {row.redactedPreview !== null
                              ? effectiveTranslate("config.secrets.stored", {
                                  preview: row.redactedPreview,
                                })
                              : effectiveTranslate("config.secrets.set")}
                          </Text>
                          <Button
                            type="button"
                            variant="danger-ghost"
                            size="sm"
                            disabled={submitting || deleting}
                            onClick={() => setPendingDeleteKey(qualified)}
                            testId={`secret-delete-${fieldId}`}
                          >
                            {effectiveTranslate("config.secrets.delete")}
                          </Button>
                        </Grid>
                      ),
                    })}
                  >
                    <Input
                      kind="password"
                      id={fieldId}
                      name={fieldId}
                      value={drafts[fieldId] ?? ""}
                      onChange={(v) => setDraft(fieldId, v)}
                      placeholder={effectiveTranslate(
                        row !== undefined
                          ? "config.secrets.replacePlaceholder"
                          : "config.secrets.placeholder",
                      )}
                      autoComplete="new-password"
                      disabled={submitting}
                      testId={`secret-input-${fieldId}`}
                    />
                  </Field>
                );
              })}
            </Grid>
          </Section>
        ))}
      </Form>
      <Dialog
        open={pendingDeleteKey !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteKey(null);
        }}
        title={effectiveTranslate("config.secrets.delete")}
        description={effectiveTranslate("config.secrets.deleteConfirm")}
        confirmLabel={effectiveTranslate("config.secrets.delete")}
        variant="danger"
        initialFocus="cancel"
        onConfirm={async () => {
          if (pendingDeleteKey !== null) await handleDelete(pendingDeleteKey);
        }}
        testId="secrets-delete-dialog"
      />
    </>
  );
}
