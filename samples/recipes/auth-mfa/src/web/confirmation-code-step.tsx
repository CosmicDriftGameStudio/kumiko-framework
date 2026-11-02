import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useRef, useState } from "react";

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
  const [confirmed, setConfirmed] = useState(false);
  // A ref, not `pending`: two onComplete calls in one tick both see the stale render closure.
  const inFlight = useRef(false);
  const [rejected, setRejected] = useState(false);

  const confirm = async (submittedCode: string): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setRejected(false);
    let accepted = false;
    try {
      accepted = await onConfirm(submittedCode);
    } catch {
      // A network or server error must not leave the step stuck with a full field.
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    if (accepted) {
      setConfirmed(true);
      return;
    }
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
        disabled={pending || confirmed}
        hasError={rejected}
        autoFocus
      />
      {rejected ? <Banner variant="error">That code is not valid. Try again.</Banner> : null}
    </>
  );
}
