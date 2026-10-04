// @runtime client

import { toInstant } from "@cosmicdrift/kumiko-headless";
import {
  useLocale,
  useMutation,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { ModeSwitch } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import { SubscriptionFoundationHandlers } from "../constants.js";
import type { ContractTerminationDeclarationType, ContractTerminationKind } from "../events.js";

type TerminateContractReceipt = {
  readonly requestId: string;
  readonly receivedAtIso: string;
  readonly effectiveAtIso: string | null;
};

type Step = "form" | "confirm" | "receipt";

export type CancelContractDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onTerminated: () => void;
};

const DECLARATION_TYPES: readonly ContractTerminationDeclarationType[] = [
  "termination",
  "withdrawal",
];
const TERMINATION_KINDS: readonly ContractTerminationKind[] = ["ordinary", "extraordinary"];

// kumiko-lint-ignore no-custom-primitives Uses usePrimitives().Modal internally, name is a billing domain action, not a primitive reimplementation
export function CancelContractDialog({
  open,
  onOpenChange,
  onTerminated,
}: CancelContractDialogProps): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  const { Modal, Text, Field, Input, Button, Banner } = usePrimitives();
  const terminate = useMutation<TerminateContractReceipt>(
    SubscriptionFoundationHandlers.terminateContract,
  );
  const [step, setStep] = useState<Step>("form");
  const [declarationType, setDeclarationType] =
    useState<ContractTerminationDeclarationType>("termination");
  const [terminationKind, setTerminationKind] = useState<ContractTerminationKind>("ordinary");
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<TerminateContractReceipt | null>(null);

  const reasonMissing = terminationKind === "extraordinary" && reason.trim().length === 0;

  async function submit(): Promise<void> {
    const trimmedReason = reason.trim();
    const result = await terminate.mutate({
      declarationType,
      terminationKind,
      ...(trimmedReason.length > 0 && { reason: trimmedReason }),
    });
    if (!result.isSuccess) return;
    setReceipt(result.data);
    setStep("receipt");
    onTerminated();
  }

  function formatInstant(iso: string): string {
    return toInstant(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("billing-foundation.cancel.title")}
      testId="cancel-contract-dialog"
    >
      <div className="flex flex-col gap-4">
        {step === "form" && (
          <>
            <Text variant="muted">{t("billing-foundation.cancel.declaration")}</Text>
            <ModeSwitch
              value={declarationType}
              options={DECLARATION_TYPES.map((value) => ({
                value,
                label: t(`billing-foundation.cancel.declaration.${value}`),
              }))}
              onChange={setDeclarationType}
              ariaLabel={t("billing-foundation.cancel.declaration")}
              testId="cancel-declaration-type"
            />
            {declarationType === "withdrawal" && (
              <Text variant="muted">{t("billing-foundation.cancel.withdrawalHint")}</Text>
            )}
            <Text variant="muted">{t("billing-foundation.cancel.kind")}</Text>
            <ModeSwitch
              value={terminationKind}
              options={TERMINATION_KINDS.map((value) => ({
                value,
                label: t(`billing-foundation.cancel.kind.${value}`),
              }))}
              onChange={setTerminationKind}
              ariaLabel={t("billing-foundation.cancel.kind")}
              testId="cancel-termination-kind"
            />
            {terminationKind === "extraordinary" && (
              <Field id="cancel-reason" label={t("billing-foundation.cancel.reason")} required>
                <Input
                  kind="textarea"
                  id="cancel-reason"
                  name="cancel-reason"
                  value={reason}
                  onChange={setReason}
                  required
                  rows={3}
                />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                testId="cancel-contract-close"
              >
                {t("billing-foundation.cancel.close")}
              </Button>
              <Button
                disabled={reasonMissing}
                onClick={() => setStep("confirm")}
                testId="cancel-contract-continue"
              >
                {t("billing-foundation.cancel.continue")}
              </Button>
            </div>
          </>
        )}
        {step === "confirm" && (
          <>
            <Text>
              {t("billing-foundation.cancel.confirmQuestion", {
                declaration: t(`billing-foundation.cancel.declaration.${declarationType}`),
                kind: t(`billing-foundation.cancel.kind.${terminationKind}`),
              })}
            </Text>
            {terminate.error !== null && (
              <Banner variant="error" testId="cancel-contract-error">
                {t(terminate.error.i18nKey, terminate.error.i18nParams)}
              </Banner>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={terminate.pending}
                onClick={() => setStep("form")}
                testId="cancel-contract-back"
              >
                {t("billing-foundation.cancel.back")}
              </Button>
              <Button
                variant="danger"
                disabled={terminate.pending}
                loading={terminate.pending}
                onClick={submit}
                testId="cancel-contract-submit"
              >
                {t("billing-foundation.cancel.submit")}
              </Button>
            </div>
          </>
        )}
        {step === "receipt" && receipt !== null && (
          <>
            <div className="flex flex-col gap-1" data-testid="cancel-contract-receipt">
              <Text>
                {t("billing-foundation.cancel.receivedAt", {
                  date: formatInstant(receipt.receivedAtIso),
                })}
              </Text>
              <Text>
                {receipt.effectiveAtIso !== null
                  ? t("billing-foundation.cancel.effectiveAt", {
                      date: formatInstant(receipt.effectiveAtIso),
                    })
                  : t("billing-foundation.cancel.effectiveUnknown")}
              </Text>
              <Text variant="muted">{t("billing-foundation.cancel.emailConfirmation")}</Text>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)} testId="cancel-contract-done">
                {t("billing-foundation.cancel.close")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
