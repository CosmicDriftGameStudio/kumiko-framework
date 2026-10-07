import type { SecretMintScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FormValues, SubmitResult, Translate } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { RenderEdit } from "../components/render-edit.js";
import { useTranslation } from "../i18n.js";
import { usePrimitives } from "../primitives.js";
import {
  synthesizeActionFormEntity,
  synthesizeActionFormScreen,
  synthesizeSecretMintConfirmScreen,
} from "./action-form-shim.js";
import type { FeatureSchema } from "./feature-schema.js";
import {
  buildInitialValues,
  mergeSearchParamsIntoInitial,
  tenantCurrencyMoneyFieldNames,
  useMoneyCurrencyOverrides,
} from "./kumiko-screen.js";
import { layoutFieldNames } from "./layout-fields.js";
import { useInitialValuesHandoff, useNav } from "./nav.js";
import { lastSegment } from "./qn.js";
import { navigateToReturnOr, useReturnTarget } from "./return-to.js";

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

// Entity-less forms have no `entity.defaultCurrency`; same fallback as actionForm.
const SECRET_MINT_CURRENCY_FALLBACK = "EUR";
const NO_FIELDS: Readonly<Record<string, unknown>> = {};

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
  const returnTarget = useReturnTarget(screen.id);
  const { Card, Heading, Banner, Button, Text, Grid, GridCell, Section, SecretReveal } =
    usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const synthEntity = useMemo(() => synthesizeActionFormEntity(screen.fields), [screen.fields]);
  const synthScreen = useMemo(() => synthesizeActionFormScreen(screen), [screen]);
  const handoffValues = useInitialValuesHandoff(screen.id);
  const mintTenantCurrencyFields = useMemo(
    () => tenantCurrencyMoneyFieldNames(screen.fields),
    [screen.fields],
  );
  const { overrides: mintCurrencyOverrides, loading: mintCurrencyLoading } =
    useMoneyCurrencyOverrides(
      screen.fields,
      mintTenantCurrencyFields,
      SECRET_MINT_CURRENCY_FALLBACK,
    );
  const initial = useMemo(
    () =>
      mergeSearchParamsIntoInitial(screen.fields, {
        searchParams: nav.searchParams,
        urlPrefillFields: screen.urlPrefillFields,
        renderableFields: layoutFieldNames(synthScreen),
        // A mint form has no entity either, so its money fields name their own
        // currency source (fw#2839, fw#2933).
        ...(mintCurrencyOverrides !== undefined && {
          moneyCurrencyOverrides: mintCurrencyOverrides,
        }),
        ...(handoffValues !== undefined && { handoffValues }),
      }) as FormValues,
    [
      screen.fields,
      screen.urlPrefillFields,
      nav.searchParams,
      synthScreen,
      handoffValues,
      mintCurrencyOverrides,
    ],
  );
  const [revealed, setRevealed] = useState<Readonly<Record<string, unknown>> | null>(null);
  const [done, setDone] = useState(false);
  // The secret was minted server-side but none of the declared reveal fields
  // came back; the mint form must not return (a re-mint would invalidate it).
  const [revealMissing, setRevealMissing] = useState(false);
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
  const confirmFields = confirm?.fields ?? NO_FIELDS;
  const confirmTenantCurrencyFields = useMemo(
    () => tenantCurrencyMoneyFieldNames(confirmFields),
    [confirmFields],
  );
  const { overrides: confirmCurrencyOverrides, loading: confirmCurrencyLoading } =
    useMoneyCurrencyOverrides(
      confirmFields,
      confirmTenantCurrencyFields,
      SECRET_MINT_CURRENCY_FALLBACK,
    );
  const confirmInitial = useMemo(
    () =>
      confirm !== undefined
        ? (buildInitialValues(confirm.fields, undefined, confirmCurrencyOverrides) as FormValues)
        : undefined,
    [confirm, confirmCurrencyOverrides],
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
      if (Object.values(values).every(isBlank)) {
        // biome-ignore lint/suspicious/noConsole: the user-facing banner carries no detail; this names the screen and fields for the developer
        console.error(
          `secretMint "${screen.id}": write result carried no value for reveal fields [${screen.reveal.fields
            .map((revealField) => revealField.field)
            .join(", ")}]`,
        );
        setRevealMissing(true);
        return;
      }
      setRevealed(values);
      carriedRef.current =
        confirm?.carry !== undefined ? extractCarriedValues(result.data, confirm.carry) : {};
    },
    [screen.id, screen.reveal.fields, confirm?.carry],
  );

  const handleCancel = useMemo<(() => void) | undefined>(() => {
    const target = screen.cancelTarget ?? screen.redirect;
    if (target === undefined || target === false) return undefined;
    return () => {
      // A native stack keeps this screen mounted after navigate; drop the secret first.
      setRevealed(null);
      carriedRef.current = {};
      navigateToReturnOr(nav, returnTarget, () => nav.navigate({ screenId: lastSegment(target) }));
    };
  }, [nav, screen.redirect, screen.cancelTarget, returnTarget]);

  // The confirm step must always offer a way out: a failed confirm (e.g. an
  // expired setup token) otherwise leaves a form that can only keep failing.
  // Restarting re-mints, which issues a fresh secret and invalidates this one.
  const restartMint = useCallback(() => {
    setRevealed(null);
    carriedRef.current = {};
  }, []);

  // Ends the reveal phase for both paths (the bare acknowledge button, and a
  // successful confirm submit): clears the secret and the carried values, then
  // either navigates (screen.redirect) or shows a done-state — never falls
  // back to re-rendering the mint form, which would let a stray click mint
  // (and invalidate) the secret again.
  const finishMint = useCallback(() => {
    setRevealed(null);
    carriedRef.current = {};
    const redirect = screen.redirect;
    if (redirect !== undefined) {
      navigateToReturnOr(nav, returnTarget, () =>
        nav.navigate({ screenId: lastSegment(redirect) }),
      );
    } else {
      setDone(true);
    }
  }, [nav, screen.redirect, returnTarget]);

  const handleConfirmSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (result.isSuccess) finishMint();
    },
    [finishMint],
  );

  if (done) {
    return (
      <Card options={{ screenBody: true }}>
        <Banner variant="info" testId="kumiko-screen-secret-mint-done">
          {effectiveTranslate(confirm?.doneMessage ?? "kumiko.secretMint.done")}
        </Banner>
      </Card>
    );
  }

  if (revealMissing) {
    return (
      <Card options={{ screenBody: true }}>
        <Banner variant="error" testId="kumiko-screen-secret-mint-missing">
          {effectiveTranslate("kumiko.form.error.generic")}
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
    const revealContent = (
      <>
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
      </>
    );
    // One screen form like the mint phase: the reveal leads the form column
    // instead of the confirm form nesting a second card inside a card. The
    // keys stop the mint and confirm forms sharing one instance (and its
    // submit state) across phases.
    if (confirm !== undefined && confirmEntity !== undefined && confirmScreen !== undefined) {
      // Hold until a tenant-declared currency lands, else the form would seed (and
      // on a fast click submit) the fallback currency (fw#2933).
      if (confirmCurrencyLoading) {
        return (
          <Banner padded variant="loading" testId="kumiko-screen-loading">
            Loading…
          </Banner>
        );
      }
      return (
        <RenderEdit
          key="confirm"
          screen={confirmScreen}
          i18nScreenId={screen.id}
          entity={confirmEntity}
          featureName={schema.featureName}
          initial={confirmInitial ?? ({} as FormValues)}
          writeCommand={confirm.handler}
          payloadMode="values"
          buildPayload={(snapshot) => ({ ...snapshot.values, ...carriedRef.current })}
          onSubmit={handleConfirmSubmitted}
          onCancel={handleCancel ?? restartMint}
          fillScreenHeight
          leadContent={<Section testId="kumiko-screen-secret-mint-card">{revealContent}</Section>}
          {...(translate !== undefined && { translate })}
          {...(confirm.submitLabel !== undefined && { submitLabel: confirm.submitLabel })}
        />
      );
    }
    return (
      <Card options={{ screenBody: true }} testId="kumiko-screen-secret-mint-card">
        {revealContent}
        <Button
          type="button"
          variant="primary"
          onClick={finishMint}
          testId="kumiko-screen-secret-mint-confirm"
        >
          {effectiveTranslate(screen.reveal.confirmLabel ?? "kumiko.secretMint.confirm")}
        </Button>
      </Card>
    );
  }

  if (mintCurrencyLoading) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }

  return (
    <RenderEdit
      key="mint"
      screen={synthScreen}
      entity={synthEntity}
      featureName={schema.featureName}
      initial={initial}
      extensionInitialValues={initial}
      writeCommand={screen.handler}
      payloadMode="values"
      onSubmit={handleSubmitted}
      fillScreenHeight
      {...(handleCancel !== undefined && { onCancel: handleCancel })}
      {...(translate !== undefined && { translate })}
      {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
    />
  );
}
