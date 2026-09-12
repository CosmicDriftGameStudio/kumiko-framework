import type { SecretMintScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FormValues, SubmitResult, Translate } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { RenderEdit } from "../components/render-edit";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import {
  synthesizeActionFormEntity,
  synthesizeActionFormScreen,
  synthesizeSecretMintConfirmScreen,
} from "./action-form-shim";
import type { FeatureSchema } from "./feature-schema";
import { buildInitialValues, mergeSearchParamsIntoInitial } from "./kumiko-screen";
import { layoutFieldNames } from "./layout-fields";
import { useNav } from "./nav";
import { lastSegment } from "./qn";

export type SecretMintBodyProps = {
  readonly schema: FeatureSchema;
  readonly screen: SecretMintScreenDefinition;
  readonly translate?: Translate;
};

function extractRevealValue(data: unknown, field: string): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  if (!Object.hasOwn(data, field)) return undefined;
  return (data as Record<string, unknown>)[field];
}

function extractCarriedValues(
  data: unknown,
  carry: readonly string[],
): Readonly<Record<string, unknown>> {
  const carried: Record<string, unknown> = {};
  for (const field of carry) {
    const value = extractRevealValue(data, field);
    if (value === undefined) continue;
    carried[field] = value;
  }
  return carried;
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

// Mint form → one-time reveal → optional confirm → done. The revealed values
// live ONLY in this component's `revealed` state — never in the URL, a query
// cache, or nav — the write-handler's success payload is the only place the
// secret ever exists (fw#2548). onSubmit copies exclusively the fields
// declared in `screen.reveal.fields` out of that payload (a whitelist, never
// the payload as a whole) so an unrelated field (e.g. an internal "id") can
// never leak into the reveal. `screen.confirm` (fw#2838, e.g. TOTP enroll:
// scan the code, then enter one) works the same way for its own carried
// mint-payload fields — those live only in `carriedRef`, never in React state
// that gets rendered, never in the confirm form's own values.
export function SecretMintBody({ schema, screen, translate }: SecretMintBodyProps): ReactNode {
  const nav = useNav();
  const { Card, Heading, Banner, Button, Text, Grid, GridCell, SecretReveal } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const synthEntity = useMemo(() => synthesizeActionFormEntity(screen.fields), [screen.fields]);
  const synthScreen = useMemo(() => synthesizeActionFormScreen(screen), [screen]);
  const initial = useMemo(
    () =>
      mergeSearchParamsIntoInitial(
        screen.fields,
        nav.searchParams,
        layoutFieldNames(synthScreen),
      ) as FormValues,
    [screen.fields, nav.searchParams, synthScreen],
  );
  const [revealed, setRevealed] = useState<Readonly<Record<string, unknown>> | null>(null);
  const [done, setDone] = useState(false);
  // Never rendered, never merged into `revealed` or the confirm form's
  // initial values — read only from `buildPayload` at confirm-submit time.
  const carriedRef = useRef<Readonly<Record<string, unknown>>>({});

  const confirm = screen.confirm;
  const confirmEntity = useMemo(
    () => (confirm !== undefined ? synthesizeActionFormEntity(confirm.fields) : undefined),
    [confirm],
  );
  const confirmScreen = useMemo(
    () => (confirm !== undefined ? synthesizeSecretMintConfirmScreen(screen, confirm) : undefined),
    [screen, confirm],
  );
  const confirmInitial = useMemo(
    () => (confirm !== undefined ? (buildInitialValues(confirm.fields) as FormValues) : undefined),
    [confirm],
  );

  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (!result.isSuccess) return;
      const values: Record<string, unknown> = {};
      for (const revealField of screen.reveal.fields) {
        const value = extractRevealValue(result.data, revealField.field);
        if (value === undefined) continue;
        values[revealField.field] = value;
      }
      setRevealed(values);
      carriedRef.current =
        confirm?.carry !== undefined ? extractCarriedValues(result.data, confirm.carry) : {};
    },
    [screen.reveal.fields, confirm?.carry],
  );

  const handleCancel = useMemo<(() => void) | undefined>(() => {
    const target = screen.cancelTarget ?? screen.redirect;
    if (target === undefined || target === false) return undefined;
    return () => nav.navigate({ screenId: lastSegment(target) });
  }, [nav, screen.redirect, screen.cancelTarget]);

  // Ends the reveal phase for both paths (the bare acknowledge button, and a
  // successful confirm submit): clears the secret and the carried values, then
  // either navigates (screen.redirect) or shows a done-state — never falls
  // back to re-rendering the mint form, which would let a stray click mint
  // (and invalidate) the secret again.
  const finishMint = useCallback(() => {
    setRevealed(null);
    carriedRef.current = {};
    if (screen.redirect !== undefined) {
      nav.navigate({ screenId: lastSegment(screen.redirect) });
    } else {
      setDone(true);
    }
  }, [nav, screen.redirect]);

  const handleConfirmSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (result.isSuccess) finishMint();
    },
    [finishMint],
  );

  if (done) {
    return (
      <Card>
        <Banner variant="info" testId="kumiko-screen-secret-mint-done">
          {effectiveTranslate(confirm?.doneMessage ?? "kumiko.secretMint.done")}
        </Banner>
      </Card>
    );
  }

  if (revealed !== null) {
    const values = screen.reveal.fields.flatMap((revealField) => {
      const raw = revealed[revealField.field];
      if (isBlank(raw)) return [];
      const display = revealField.display ?? "code";
      const value =
        display === "list" && Array.isArray(raw)
          ? raw.map((v) => String(v)).join("\n")
          : String(raw);
      return [
        {
          label: effectiveTranslate(revealField.label),
          value,
          copyable: revealField.copyable ?? true,
          multiline: display === "list",
          ...(display === "qr" && { qr: true }),
        },
      ];
    });
    return (
      <Card testId="kumiko-screen-secret-mint-card">
        <Heading variant="page">
          {effectiveTranslate(screen.reveal.title ?? "kumiko.secretMint.title")}
        </Heading>
        <Banner variant="warning" testId="kumiko-screen-secret-mint-warning">
          {effectiveTranslate(screen.reveal.warning ?? "kumiko.secretMint.warning")}
        </Banner>
        {SecretReveal !== undefined ? (
          <SecretReveal
            values={values}
            copyLabel={effectiveTranslate("kumiko.secretMint.copy")}
            copiedLabel={effectiveTranslate("kumiko.secretMint.copied")}
            testId="kumiko-screen-secret-mint-reveal"
          />
        ) : (
          <Grid columns={1} testId="kumiko-screen-secret-mint-reveal">
            {values.map((v) => (
              <GridCell key={v.label}>
                <Text>{v.label}</Text>
                <Text variant="code">{v.value}</Text>
              </GridCell>
            ))}
          </Grid>
        )}
        {confirm !== undefined && confirmEntity !== undefined && confirmScreen !== undefined ? (
          <RenderEdit
            screen={confirmScreen}
            entity={confirmEntity}
            featureName={schema.featureName}
            initial={confirmInitial ?? ({} as FormValues)}
            writeCommand={confirm.handler}
            payloadMode="values"
            buildPayload={(snapshot) => ({ ...snapshot.values, ...carriedRef.current })}
            onSubmit={handleConfirmSubmitted}
            {...(handleCancel !== undefined && { onCancel: handleCancel })}
            {...(translate !== undefined && { translate })}
            {...(confirm.submitLabel !== undefined && { submitLabel: confirm.submitLabel })}
          />
        ) : (
          <Button
            type="button"
            variant="primary"
            onClick={finishMint}
            testId="kumiko-screen-secret-mint-confirm"
          >
            {effectiveTranslate(screen.reveal.confirmLabel ?? "kumiko.secretMint.confirm")}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <RenderEdit
      screen={synthScreen}
      entity={synthEntity}
      featureName={schema.featureName}
      initial={initial}
      extensionInitialValues={initial}
      writeCommand={screen.handler}
      payloadMode="values"
      onSubmit={handleSubmitted}
      {...(handleCancel !== undefined && { onCancel: handleCancel })}
      {...(translate !== undefined && { translate })}
      {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
    />
  );
}
