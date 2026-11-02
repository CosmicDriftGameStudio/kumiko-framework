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
  const [failure, setFailure] = useState<"rejected" | "error" | null>(null);

  const confirm = async (submittedCode: string): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    let accepted = false;
    let technicalError = false;
    try {
      accepted = await onConfirm(submittedCode);
    } catch {
      // A network or server error must not leave the step stuck with a full field.
      technicalError = true;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    if (accepted) {
      setConfirmed(true);
      return;
    }
    setFailure(technicalError ? "error" : "rejected");
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
        hasError={failure !== null}
        autoFocus
      />
      {failure === "rejected" ? (
        <Banner variant="error">That code is not valid. Try again.</Banner>
      ) : null}
      {failure === "error" ? (
        <Banner variant="error">Could not verify the code. Try again in a moment.</Banner>
      ) : null}
    </>
  );
}
