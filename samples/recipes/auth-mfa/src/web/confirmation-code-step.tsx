import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";

const CONFIRMATION_CODE_LENGTH = 6;

export type ConfirmationCodeStepProps = {
  /** Resolves true when the server accepted the code. */
  readonly onConfirm: (code: string) => Promise<boolean>;
};

export function ConfirmationCodeStep({ onConfirm }: ConfirmationCodeStepProps): ReactNode {
  const { Input, Banner } = usePrimitives();
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [rejected, setRejected] = useState(false);

  const confirm = async (submittedCode: string): Promise<void> => {
    if (pending) return;
    setPending(true);
    setRejected(false);
    const accepted = await onConfirm(submittedCode).finally(() => setPending(false));
    if (accepted) return;
    setRejected(true);
    setCode("");
    // The input was disabled while pending and lost focus; remounting restores autoFocus.
    setAttempt((n) => n + 1);
  };

  return (
    <>
      <Input
        key={attempt}
        kind="code"
        length={CONFIRMATION_CODE_LENGTH}
        id="confirmation-code"
        name="confirmation-code"
        testId="confirmation-code"
        value={code}
        onChange={setCode}
        onComplete={(next) => void confirm(next)}
        disabled={pending}
        hasError={rejected}
        autoFocus
      />
      {rejected ? <Banner variant="error">That code is not valid. Try again.</Banner> : null}
    </>
  );
}
