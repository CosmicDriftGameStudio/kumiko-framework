import { SCREEN_ERROR_FALLBACK_TEST_ID } from "@cosmicdrift/kumiko-types/error-boundary";
import type { ReactNode } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";

// Opt-in: a bundle that leaves NODE_ENV unset must not leak error messages to end users.
function showsErrorDetails(): boolean {
  if (typeof process === "undefined") return false;
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv !== undefined && nodeEnv !== "" && nodeEnv !== "production";
}

export function ScreenErrorFallback({
  screen,
  error,
  onReset,
}: {
  readonly screen: string;
  readonly error: Error;
  readonly onReset: () => void;
}): ReactNode {
  const { Banner, Button } = usePrimitives();
  const t = useTranslation();
  return (
    <Banner
      variant="error"
      padded
      testId={SCREEN_ERROR_FALLBACK_TEST_ID}
      title={t("kumiko.screen-error.title")}
      actions={
        <Button
          variant="secondary"
          onClick={onReset}
          testId={`${SCREEN_ERROR_FALLBACK_TEST_ID}-reset`}
        >
          {t("kumiko.actions.reload")}
        </Button>
      }
    >
      {showsErrorDetails()
        ? t("kumiko.screen-error.detail", { screen, message: error.message })
        : t("kumiko.screen-error.screen", { screen })}
    </Banner>
  );
}
