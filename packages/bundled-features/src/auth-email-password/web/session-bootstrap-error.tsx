// @runtime client
// Rendered by auth-gate's LoginRoute when the session bootstrap failed for a reason other than "not logged in".

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { AuthCard } from "./auth-form-primitives";
import type { SessionBootstrapFailure } from "./session";

export type SessionBootstrapErrorScreenProps = {
  readonly failure: SessionBootstrapFailure;
  readonly onRetry: () => Promise<void>;
};

/** Retry delay measured from failure time, not click time. */
export function retryDelayMs(failure: SessionBootstrapFailure, nowEpochMs: number): number {
  const retryAfterMs = (failure.retryAfterSeconds ?? 0) * 1000;
  return Math.max(0, failure.failedAtEpochMs + retryAfterMs - nowEpochMs);
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SessionBootstrapErrorScreen({
  failure,
  onRetry,
}: SessionBootstrapErrorScreenProps): ReactNode {
  const t = useTranslation();
  const { Banner, Button } = usePrimitives();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = (): void => {
    setRetrying(true);
    void wait(retryDelayMs(failure, Date.now()))
      .then(onRetry)
      .then(() => setRetrying(false));
  };

  return (
    <div data-testid="session-bootstrap-error" data-http-status={failure.httpStatus ?? "network"}>
      <AuthCard title={t("auth.sessionBootstrap.errorTitle")}>
        <div className="flex flex-col gap-4 px-6 pb-4">
          <Banner variant="error">
            {failure.httpStatus === 429
              ? t("auth.sessionBootstrap.rateLimitedBody")
              : t("auth.sessionBootstrap.errorBody")}
          </Banner>
          <Button variant="primary" onClick={handleRetry} disabled={retrying}>
            {retrying ? t("auth.sessionBootstrap.retrying") : t("auth.sessionBootstrap.retry")}
          </Button>
        </div>
      </AuthCard>
    </div>
  );
}
